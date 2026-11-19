-- ============================================================
-- Migration 022: Transactional Submission Judging RPCs
-- ============================================================
-- Hardens solution judging and evaluation at the database level:
--
-- 1. public.approve_submission()
--    - Enforces score bounds: rejects NULL scores, negative scores,
--      and scores > 100.
--    - Rejects direct approval of rejected submissions without reopening.
--    - Preserves existing evaluation, audit logging, and bonus time awards.
--    - Records approved_by and approved_at.
--
-- 2. public.reject_submission()
--    - Transactional RPC for judge rejection of a participant solution.
--    - Locks the submission FOR UPDATE.
--    - Rejects invalid state transitions (cannot reject approved solution).
--    - Sets submission status = 'rejected' and records judge reason.
--    - Explicitly sets approved_by and approved_at to NULL (rejections must
--      never carry approval metadata).
--    - Atomically updates evaluation to score = 0 with report details.
--    - Writes audit_log entry and emits realtime auction event.
--
-- 3. public.reopen_submission()
--    - Transactional RPC allowing judges to reopen a solution for edits.
--    - Locks the submission FOR UPDATE.
--    - Strictly permits reopening ONLY when current status is 'rejected'.
--    - Rejects reopening submitted, evaluating, evaluated, review, or approved submissions.
--    - Sets submission status = 'submitted' and preserves judge notes.
--    - Clears stale approval metadata (approved_by, approved_at = NULL).
--    - Safely handles missing evaluations by upserting an evaluation row
--      with status = 'review', ensuring it is excluded from leaderboard scores
--      while revisions are underway.
--    - Writes audit_log entry and emits realtime auction event.
--
-- Authorisation:
--    All three functions are SECURITY DEFINER with set search_path = ''
--    and verify public.is_admin_or_judge(). Execution is revoked from
--    PUBLIC and granted strictly to authenticated and service_role.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Hardened approve_submission
-- ─────────────────────────────────────────────────────────────
create or replace function public.approve_submission(
  p_submission_id uuid,
  p_score         numeric default 0,
  p_notes         text default null,
  p_grant_bonus   boolean default false
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
begin
  -- 1. Authorisation check (judge or admin only)
  if not public.is_admin_or_judge() then
    raise exception 'Judge or admin access required to approve a solution';
  end if;

  -- 2. Input validation
  if p_submission_id is null then
    raise exception 'A submission is required';
  end if;

  if p_score is null or p_score < 0 or p_score > 100 then
    raise exception 'Evaluation score must be a number between 0 and 100';
  end if;

  -- 3. Lock target submission row
  select * into v_submission
  from public.submissions s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found';
  end if;

  -- 4. Status transition validation
  if v_submission.status = 'rejected' then
    raise exception 'Cannot approve a rejected submission directly. It must be reopened first';
  end if;

  -- 5. Validate linked slot ownership
  select * into v_slot
  from public.slots s
  where s.id = v_submission.slot_id;

  if not found then
    raise exception 'Assigned auction item not found for this submission';
  end if;

  if v_slot.winner_team_id is null or v_slot.winner_team_id <> v_submission.team_id then
    raise exception 'Submission is not linked to a question owned by this team';
  end if;

  -- 6. Atomically update submission with approval metadata
  update public.submissions
  set status       = 'approved',
      approved_by  = auth.uid(),
      approved_at  = clock_timestamp(),
      judge_notes  = coalesce(nullif(trim(p_notes), ''), v_submission.judge_notes)
  where id = p_submission_id;

  -- 7. Record / update evaluation (competition score)
  insert into public.evaluations (submission_id, score, report, evaluator_version, status)
  values (
    p_submission_id, p_score,
    jsonb_build_object('notes', p_notes, 'approved_by', auth.uid()),
    'manual', 'completed'
  )
  on conflict (submission_id) do update
    set score             = excluded.score,
        report            = coalesce(public.evaluations.report, '{}'::jsonb) || excluded.report,
        evaluator_version = excluded.evaluator_version,
        status            = 'completed',
        evaluated_at      = clock_timestamp();

  -- 8. Write audit record
  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_submission.team_id, 'solution_approved', 'submission', p_submission_id,
    jsonb_build_object('score', p_score, 'notes', p_notes, 'slot_id', v_slot.id)
  );

  -- 9. Optional bonus time award (handled atomically)
  v_bonus := NULL;
  if coalesce(p_grant_bonus, false) then
    v_bonus := public.grant_bonus_time(p_submission_id, p_notes);
  end if;

  -- 10. Emit realtime event if available
  begin
    perform public.emit_auction_event(
      'solution_approved',
      v_slot.id,
      v_submission.team_id,
      jsonb_build_object('submission_id', p_submission_id, 'score', p_score)
    );
  exception
    when undefined_function then null;
  end;

  return jsonb_build_object(
    'success',       true,
    'submission_id', p_submission_id,
    'score',         p_score,
    'bonus',         v_bonus
  );
end;
$$;

revoke all on function public.approve_submission(uuid, numeric, text, boolean) from public;
grant execute on function public.approve_submission(uuid, numeric, text, boolean) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 2. Transactional reject_submission
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
-- 3. Transactional reopen_submission
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
  -- Reject submitted, evaluating, evaluated, review, and approved submissions.
  if v_submission.status <> 'rejected' then
    raise exception 'Only rejected submissions can be reopened for revision (current status: %)', v_submission.status;
  end if;

  -- 4. Atomically update submission back to 'submitted'
  -- Preserves existing judge notes if no new notes were provided, and ensures approval metadata is NULL.
  update public.submissions
  set status      = 'submitted',
      judge_notes = coalesce(v_notes, v_submission.judge_notes),
      approved_by = null,
      approved_at = null
  where id = p_submission_id;

  -- 5. Atomically update or insert evaluation:
  -- Handles missing evaluations safely by upserting.
  -- Sets status = 'review' so the submission does NOT contribute to competition score while revisions are underway.
  -- Preserves prior evaluation history/report details.
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
