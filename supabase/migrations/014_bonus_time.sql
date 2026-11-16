-- ============================================================
-- Migration 014: Bonus time engine + solution approval
-- ============================================================
-- Workflow
--   question assigned -> team submits -> judge evaluates ->
--   solution approved -> bonus transaction recorded -> solving
--   clock extended -> realtime update published -> every client
--   recalculates the authoritative deadline.
--
-- Guarantees
--   * Only an authorised judge/admin can approve or award.
--   * A bonus is always linked to a submission, a team and a slot.
--   * The same submission can never award the bonus twice
--     (unique index on submission_id).
--   * The clock extension and the ledger insert happen in the
--     same transaction.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Submission columns required by the approval workflow
-- ─────────────────────────────────────────────────────────────
alter table public.submissions
  add column if not exists live_url text;
alter table public.submissions
  add column if not exists approved_by uuid;
alter table public.submissions
  add column if not exists approved_at timestamptz;
alter table public.submissions
  add column if not exists judge_notes text;

alter table public.submissions
  drop constraint if exists submissions_status_check;
alter table public.submissions
  add constraint submissions_status_check
  check (status in ('submitted', 'evaluating', 'evaluated', 'review', 'approved', 'rejected'));

create unique index if not exists submissions_team_slot_unique_idx
  on public.submissions (team_id, slot_id);

comment on column public.submissions.slot_id is
  'The auction item (and therefore the question) this solution answers. '
  'The submitting team must own the slot.';


-- ─────────────────────────────────────────────────────────────
-- 2. Bonus transaction ledger
-- ─────────────────────────────────────────────────────────────
create table if not exists public.bonus_transactions (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  slot_id       uuid references public.slots(id) on delete set null,
  topic_id      uuid references public.topics(id) on delete set null,
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  approved_by   uuid not null,
  bonus_seconds integer not null check (bonus_seconds > 0),
  reason        text,
  created_at    timestamptz not null default now()
);

comment on table public.bonus_transactions is
  'One row per awarded bonus. The unique constraint on submission_id makes the '
  'award idempotent — a second attempt returns the existing award instead of '
  'extending the clock again.';

create index if not exists idx_bonus_tx_team
  on public.bonus_transactions (team_id, created_at desc);
create index if not exists idx_bonus_tx_slot
  on public.bonus_transactions (slot_id)
  where slot_id is not null;


-- ─────────────────────────────────────────────────────────────
-- 3. Award the bonus
-- ─────────────────────────────────────────────────────────────
create or replace function public.grant_bonus_time(
  p_submission_id uuid,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission   public.submissions%rowtype;
  v_slot         public.slots%rowtype;
  v_session      public.auction_sessions%rowtype;
  v_existing     public.bonus_transactions%rowtype;
  v_bonus_secs   integer;
  v_session_id   uuid;
  v_new_ends_at  timestamptz;
  v_new_status   text;
  v_new_paused   integer;
begin
  -- 1. Authorisation (judge or admin only)
  if not public.is_admin_or_judge() then
    raise exception 'Judge or admin access required to award bonus time';
  end if;

  if p_submission_id is null then
    raise exception 'A submission is required to award bonus time';
  end if;

  -- 2. Lock and validate the submission
  select * into v_submission
  from public.submissions s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found';
  end if;

  if v_submission.status <> 'approved' then
    raise exception
      'Solution must be approved before bonus time can be awarded (current status: %)',
      v_submission.status;
  end if;

  -- 3. The team must own the assigned question
  select * into v_slot
  from public.slots s
  where s.id = v_submission.slot_id
  for update;

  if not found then
    raise exception 'Assigned auction item not found for this submission';
  end if;

  if v_slot.winner_team_id is null or v_slot.winner_team_id <> v_submission.team_id then
    raise exception 'Submission is not linked to a question owned by this team';
  end if;

  if public.team_is_eliminated(v_submission.team_id) then
    raise exception 'Eliminated teams cannot earn auction bonus time';
  end if;

  -- 4. Idempotency: one bonus per submission
  select * into v_existing
  from public.bonus_transactions b
  where b.submission_id = p_submission_id;

  if found then
    return jsonb_build_object(
      'success',         true,
      'already_awarded', true,
      'bonus_id',        v_existing.id,
      'bonus_seconds',   v_existing.bonus_seconds,
      'team_id',         v_existing.team_id,
      'slot_id',         v_existing.slot_id,
      'created_at',      v_existing.created_at
    );
  end if;

  -- 5. Duration comes from the authoritative settings
  v_bonus_secs := public.get_setting_int('bonus_time_seconds', 60);
  if v_bonus_secs <= 0 then
    raise exception 'bonus_time_seconds must be a positive number of seconds';
  end if;

  -- 6. Extend the authoritative solving clock (single active session)
  select * into v_session
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No active auction session to extend';
  end if;

  v_session_id  := v_session.id;
  v_new_ends_at := v_session.timer_ends_at;
  v_new_status  := v_session.timer_status;
  v_new_paused  := v_session.paused_remaining_seconds;

  if v_session.timer_status = 'paused' then
    -- Preserve the frozen remaining time and grow it.
    v_new_paused := v_session.paused_remaining_seconds + v_bonus_secs;
  elsif v_session.timer_status = 'running' and v_session.timer_ends_at is not null then
    v_new_ends_at := v_session.timer_ends_at + make_interval(secs => v_bonus_secs);
  else
    -- First award starts the solving clock.
    v_new_ends_at := clock_timestamp() + make_interval(secs => v_bonus_secs);
    v_new_status  := 'running';
  end if;

  update public.auction_sessions
  set timer_status              = v_new_status,
      timer_ends_at             = v_new_ends_at,
      timer_started_at          = coalesce(timer_started_at, clock_timestamp()),
      paused_remaining_seconds  = v_new_paused,
      total_bonus_seconds       = total_bonus_seconds + v_bonus_secs,
      updated_at                = clock_timestamp()
  where id = v_session_id;

  -- 7. Record the transaction
  insert into public.bonus_transactions (
    team_id, slot_id, topic_id, submission_id,
    approved_by, bonus_seconds, reason
  )
  values (
    v_submission.team_id, v_slot.id, v_slot.topic_id, p_submission_id,
    auth.uid(), v_bonus_secs, nullif(trim(coalesce(p_reason, '')), '')
  )
  returning id into v_existing.id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_submission.team_id, 'bonus_time_granted', 'submission', p_submission_id,
    jsonb_build_object(
      'team_id',       v_submission.team_id,
      'slot_id',       v_slot.id,
      'bonus_seconds', v_bonus_secs,
      'reason',        p_reason,
      'session_id',    v_session_id
    )
  );

  return jsonb_build_object(
    'success',         true,
    'already_awarded', false,
    'bonus_id',        v_existing.id,
    'bonus_seconds',   v_bonus_secs,
    'team_id',         v_submission.team_id,
    'slot_id',         v_slot.id,
    'session_id',      v_session_id,
    'timer_ends_at',   v_new_ends_at,
    'timer_status',    v_new_status
  );
