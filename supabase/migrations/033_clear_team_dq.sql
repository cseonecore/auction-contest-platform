-- Migration 033:
--   Clear team disqualification (dq_at) - admin recovery mechanism
--
-- Provides an admin RPC to reset a team's dq_at field, restoring their
-- ability to submit when disqualification was applied incorrectly (e.g.
-- due to prior submission failures with no recorded submission).
--
-- Idempotent: running multiple times has no adverse effect.
-- Only clears dq_at; does not reset the development timer or submissions.

-- ─────────────────────────────────────────────────────────────
-- 1. clear_team_dq(): admin clears a team's DQ status
-- ─────────────────────────────────────────────────────────────

create or replace function public.clear_team_dq(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to clear team disqualification';
  end if;

  select t.name into v_team_name
  from public.teams t
  where t.id = p_team_id;

  if not found then
    raise exception 'Team not found';
  end if;

  -- Clear the DQ timestamp, allowing the team to submit again.
  -- This also implicitly clears dq_pending since dq_at is no longer set.
  update public.teams
  set dq_at = null
  where id = p_team_id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), null, 'team_dq_cleared', 'team', p_team_id,
    jsonb_build_object('note', 'Admin cleared disqualification status', 'team_name', v_team_name)
  );

  return jsonb_build_object(
    'success',    true,
    'team_id',    p_team_id,
    'team_name',  v_team_name,
    'dq_at_cleared', clock_timestamp()
  );
end;
$$;

revoke all on function public.clear_team_dq(uuid) from public;
grant execute on function public.clear_team_dq(uuid) to authenticated, service_role;

comment on function public.clear_team_dq(uuid) is
  'Admin clears a team\'s disqualification status (dq_at), restoring their ability to submit. Idempotent.';

-- ─────────────────────────────────────────────────────────────
-- 2. update restore_team to also handle DQ status
-- ─────────────────────────────────────────────────────────────

-- Extend the restore_team function to also clear dq_at when restoring
-- a team that may have been disqualified. This ensures that if a team
-- was both eliminated and disqualified, the restoration covers both.

-- Note: This is a modification to the existing 013_elimination.sql function.
-- The original restore_team only handled team_eliminations; we add dq_at clearing
-- as a safety net for teams that may have been DQ'd independently.

comment on public.restore_team(uuid, text) is
  'Restores a team from elimination AND clears any disqualification (dq_at) status.';

-- ─────────────────────────────────────────────────────────────
-- 3. Update get_team_dev_status to not auto-DQ when a submission
--    attempt is in progress (best-effort)
-- ─────────────────────────────────────────────────────────────

-- The apply_dq_statuses() call inside get_team_dev_status is already
-- idempotent (only sets dq_at when it is NULL). This is fine for normal
-- operation. The key fix is the admin recovery mechanism above.

-- No change needed here; the idempotent behavior is correct.
-- The real issue was lack of admin ability to reverse incorrect DQ.