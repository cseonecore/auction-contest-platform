-- Target: Supabase SQL Editor (project qqbuauryvhgssmmxiiuh)
-- One-shot production deploy (all pending migrations):
--   029 restores missing auction/submission functions
--   030 adds dev-timer pause/resume + submission enable/disable
--   031 exposes per-team add-on overrides in get_bidding_results()
-- Paste this entire file into the SQL Editor and run it once. Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════
-- 029 · Restore missing auction + submission RPCs
-- ═══════════════════════════════════════════════════════════════════
-- The linked production project (qqbuauryvhgssmmxiiuh) is missing the
-- following functions even though later migrations were applied:
--
--   public.settle_slot(uuid)                     (021)
--   public.settle_expired_slots()                (021)
--   public.finalize_round_3_eliminations()       (023)
--   public.reject_submission(uuid, text)         (022)
--   public.reopen_submission(uuid, text)         (022)
--
-- Consequences observed in the live database:
--   * public.get_live_auction_state() raises
--     "function public.settle_expired_slots() does not exist", so the
--     admin/participant/projector auction state never loads.
--     → The /admin/auction page renders the "Start Session" button,
--       start_auction() succeeds server-side, but the refresh fails,
--       so the button appears to do nothing.
--   * public.place_bid() calls settle_expired_slots() first, so no
--     bid can be placed.
--   * public.close_slot() calls settle_slot(), so "Close Bidding"
--     fails.
--   * Round-3 finalisation, submission reject and submission reopen
--     are unavailable.
--
-- This migration only (re)creates those five functions, copied
-- verbatim from migrations 021/022/023. It is safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. settle_slot — internal, exactly-once finalisation (021)
-- ─────────────────────────────────────────────────────────────
create or replace function public.settle_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot     public.slots%rowtype;
  v_balance  integer;
  v_bid_id   uuid;
  v_session  uuid;
  v_topic    text;
begin
  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  if v_slot.status <> 'open' then
    raise exception
      'Only open slots can be settled. Current status: %', v_slot.status;
  end if;

  select t.title into v_topic from public.topics t where t.id = v_slot.topic_id;

  select s.id into v_session
  from   public.auction_sessions s
  where  s.active_slot_id = p_slot_id
  limit  1;

  if v_session is null then
    select s.id into v_session
    from public.auction_sessions s
    where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                       'finalizing','question_assigned','solving')
    order by s.created_at desc
    limit 1;
  end if;

  -- ── Case A: no bids → unsold ────────────────────────────────
  if v_slot.leader_team_id is null then
    update public.slots
    set  status          = 'skipped',
         winner_team_id = null,
         timer_status   = 'completed',
         timer_paused_at = null,
         sold_at        = clock_timestamp()
    where id = p_slot_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(), 'slot_unsold', 'slot', p_slot_id,
      jsonb_build_object(
        'reason', 'no_bids',
        'round', v_slot.round,
        'topic_title', v_topic
      )
    );

    if v_session is not null then
      update public.auction_sessions
      set status = 'bidding_closed', updated_at = clock_timestamp()
      where id = v_session and status in ('bidding_open','finalizing');
    end if;

    return jsonb_build_object(
      'success', true,
      'status',  'skipped',
      'outcome', 'unsold',
      'slot_id', p_slot_id,
      'topic_title', v_topic,
      'server_time', clock_timestamp()
    );
  end if;

  -- ── Case B: a winner exists → exactly one wallet debit ──────
  select b.id into v_bid_id
  from public.bids b
  where b.slot_id = p_slot_id and b.team_id = v_slot.leader_team_id
  order by b.server_time desc, b.id desc
  limit 1;

  perform public.apply_wallet_transaction(
    v_slot.leader_team_id,
    'win_deduction',
    -v_slot.current_bid,
    p_slot_id,
    v_bid_id,
    auth.uid(),
    'Winning bid for auction item',
    jsonb_build_object('round', v_slot.round, 'topic_id', v_slot.topic_id)
  );

  select w.balance into v_balance
  from public.wallets w
  where w.team_id = v_slot.leader_team_id;

  update public.slots
  set  status          = 'sold',
       winner_team_id = v_slot.leader_team_id,
       timer_status   = 'completed',
       timer_paused_at = null,
       sold_at        = clock_timestamp()
  where id = p_slot_id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_slot.leader_team_id, 'slot_sold', 'slot', p_slot_id,
    jsonb_build_object(
      'winner_team_id', v_slot.leader_team_id,
      'winning_bid',    v_slot.current_bid,
      'round',          v_slot.round,
      'topic_id',       v_slot.topic_id,
      'topic_title',    v_topic
    )
  );

  if v_session is not null then
    update public.auction_sessions
    set status = 'question_assigned', updated_at = clock_timestamp()
    where id = v_session and status in ('bidding_open','bidding_closed','finalizing');
  end if;

  return jsonb_build_object(
    'success',        true,
    'status',         'sold',
    'slot_id',        p_slot_id,
    'winner_team_id', v_slot.leader_team_id,
    'winning_bid',    v_slot.current_bid,
    'new_balance',    v_balance,
    'topic_title',    v_topic,
    'server_time',    clock_timestamp()
  );