end;
$$;

revoke all on function public.grant_bonus_time(uuid, text) from public;
grant execute on function public.grant_bonus_time(uuid, text) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. Judge approval of a solution
-- ─────────────────────────────────────────────────────────────
create or replace function public.approve_submission(
  p_submission_id uuid,
  p_score         numeric default 0,
  p_notes         text default null,
  p_grant_bonus   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_slot       public.slots%rowtype;
  v_bonus      jsonb;
  v_eval_id    uuid;
begin
  if not public.is_admin_or_judge() then
    raise exception 'Judge or admin access required to approve a solution';
  end if;

  select * into v_submission
  from public.submissions s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found';
  end if;

  select * into v_slot
  from public.slots s
  where s.id = v_submission.slot_id;

  if not found then
    raise exception 'Assigned auction item not found for this submission';
  end if;

  if v_slot.winner_team_id is null or v_slot.winner_team_id <> v_submission.team_id then
    raise exception 'Submission is not linked to a question owned by this team';
  end if;

  if p_score < 0 then
    raise exception 'Score cannot be negative';
  end if;

  update public.submissions
  set status       = 'approved',
      approved_by  = auth.uid(),
      approved_at  = clock_timestamp(),
      judge_notes  = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_submission_id;

  -- Competition score (kept separate from the auction budget)
  insert into public.evaluations (submission_id, score, report, evaluator_version, status)
  values (
    p_submission_id, p_score,
    jsonb_build_object('notes', p_notes, 'approved_by', auth.uid()),
    'manual', 'completed'
  )
  on conflict (submission_id) do update
    set score         = excluded.score,
        report        = excluded.report,
        evaluator_version = excluded.evaluator_version,
        status        = 'completed',
        evaluated_at  = clock_timestamp();

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_submission.team_id, 'solution_approved', 'submission', p_submission_id,
    jsonb_build_object('score', p_score, 'notes', p_notes, 'slot_id', v_slot.id)
  );

  v_bonus := NULL;
  if coalesce(p_grant_bonus, false) then
    v_bonus := public.grant_bonus_time(p_submission_id, p_notes);
  end if;

  return jsonb_build_object(
    'success',      true,
    'submission_id', p_submission_id,
    'score',        p_score,
    'bonus',        v_bonus
  );
end;
$$;

revoke all on function public.approve_submission(uuid, numeric, text, boolean) from public;
grant execute on function public.approve_submission(uuid, numeric, text, boolean) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. Bonus history reader (admin)
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_bonus_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read the bonus history';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id',            b.id,
          'team_id',       b.team_id,
          'team_name',     t.name,
          'slot_id',       b.slot_id,
          'topic_id',      b.topic_id,
          'submission_id', b.submission_id,
          'approved_by',   b.approved_by,
          'bonus_seconds', b.bonus_seconds,
          'reason',        b.reason,
          'created_at',    b.created_at
        )
        order by b.created_at desc
      )
      from public.bonus_transactions b
      join public.teams t on t.id = b.team_id
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_bonus_history() from public;
grant execute on function public.get_bonus_history() to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────
alter table public.bonus_transactions enable row level security;

drop policy if exists "Teams view own bonus transactions" on public.bonus_transactions;
create policy "Teams view own bonus transactions"
on public.bonus_transactions
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

drop policy if exists "Admins manage bonus transactions" on public.bonus_transactions;
create policy "Admins manage bonus transactions"
on public.bonus_transactions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke insert, update, delete on public.bonus_transactions from authenticated;
grant select on public.bonus_transactions to authenticated;
grant insert, update, delete on public.bonus_transactions to service_role;

-- Submissions: participants may read their own, never write directly.
drop policy if exists "Teams view own submissions" on public.submissions;
create policy "Teams view own submissions"
on public.submissions
for select
to authenticated
using (
  team_id = public.current_team_id()
  or public.is_admin()
);

revoke insert, update, delete on public.submissions from authenticated;
grant select on public.submissions to authenticated;
grant insert, update, delete on public.submissions to service_role;
