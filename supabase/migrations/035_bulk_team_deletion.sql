-- Migration 035:
--   Bulk team deletion in a single confirm/transaction.
--
--   Migration 034's delete_teams() aborted the WHOLE batch as soon as one
--   selected team had auction bids, won slots, a submission, or a challenge
--   solve. Admins therefore had to remove one blocked team at a time and
--   re-confirm repeatedly, which felt like a per-team confirmation loop.
--
--   This version deletes every selected team in one transaction:
--     * locked teams are still refused (unlock them first, as before);
--     * bids placed by the deleted teams are removed;
--     * slot leader/winner references are cleared;
--     * submissions, challenge solves, members, wallets, wallet
--       transactions, eliminations and bonus transactions cascade-delete.
--   The audit log records, for every deleted team, how many bids, slots,
--   submissions and solves were attached before removal.
--
-- Run once in the Supabase SQL editor (or via `supabase db query --remote --file ...`).

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
  v_locked_names text;
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

  -- 3. Verify every target team exists and acquire row-level locks
  for v_team in
    select id, name, locked
    from public.teams
    where id = any(v_deduped_ids)
    for update
  loop
    v_found_count := v_found_count + 1;
  end loop;

  if v_found_count <> array_length(v_deduped_ids, 1) then
    raise exception 'Validation error: One or more provided team IDs do not exist in the database.';
  end if;

  -- 4. Locked teams must be unlocked by the admin first (single clear error)
  select string_agg(name, ', ' order by name)
  into v_locked_names
  from public.teams
  where id = any(v_deduped_ids) and locked;

  if v_locked_names is not null then
    raise exception 'Safety violation: % team(s) are still locked (%). Unlock them before deleting.',
      (select count(*) from public.teams where id = any(v_deduped_ids) and locked),
      v_locked_names;
  end if;

  -- 5. Audit + metadata, then delete everything in one statement
  for v_team in
    select id, name, captain_id
    from public.teams
    where id = any(v_deduped_ids)
  loop
    select count(*) into v_member_count from public.members where team_id = v_team.id;
    select count(*) into v_bids_count from public.bids where team_id = v_team.id;
    select count(*) into v_slots_count
      from public.slots
      where leader_team_id = v_team.id or winner_team_id = v_team.id;
    select count(*) into v_submissions_count from public.submissions where team_id = v_team.id;
    select count(*) into v_solves_count from public.challenge_solves where team_id = v_team.id;

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
        'deleted_bids_count', coalesce(v_bids_count, 0),
        'cleared_slots_count', coalesce(v_slots_count, 0),
        'deleted_submissions_count', coalesce(v_submissions_count, 0),
        'deleted_challenge_solves_count', coalesce(v_solves_count, 0),
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

  -- 6. Detach auction references that would otherwise block deletion
  --    (bids and slots use NO ACTION foreign keys, not SET NULL).
  delete from public.bids
  where team_id = any(v_deduped_ids);

  update public.slots
  set leader_team_id = null
  where leader_team_id = any(v_deduped_ids);

  update public.slots
  set winner_team_id = null
  where winner_team_id = any(v_deduped_ids);

  -- 7. Single atomic deletion for the whole selection.
  --    members / wallets / submissions / solves cascade.
  delete from public.teams
  where id = any(v_deduped_ids);

  return jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'deleted_teams', v_deleted_teams
  );
end;
$$;

comment on function public.delete_teams(uuid[]) is
  'Deletes every selected unlocked team in one transaction. Detaches bids and slot leader/winner references; cascades members, wallets, submissions and solves. Records an audit entry per team.';

revoke all on function public.delete_teams(uuid[]) from public;
grant execute on function public.delete_teams(uuid[]) to authenticated;