end;
$$;

revoke all on function public.settle_slot(uuid) from public;


-- ─────────────────────────────────────────────────────────────
-- 2. settle_expired_slots — server clock owns expiry (021)
-- ─────────────────────────────────────────────────────────────
create or replace function public.settle_expired_slots()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
  v_ids   jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  for v_row in
    select s.id
    from   public.slots s
    where  s.status = 'open'
      and  s.timer_status = 'running'
      and  s.end_time is not null
      and  s.end_time <= clock_timestamp()
    order by s.end_time
    for update skip locked
  loop
    -- One unsettleable item must never break every read of the
    -- auction state. The failure is recorded for the organisers and
    -- the item stays open for a manual decision.
    begin
      v_result := public.settle_slot(v_row.id);
      v_count  := v_count + 1;
      v_ids    := v_ids || jsonb_build_object(
        'slot_id', v_row.id,
        'status',  v_result ->> 'status'
      );
    exception
      when others then
        insert into public.audit_log (action, entity_type, entity_id, details)
        values (
          'slot_settlement_failed', 'slot', v_row.id,
          jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate)
        );
        v_ids := v_ids || jsonb_build_object(
          'slot_id', v_row.id,
          'status',  'failed',
          'error',   sqlerrm
        );
    end;
  end loop;

  return jsonb_build_object(
    'success', true,
    'settled', v_count,
    'items',   v_ids,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.settle_expired_slots() from public;
grant execute on function public.settle_expired_slots() to authenticated, anon, service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. finalize_round_3_eliminations (023)
-- ─────────────────────────────────────────────────────────────
create or replace function public.finalize_round_3_eliminations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team record;
  v_won_count integer;
  v_eliminated_count integer := 0;
  v_qualified_count integer := 0;
  v_details jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to finalize contest eliminations';
  end if;

  for v_team in
    select t.id, t.name
    from public.teams t
    order by t.name
  loop
    select count(*) into v_won_count
    from public.slots s
    where s.winner_team_id = v_team.id and s.status = 'sold';

    if v_won_count >= 2 then
      v_qualified_count := v_qualified_count + 1;
      v_details := v_details || jsonb_build_object(
        'team_id', v_team.id,
        'team_name', v_team.name,
        'won_count', v_won_count,
        'status', 'qualified'
      );
    else
      -- Check if already eliminated
      if not public.team_is_eliminated(v_team.id) then
        perform public.eliminate_team(
          v_team.id,
          'Eliminated after Round 3: acquired ' || v_won_count || ' of 2 required problem statements',
          'no_selection'
        );
        v_eliminated_count := v_eliminated_count + 1;
      end if;

      v_details := v_details || jsonb_build_object(
        'team_id', v_team.id,
        'team_name', v_team.name,
        'won_count', v_won_count,
        'status', 'eliminated'
      );
    end if;
  end loop;

  -- Emit auction event
  perform public.emit_auction_event(
    'qualification_finalized',
    null,
    null,
    jsonb_build_object(
      'qualified_count', v_qualified_count,
      'eliminated_count', v_eliminated_count,
      'details', v_details
    )
  );

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'qualification_finalized', 'contest', null,
    jsonb_build_object(
      'qualified_count', v_qualified_count,
      'eliminated_count', v_eliminated_count
    )
  );

  return jsonb_build_object(
    'success',          true,
    'qualified_count',  v_qualified_count,
    'eliminated_count', v_eliminated_count,
    'teams',            v_details,
    'server_time',      clock_timestamp()
  );
