-- Migration 034:
--   1. Make teams.locked an admin-controlled flag again.
--      Migration 026 derived `locked` from the Top 25 ranking with triggers on
--      teams/slots, so ANY manual unlock was instantly reverted. That made the
--      admin "Unlock selected teams" action a no-op in the database.
--   2. delete_teams(): an admin may delete a team only after explicitly
--      unlocking it. Locked teams stay protected. Top 25 membership is no
--      longer a hard deletion block (it only ever mattered while locks were
--      derived).
--   All other safety checks (bids, slots, submissions, challenge solves) and
--   the audit-log trail are unchanged.
--
-- Run this once in the Supabase SQL editor (or via `supabase db push`).

-- ─────────────────────────────────────────────────────────────
-- 1. Stop deriving teams.locked from the Top 25 ranking
-- ─────────────────────────────────────────────────────────────

drop trigger if exists trg_sync_top25_locks_teams on public.teams;
drop trigger if exists trg_sync_top25_locks_slots on public.slots;

drop function if exists public.trg_sync_top25_locks_teams_fn();
drop function if exists public.trg_sync_top25_locks_slots_fn();
drop function if exists public.sync_top25_team_locks();

-- get_top25_team_ids() is kept for reference/reporting; nothing calls it now.
comment on function public.get_top25_team_ids() is
  'Returns the ids of the Top 25 teams by total acquired spend (informational only; no longer drives teams.locked).';

-- ─────────────────────────────────────────────────────────────
-- 2. delete_teams(): only explicitly unlocked teams may be deleted
-- ─────────────────────────────────────────────────────────────

create or replace function public.delete_teams(p_team_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_team record;
  v_deduped_ids uuid[];
  v_found_count integer := 0;
  v_deleted_count integer := 0;
  v_deleted_teams jsonb := '[]'::jsonb;
  v_member_count integer;
  v_bids_count integer;
  v_slots_count integer;
  v_submissions_count integer;
  v_solves_count integer;
  v_captain_usn text;
begin
  -- 1. Verify administrator privileges
  if not public.is_admin() then
    raise exception 'Unauthorized: Administrator privileges required to delete teams.';
  end if;

  v_admin_id := (select auth.uid());

  -- 2. Validate input array
  if p_team_ids is null or array_length(p_team_ids, 1) is null or array_length(p_team_ids, 1) = 0 then
    raise exception 'Validation error: No team IDs provided for deletion.';
  end if;

  -- Normalize and deduplicate input IDs
  select coalesce(array_agg(distinct id), '{}'::uuid[])
  into v_deduped_ids
  from unnest(p_team_ids) as id;

  if array_length(v_deduped_ids, 1) is null or array_length(v_deduped_ids, 1) = 0 then
    raise exception 'Validation error: Provided team IDs list is empty.';
  end if;

  -- 3. Verify that all target teams exist and acquire row-level lock (FOR UPDATE)
  for v_team in
    select id, name, captain_id, locked
    from public.teams
    where id = any(v_deduped_ids)
    for update
  loop
    v_found_count := v_found_count + 1;

    -- Invariant: a team must be unlocked by the admin before it can be deleted.
    if v_team.locked then
      raise exception 'Safety violation: Team "%" (%) is locked. Unlock it before deleting.',
        v_team.name, v_team.id;
    end if;

    -- Protected Record Check 1: Auction Bids
    select count(*) into v_bids_count
    from public.bids
    where team_id = v_team.id;

    if v_bids_count > 0 then
      raise exception 'Protected record violation: Team "%" has % recorded auction bid(s). Teams with auction bids cannot be deleted.',
        v_team.name, v_bids_count;
    end if;

    -- Protected Record Check 2: Auction Slot Allocations (as leader or winner)
    select count(*) into v_slots_count
    from public.slots
    where leader_team_id = v_team.id or winner_team_id = v_team.id;

    if v_slots_count > 0 then
      raise exception 'Protected record violation: Team "%" is linked to % auction slot(s) as leader or winner. Teams with slot allocations cannot be deleted.',
        v_team.name, v_slots_count;
    end if;

    -- Protected Record Check 3: Project Submissions
    select count(*) into v_submissions_count
    from public.submissions
    where team_id = v_team.id;

    if v_submissions_count > 0 then
      raise exception 'Protected record violation: Team "%" has % submitted project(s). Teams with project submissions cannot be deleted.',
        v_team.name, v_submissions_count;
    end if;

    -- Protected Record Check 4: Challenge Solves
    select count(*) into v_solves_count
    from public.challenge_solves
    where team_id = v_team.id;

    if v_solves_count > 0 then
      raise exception 'Protected record violation: Team "%" has % recorded challenge solve(s). Teams with challenge solves cannot be deleted.',
        v_team.name, v_solves_count;
    end if;
  end loop;

  -- Verify all requested IDs were found in the database
  if v_found_count <> array_length(v_deduped_ids, 1) then
    raise exception 'Validation error: One or more provided team IDs do not exist in the database.';
  end if;

  -- 4. Record tamper-proof audit log entries and gather metadata prior to deletion
  for v_team in
    select id, name, captain_id
    from public.teams
    where id = any(v_deduped_ids)
  loop
    -- Count team members
    select count(*) into v_member_count
    from public.members
    where team_id = v_team.id;

    -- Safe captain USN extraction
    v_captain_usn := null;
    if v_team.captain_id is not null then
      select split_part(email, '@', 1) into v_captain_usn
      from public.members
      where id = v_team.captain_id;
    end if;

    if v_captain_usn is null then
      select split_part(email, '@', 1) into v_captain_usn
      from public.members
      where team_id = v_team.id
      order by created_at asc
      limit 1;
    end if;

    -- Insert unforgeable audit record
    insert into public.audit_log (
      actor_id,
      action,
      entity_type,
      entity_id,
      details,
      created_at
    ) values (
      v_admin_id,
      'team_deleted',
      'team',
      v_team.id,
      jsonb_build_object(
        'team_name', v_team.name,
        'team_id', v_team.id,
        'deleted_members_count', coalesce(v_member_count, 0),
        'captain_usn', coalesce(upper(v_captain_usn), 'N/A'),
        'deleted_at', now()
      ),
      now()
    );

    v_deleted_teams := v_deleted_teams || jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'members_count', coalesce(v_member_count, 0)
    );
    v_deleted_count := v_deleted_count + 1;
  end loop;

  -- 5. Execute atomic deletion
  -- Cascades cleanly to members and wallets
  delete from public.teams
  where id = any(v_deduped_ids);

  -- 6. Return structured result
  return jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'deleted_teams', v_deleted_teams
  );
end;
$$;

comment on function public.delete_teams(uuid[]) is
  'Safely deletes unlocked teams after validating absence of auction bids, slot allocations, submissions, and challenge solves, recording full audit history.';

revoke all on function public.delete_teams(uuid[]) from public;
grant execute on function public.delete_teams(uuid[]) to authenticated;
