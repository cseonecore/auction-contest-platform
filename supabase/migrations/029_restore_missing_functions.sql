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