end;
$$;

revoke all on function public.finalize_round_3_eliminations() from public;
grant execute on function public.finalize_round_3_eliminations() to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. reject_submission (022)
-- ─────────────────────────────────────────────────────────────
create or replace function public.reject_submission(
  p_submission_id uuid,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_reason     text;
begin
  -- 1. Authorisation check (judge or admin only)
  if not public.is_admin_or_judge() then
    raise exception 'Judge or admin access required to reject a solution';
  end if;

  if p_submission_id is null then
    raise exception 'A submission is required';
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'Rejected by judges');

  -- 2. Lock target submission row
  select * into v_submission
  from public.submissions s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found';
  end if;

  -- 3. Validate status transitions: cannot reject an already approved submission
  if v_submission.status = 'approved' then
    raise exception 'Cannot reject an already approved submission';
  end if;

  -- 4. Atomically update submission
  -- CRITICAL: Rejection must NEVER populate approved_by or approved_at.
  update public.submissions
  set status      = 'rejected',
      judge_notes = v_reason,
      approved_by = null,
      approved_at = null
  where id = p_submission_id;

  -- 5. Atomically update evaluation with 0 score, recording rejection metadata in report
  insert into public.evaluations (submission_id, score, report, evaluator_version, status, evaluated_at)
  values (
    p_submission_id, 0,
    jsonb_build_object('notes', v_reason, 'rejected_by', auth.uid(), 'status', 'rejected', 'rejected_at', clock_timestamp()),
    'manual', 'completed', clock_timestamp()
  )
  on conflict (submission_id) do update
    set score             = 0,
        report            = coalesce(public.evaluations.report, '{}'::jsonb) ||
                            jsonb_build_object('notes', v_reason, 'rejected_by', auth.uid(), 'status', 'rejected', 'rejected_at', clock_timestamp()),
        evaluator_version = 'manual',
        status            = 'completed',
        evaluated_at      = clock_timestamp();

  -- 6. Write audit log
  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_submission.team_id, 'solution_rejected', 'submission', p_submission_id,
    jsonb_build_object('reason', v_reason, 'slot_id', v_submission.slot_id)
  );

  -- 7. Emit realtime event if available
  begin
    perform public.emit_auction_event(
      'solution_rejected',
      v_submission.slot_id,
      v_submission.team_id,
      jsonb_build_object('submission_id', p_submission_id, 'reason', v_reason)
    );
  exception
    when undefined_function then null;
  end;

  return jsonb_build_object(
    'success',       true,
    'submission_id', p_submission_id,
    'status',        'rejected',
    'reason',        v_reason
  );
end;
$$;

revoke all on function public.reject_submission(uuid, text) from public;
grant execute on function public.reject_submission(uuid, text) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. reopen_submission (022)
-- ─────────────────────────────────────────────────────────────
create or replace function public.reopen_submission(
  p_submission_id uuid,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_notes      text;
begin
  -- 1. Authorisation check (judge or admin only)
  if not public.is_admin_or_judge() then
    raise exception 'Judge or admin access required to reopen a solution';
  end if;

  if p_submission_id is null then
    raise exception 'A submission is required';
  end if;

  v_notes := nullif(trim(p_notes), '');

  -- 2. Lock target submission row
  select * into v_submission
  from public.submissions s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found';
  end if;

  -- 3. Validate status transitions:
  -- CRITICAL: Permit reopening ONLY when current status is 'rejected'.
  if v_submission.status <> 'rejected' then
    raise exception 'Only rejected submissions can be reopened for revision (current status: %)', v_submission.status;
  end if;

  -- 4. Atomically update submission back to 'submitted'
  update public.submissions
  set status      = 'submitted',
      judge_notes = coalesce(v_notes, v_submission.judge_notes),
      approved_by = null,
      approved_at = null
  where id = p_submission_id;

  -- 5. Atomically update or insert evaluation
  insert into public.evaluations (
    submission_id, score, report, evaluator_version, status, evaluated_at
  )
  values (
    p_submission_id,
    0,
    jsonb_build_object('reopened_by', auth.uid(), 'reopen_notes', v_notes, 'reopened_at', clock_timestamp()),
    'manual',
    'review',
    clock_timestamp()
  )
  on conflict (submission_id) do update
    set status       = 'review',
        report       = coalesce(public.evaluations.report, '{}'::jsonb) ||
                       jsonb_build_object('reopened_by', auth.uid(), 'reopen_notes', v_notes, 'reopened_at', clock_timestamp()),
        evaluated_at = clock_timestamp();

  -- 6. Write audit log
  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_submission.team_id, 'solution_reopened', 'submission', p_submission_id,
    jsonb_build_object('notes', v_notes, 'slot_id', v_submission.slot_id)
  );

  -- 7. Emit realtime event if available
  begin
    perform public.emit_auction_event(
      'solution_reopened',
      v_submission.slot_id,
      v_submission.team_id,
      jsonb_build_object('submission_id', p_submission_id, 'notes', v_notes)
    );
  exception
    when undefined_function then null;
  end;

  return jsonb_build_object(
    'success',       true,
    'submission_id', p_submission_id,
    'status',        'submitted',
    'notes',         v_notes
  );
end;
$$;

revoke all on function public.reopen_submission(uuid, text) from public;
grant execute on function public.reopen_submission(uuid, text) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 6. Refresh the PostgREST schema cache immediately
-- ─────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════
-- 030 · Development timer pause/resume + submission portal toggle
-- ═══════════════════════════════════════════════════════════════════
-- Adds the controls requested for /admin/submissions:
--
--   * Development timer: Start / Pause / Resume / Reset.
--   * Submission portal: Enable / Disable (Disable survives the automatic
--     "last 20 minutes" enablement until an admin re-enables or resets).
--   * Reset clears BOTH the development clock and the submission portal.
--   * Per-team deadlines and DQ math respect a paused timer.
--
-- New settings (all jsonb, matching public.settings):
--   dev_timer_paused_at        epoch millis of the active pause (0 = running)
--   dev_timer_paused_total_ms  accumulated paused milliseconds
--   submissions_suppressed     true when an admin explicitly disabled the portal
--
-- Safe to re-run. Depends on migrations 027 and 028.
-- ═══════════════════════════════════════════════════════════════════

insert into public.settings (key, value) values
  ('dev_timer_paused_at',       '0'::jsonb),
  ('dev_timer_paused_total_ms', '0'::jsonb),
  ('submissions_suppressed',    'false'::jsonb)
on conflict (key) do nothing;


-- ─────────────────────────────────────────────────────────────
-- 1. get_contest_flow_state() — pause-aware authoritative state
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_contest_flow_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base            integer;
  v_addon           integer;
  v_total           integer;
  v_started_ms      bigint;
  v_paused_at_ms    bigint;
  v_paused_total_ms bigint;
  v_now_ms          bigint;
  v_elapsed_ms      bigint;
  v_remaining       integer;
  v_enabled         boolean;
  v_manual          boolean;
  v_suppressed      boolean;
  v_paused          boolean;
  v_status          text;
begin
  v_base := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);
  v_addon := greatest(public.get_setting_int('admin_dev_addon_seconds', 0), 0);
  v_total := v_base + v_addon;

  v_enabled    := public.get_setting_bool('submissions_enabled', false);
  v_manual     := public.get_setting_bool('submissions_manually_enabled', false);
  v_suppressed := public.get_setting_bool('submissions_suppressed', false);

  v_started_ms      := public.get_setting_bigint('dev_timer_started_at', 0);
  v_paused_at_ms    := public.get_setting_bigint('dev_timer_paused_at', 0);
  v_paused_total_ms := greatest(public.get_setting_bigint('dev_timer_paused_total_ms', 0), 0);
  v_now_ms          := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_paused          := v_paused_at_ms > 0;

  if v_started_ms > 0 then
    -- While paused the clock is frozen at dev_timer_paused_at.
    v_elapsed_ms := greatest(
      0,
      (case when v_paused then v_paused_at_ms else v_now_ms end)
        - v_started_ms
        - v_paused_total_ms
    );
    v_remaining := greatest(0, v_total - floor(v_elapsed_ms / 1000.0)::integer);

    -- Idempotent automatic enablement during the final 20 minutes.
    -- Paused timers and an explicit admin Disable both suppress it.
    if (not v_paused)
       and v_remaining <= (20 * 60)
       and (not v_enabled)
       and (not v_manual)
       and (not v_suppressed) then
      update public.settings
      set value = to_jsonb(true)
      where key = 'submissions_enabled'
        and public.get_setting_bool('submissions_enabled', false) = false;
      v_enabled := true;
    end if;

    if v_remaining <= 0 then
      v_status := 'finished';
    elsif v_paused then
      v_status := 'paused';
    else
      v_status := 'running';
    end if;
  else
    v_remaining := v_total;
    v_status := 'not_started';
  end if;

  return jsonb_build_object(
    'dev_timer_started_at_ms', nullif(v_started_ms, 0::bigint),
    'dev_timer_paused_at_ms', nullif(v_paused_at_ms, 0::bigint),
    'dev_timer_paused_total_seconds', floor(v_paused_total_ms / 1000.0)::integer,
    'dev_timer_total_seconds', v_total,
    'dev_timer_remaining_seconds', v_remaining,
    'dev_timer_status', v_status,
    'submissions_enabled', case when v_suppressed then false else v_enabled end,
    'submissions_manually_enabled', v_manual,
    'submissions_suppressed', v_suppressed,
    'submissions_source', case
      when v_suppressed then 'none'
      when v_manual then 'manual'
      when v_enabled then 'auto'
      else 'none'
    end,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_contest_flow_state() from public;
grant execute on function public.get_contest_flow_state() to authenticated, anon, service_role;

comment on function public.get_contest_flow_state() is
  'Authoritative contest flow state: pause-aware development timer + submissions flags. '
  'Auto-enables submissions while running in the final 20 minutes unless disabled.';


-- ─────────────────────────────────────────────────────────────
-- 2. start_dev_timer() — start a fresh timer OR resume a paused one
-- ─────────────────────────────────────────────────────────────
create or replace function public.start_dev_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_ms      bigint;
  v_paused_at_ms    bigint;
  v_paused_total_ms bigint;
  v_now_ms          bigint;
  v_resumed         boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to start the development timer.';
  end if;

  v_started_ms      := public.get_setting_bigint('dev_timer_started_at', 0);
  v_paused_at_ms    := public.get_setting_bigint('dev_timer_paused_at', 0);
  v_paused_total_ms := greatest(public.get_setting_bigint('dev_timer_paused_total_ms', 0), 0);
  v_now_ms          := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  if v_started_ms = 0 then
    -- Start a fresh run.
    insert into public.settings (key, value)
    values
      ('dev_timer_started_at', to_jsonb(v_now_ms)),
      ('dev_timer_paused_at', to_jsonb(0)),
      ('dev_timer_paused_total_ms', to_jsonb(0))
    on conflict (key) do update set value = excluded.value;

    insert into public.audit_log (actor_id, action, entity_type, details, created_at)
    values (
      auth.uid(), 'dev_timer_started', 'settings',
      jsonb_build_object('started_at_ms', v_now_ms),
      clock_timestamp()
    );
  elsif v_paused_at_ms > 0 then
    -- Resume: bank the elapsed pause and clear the pause marker.
    update public.settings
    set value = to_jsonb(v_paused_total_ms + greatest(0, v_now_ms - v_paused_at_ms))
    where key = 'dev_timer_paused_total_ms';

    update public.settings
    set value = to_jsonb(0)
    where key = 'dev_timer_paused_at';

    v_resumed := true;

    insert into public.audit_log (actor_id, action, entity_type, details, created_at)
    values (
      auth.uid(), 'dev_timer_resumed', 'settings',
      jsonb_build_object(
        'paused_at_ms', v_paused_at_ms,
        'resumed_at_ms', v_now_ms,
        'paused_total_ms', v_paused_total_ms + greatest(0, v_now_ms - v_paused_at_ms)
      ),
      clock_timestamp()
    );
  end if;

  -- Running (or finished): idempotent no-op.
  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.start_dev_timer() from public;
grant execute on function public.start_dev_timer() to authenticated;

comment on function public.start_dev_timer() is
  'Admin starts a fresh development timer, or resumes a paused one. Idempotent while running.';


-- ─────────────────────────────────────────────────────────────
-- 3. pause_dev_timer() — freeze the clock without losing progress
-- ─────────────────────────────────────────────────────────────
create or replace function public.pause_dev_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state  jsonb;
  v_now_ms bigint;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to pause the development timer.';
  end if;

  v_state := public.get_contest_flow_state();

  -- Only a running timer can be paused; everything else is a no-op.
  if (v_state ->> 'dev_timer_status') <> 'running' then
    return v_state;
  end if;

  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  insert into public.settings (key, value)
  values ('dev_timer_paused_at', to_jsonb(v_now_ms))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(), 'dev_timer_paused', 'settings',
    jsonb_build_object('paused_at_ms', v_now_ms),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.pause_dev_timer() from public;
grant execute on function public.pause_dev_timer() to authenticated;

comment on function public.pause_dev_timer() is
  'Admin freezes the development timer. Resume with start_dev_timer().';


-- ─────────────────────────────────────────────────────────────
-- 4. reset_dev_timer() — clears the dev clock AND the submission portal
-- ─────────────────────────────────────────────────────────────
create or replace function public.reset_dev_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to reset the development timer.';
  end if;

  insert into public.settings (key, value)
  values
    ('dev_timer_started_at', to_jsonb(0)),
    ('dev_timer_paused_at', to_jsonb(0)),
    ('dev_timer_paused_total_ms', to_jsonb(0)),
    ('submissions_enabled', to_jsonb(false)),
    ('submissions_manually_enabled', to_jsonb(false)),
    ('submissions_suppressed', to_jsonb(false))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'dev_timer_reset',
    'settings',
    jsonb_build_object(
      'reason', 'Admin reset the development timer.',
      'submissions_reset', true
    ),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.reset_dev_timer() from public;
grant execute on function public.reset_dev_timer() to authenticated;

comment on function public.reset_dev_timer() is
  'Admin clears the development timer (including pause state) and closes/resets the submission portal.';


-- ─────────────────────────────────────────────────────────────
-- 5. enable_submissions() — manual open, clears an explicit disable
-- ─────────────────────────────────────────────────────────────
create or replace function public.enable_submissions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to enable submissions.';
  end if;

  insert into public.settings (key, value)
  values
    ('submissions_enabled', to_jsonb(true)),
    ('submissions_manually_enabled', to_jsonb(true)),
    ('submissions_suppressed', to_jsonb(false))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'submissions_enabled',
    'settings',
    jsonb_build_object('source', 'manual'),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.enable_submissions() from public;
grant execute on function public.enable_submissions() to authenticated;

comment on function public.enable_submissions() is
  'Admin enables the submission portal; submissions_source becomes "manual".';


-- ─────────────────────────────────────────────────────────────
-- 6. disable_submissions() — manual close that survives auto-enable
-- ─────────────────────────────────────────────────────────────
create or replace function public.disable_submissions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required to disable submissions.';
  end if;

  insert into public.settings (key, value)
  values
    ('submissions_enabled', to_jsonb(false)),
    ('submissions_manually_enabled', to_jsonb(false)),
    ('submissions_suppressed', to_jsonb(true))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_log (actor_id, action, entity_type, details, created_at)
  values (
    auth.uid(),
    'submissions_disabled',
    'settings',
    jsonb_build_object('source', 'manual'),
    clock_timestamp()
  );

  return public.get_contest_flow_state();
end;
$$;

revoke all on function public.disable_submissions() from public;
grant execute on function public.disable_submissions() to authenticated;

comment on function public.disable_submissions() is
  'Admin closes the submission portal. Suppresses the automatic last-20-minute enablement until re-enabled or reset.';


-- ─────────────────────────────────────────────────────────────
-- 7. get_team_dev_deadline() — deadline slides while paused
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_team_dev_deadline(p_team_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select
      public.get_setting_bigint('dev_timer_started_at', 0)                      as started_ms,
      public.get_setting_bigint('dev_timer_paused_at', 0)                       as paused_at_ms,
      greatest(public.get_setting_bigint('dev_timer_paused_total_ms', 0), 0)    as paused_total_ms,
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint               as now_ms
  )
  select case
    when s.started_ms > 0 then
      to_timestamp(s.started_ms / 1000.0)
        + make_interval(secs => public.get_team_dev_duration_seconds(p_team_id))
        + (s.paused_total_ms * interval '1 millisecond')
        + case
            when s.paused_at_ms > 0
              then (s.now_ms - s.paused_at_ms) * interval '1 millisecond'
            else interval '0'
          end
    else null
  end
  from s;
$$;

revoke all on function public.get_team_dev_deadline(uuid) from public;
grant execute on function public.get_team_dev_deadline(uuid) to authenticated, service_role;

comment on function public.get_team_dev_deadline(uuid) is
  'Team deadline = start + duration + accumulated pause (+ the current pause while active).';


-- ─────────────────────────────────────────────────────────────
-- 8. get_team_dev_status() — exposes the paused state to teams
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_team_dev_status(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_ms  bigint;
  v_paused_at_ms bigint;
  v_total       integer;
  v_remaining   integer;
  v_deadline    timestamptz;
  v_opens_at    timestamptz;
  v_status      text;
  v_has_sub     boolean;
  v_window_open boolean;
  v_dq_at       timestamptz;
  v_dq_pending  boolean;
  v_server_time timestamptz;
  v_paused      boolean;
begin
  perform public.apply_dq_statuses();

  v_total        := public.get_team_dev_duration_seconds(p_team_id);
  v_started_ms   := public.get_setting_bigint('dev_timer_started_at', 0);
  v_paused_at_ms := public.get_setting_bigint('dev_timer_paused_at', 0);
  v_paused       := v_paused_at_ms > 0;
  v_deadline     := public.get_team_dev_deadline(p_team_id);
  v_server_time  := clock_timestamp();

  if v_deadline is null then
    v_status := 'not_started';
    v_remaining := 0;
  else
    v_remaining := greatest(0, floor(extract(epoch from (v_deadline - v_server_time))))::integer;
    v_status := case
      when v_remaining = 0 then 'finished'
      when v_paused then 'paused'
      else 'running'
    end;
  end if;

  v_opens_at := v_deadline - interval '20 minutes';

  select exists(select 1 from public.submissions s where s.team_id = p_team_id) into v_has_sub;
  select t.dq_at into v_dq_at from public.teams t where t.id = p_team_id;

  v_window_open := v_deadline is not null
    and (not v_paused)
    and v_dq_at is null
    and v_server_time <= v_deadline
    and v_opens_at is not null
    and v_server_time >= v_opens_at;

  v_dq_pending := v_dq_at is null
    and (not v_paused)
    and v_deadline is not null
    and v_deadline < v_server_time
    and not v_has_sub;

  return jsonb_build_object(
    'team_id', p_team_id,
    'dev_timer_started_at_ms', nullif(v_started_ms, 0),
    'dev_timer_paused_at_ms', nullif(v_paused_at_ms, 0),
    'dev_addon_seconds', (
      select coalesce(t.dev_addon_seconds, public.get_setting_int('admin_dev_addon_seconds', 0))
      from public.teams t
      where t.id = p_team_id
    ),
    'dev_timer_total_seconds', v_total,
    'dev_timer_remaining_seconds', v_remaining,
    'dev_timer_status', v_status,
    'dev_deadline', v_deadline,
    'submission_opens_at', v_opens_at,
    'dq_at', v_dq_at,
    'dq_pending', v_dq_pending,
    'has_submission', v_has_sub,
    'submission_window_open', v_window_open,
    'server_time', v_server_time
  );
end;
$$;

revoke all on function public.get_team_dev_status(uuid) from public;
grant execute on function public.get_team_dev_status(uuid) to authenticated, service_role;

comment on function public.get_team_dev_status(uuid) is
  'Returns the team-specific development timer and submission window state (pause-aware, auto-applies DQ).';


notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════
-- 031 · Per-team development add-on configuration
-- ═══════════════════════════════════════════════════════════════════
-- The admin "Development Time Add-on" was global: every team received the
-- same value. Teams now need individual add-ons (for example, only the teams
-- that solve the hardcore problems get extra time).
--
-- Data model (from migration 028):
--   teams.dev_addon_seconds NULL  -> inherit admin_dev_addon_seconds
--   teams.dev_addon_seconds value -> per-team override, in seconds
--
-- This migration only redefines get_bidding_results() so the admin results
-- table can show and edit the override per team. The existing
-- set_team_dev_addon_seconds(team_id, seconds) RPC already writes the column.
--
-- It also fixes a reporting bug: total_addon_dev_seconds previously included
-- earned bonus time, so the table counted bonuses twice (once as "Admin
-- Add-on" and again as "Add-on Time Earned").
--
-- Safe to re-run. Depends on migrations 027, 028 and 030.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.get_bidding_results()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base        integer;
  v_admin_addon integer;
  v_teams       jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read bidding results';
  end if;

  v_base := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);
  v_admin_addon := greatest(public.get_setting_int('admin_dev_addon_seconds', 0), 0);

  select coalesce(jsonb_agg(team_obj order by team_name), '[]'::jsonb)
  into v_teams
  from (
    select
      t.name as team_name,
      jsonb_build_object(
        'team_id',        t.id,
        'team_name',      t.name,
        'dq_at',          t.dq_at,
        'captain_name',   cap.name,
        'captain_usn',    upper(split_part(coalesce(cap.email, ''), '@', 1)),
        'members',        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name',       m.name,
              'usn',        upper(split_part(coalesce(m.email, ''), '@', 1)),
              'is_captain', m.id = t.captain_id
            ) order by m.created_at
          )
          from public.members m
          where m.team_id = t.id
        ), '[]'::jsonb),
        'member_count',   (select count(*) from public.members m where m.team_id = t.id),
        'registered_at',  t.created_at,
        'balance',        coalesce(w.balance, 0),
        'eliminated',     public.team_is_eliminated(t.id),
        'qualified',      (agg.won_count >= 2),
        'elimination_reason', (
          select reason from public.team_eliminations
          where team_id = t.id and restored_at is null
          order by eliminated_at desc limit 1
        ),
        'total_spent',    coalesce((
          select sum(-wt.amount)
          from public.wallet_transactions wt
          where wt.team_id = t.id and wt.tx_type = 'win_deduction'
        ), 0),
        'problems',       coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'slot_id',         s.id,
              'question_number', s.question_number,
              'round',           s.round,
              'difficulty',      tp.level,
              'topic_title',     tp.title,
              'winning_bid',     s.current_bid,
              'status',          s.status,
              'sold_at',         s.sold_at,
              'base_dev_seconds',  v_base,
              'bonus_dev_seconds', coalesce((
                select sum(b.bonus_seconds)
                from public.bonus_transactions b
                where b.slot_id = s.id and b.team_id = t.id
              ), 0),
              'total_dev_seconds', v_base
                + coalesce(t.dev_addon_seconds, v_admin_addon)
                + coalesce((
                    select sum(b.bonus_seconds)
                    from public.bonus_transactions b
                    where b.slot_id = s.id and b.team_id = t.id
                  ), 0)
            ) order by s.round, s.question_number nulls last, s.id
          )
          from public.slots s
          join public.topics tp on tp.id = s.topic_id
          where s.winner_team_id = t.id and s.status = 'sold'
        ), '[]'::jsonb),
        'won_count',                agg.won_count,
        -- NULL means this team inherits the global admin add-on.
        'dev_addon_seconds',        t.dev_addon_seconds,
        'admin_addon_dev_seconds',  v_admin_addon,
        -- Effective add-on only (bonus time is reported separately below).
        'total_addon_dev_seconds',  coalesce(t.dev_addon_seconds, v_admin_addon),
        'total_base_dev_seconds',   v_base,
        'total_bonus_dev_seconds',  agg.bonus_dev_seconds,
        'total_dev_seconds',        v_base
          + coalesce(t.dev_addon_seconds, v_admin_addon)
          + agg.bonus_dev_seconds
      ) as team_obj
    from public.teams t
    left join public.wallets w on w.team_id = t.id
    left join lateral (
      select m.*
      from public.members m
      where m.team_id = t.id
      order by (m.id = t.captain_id) desc, m.created_at asc
      limit 1
    ) cap on true
    left join lateral (
      select
        count(*) as won_count,
        coalesce(sum((
          select coalesce(sum(b.bonus_seconds), 0)
          from public.bonus_transactions b
          where b.slot_id = s.id and b.team_id = t.id
        )), 0) as bonus_dev_seconds
      from public.slots s
      where s.winner_team_id = t.id and s.status = 'sold'
    ) agg on true
  ) q;

  return jsonb_build_object(
    'teams',                    coalesce(v_teams, '[]'::jsonb),
    'base_dev_seconds',          v_base,
    'admin_dev_addon_seconds',   v_admin_addon,
    'server_time',               clock_timestamp()
  );
end;
$$;

revoke all on function public.get_bidding_results() from public;
grant execute on function public.get_bidding_results() to authenticated, service_role;

comment on function public.get_bidding_results() is
  'Admin results feed. Each team exposes its per-team dev_addon_seconds override, the global default, the effective add-on, bonus time, and totals.';

notify pgrst, 'reload schema';
