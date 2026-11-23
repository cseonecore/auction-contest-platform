-- Migration 026:
--   1. Base development time = 1 hour 15 minutes (75 min / 4500 s) by default,
--      configurable via the admin-managed setting `admin_dev_addon_seconds`.
--   2. Top 25 team locking: get_top25_team_ids() + sync_top25_team_locks() +
--      automatic triggers on teams/slots so locks track the ranking.
--   3. delete_teams(): Top 25 teams cannot be deleted.
--   4. get_bidding_results(): add-on time is reflected in the displayed totals.
--   5. get_live_auction_state(): teams now carry character_index for the
--      leaderboard profile pictures.
--
-- Top 25 definition: the 25 teams with the highest total acquired spend
-- (sum of won slot winning bids), ties broken by name then id.

-- ─────────────────────────────────────────────────────────────
-- 1. Settings: base dev time default (75 min) and the new add-on key
-- ─────────────────────────────────────────────────────────────

insert into public.settings (key, value)
values
  ('admin_dev_addon_seconds', '0'::jsonb)
on conflict (key) do nothing;

-- The base development time is 1 hour 15 minutes by default. Only rows that
-- are still at the old default are moved — an admin's customized base value
-- (solving_timer_seconds) is respected.
update public.settings
set value = '4500'::jsonb
where key = 'solving_timer_seconds' and value = '120'::jsonb;

-- ─────────────────────────────────────────────────────────────
-- 2. get_setting_bool helper (mirror of public.get_setting_int)
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_setting_bool(p_key text, p_default boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw  jsonb;
  v_str  text;
begin
  select value into v_raw
  from public.settings
  where key = p_key;

  if v_raw is null then
    return p_default;
  end if;

  v_str := lower(coalesce(v_raw #>> '{}', ''));

  if v_str in ('true', 't', 'yes', 'y', '1') then
    return true;
  end if;
  if v_str in ('false', 'f', 'no', 'n', '0') then
    return false;
  end if;

  if jsonb_typeof(v_raw) = 'object' then
    v_str := lower(coalesce(v_raw ->> 'enabled', v_raw ->> 'value'));
    if v_str in ('true', 't', 'yes', 'y', '1') then
      return true;
    end if;
    if v_str in ('false', 'f', 'no', 'n', '0') then
      return false;
    end if;
  end if;

  return p_default;
end;
$$;

revoke all on function public.get_setting_bool(text, boolean) from public;
grant execute on function public.get_setting_bool(text, boolean) to authenticated, anon, service_role;

comment on function public.get_setting_bool(text, boolean) is
  'Reads a boolean setting from public.settings with a safe default.';

-- ─────────────────────────────────────────────────────────────
-- 3. Top 25 machinery
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_top25_team_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_top25 uuid[];
begin
  select coalesce(array_agg(x.id), '{}'::uuid[])
  into v_top25
  from (
    select t.id
    from public.teams t
    order by (
           select coalesce(sum(s.current_bid), 0)
           from public.slots s
           where s.winner_team_id = t.id and s.status = 'sold'
         ) desc,
         t.name asc,
         t.id asc
    limit 25
  ) x;

  return coalesce(v_top25, '{}'::uuid[]);
end;
$$;

revoke all on function public.get_top25_team_ids() from public;
grant execute on function public.get_top25_team_ids() to authenticated, anon, service_role;

comment on function public.get_top25_team_ids() is
  'Returns the ids of the Top 25 teams by total acquired spend (limit 25).';

-- Security definer so triggers (running as the mutation user) can update
-- teams.locked even though only admins may update the teams table (RLS).
create or replace function public.sync_top25_team_locks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_top25 uuid[];
begin
  v_top25 := public.get_top25_team_ids();

  update public.teams t
  set locked = (t.id = any(v_top25))
  where t.locked <> (t.id = any(v_top25));
end;
$$;

create or replace function public.trg_sync_top25_locks_teams_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.sync_top25_team_locks();
  return null;
end;
$$;

drop trigger if exists trg_sync_top25_locks_teams on public.teams;

create trigger trg_sync_top25_locks_teams
after insert or update on public.teams
for each row execute function public.trg_sync_top25_locks_teams_fn();

create or replace function public.trg_sync_top25_locks_slots_fn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.sync_top25_team_locks();
  return null;
end;
$$;

drop trigger if exists trg_sync_top25_locks_slots on public.slots;

create trigger trg_sync_top25_locks_slots
after insert or update on public.slots
for each row execute function public.trg_sync_top25_locks_slots_fn();

comment on trigger trg_sync_top25_locks_teams on public.teams is
  'Keeps teams.locked consistent with the Top 25 ranking.';

comment on trigger trg_sync_top25_locks_slots on public.slots is
  'Re-syncs Top 25 locks when won spend can change (slot sales, sales updates).';

-- ─────────────────────────────────────────────────────────────
-- 4. delete_teams(): Top 25 teams cannot be deleted (redefinition)
--    (copy of 010_admin_team_deletion.sql body + Top 25 guard)
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
  v_in_top25 boolean;
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

    -- Invariant: Top 25 teams can NEVER be deleted (per registration rules).
    v_in_top25 := v_team.id = any(public.get_top25_team_ids());
    if v_in_top25 then
      raise exception 'Safety violation: Team "%" (%) is in the Top 25 and cannot be deleted. Leave the Top 25 before deleting.',
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
  'Safely deletes locked, non-Top-25 teams after validating absence of auction bids, slot allocations, submissions, and challenge solves, recording full audit history.';

-- ─────────────────────────────────────────────────────────────
-- 5. get_bidding_results(): development times include the admin add-on
--    (redefinition of 023 with per-problem and team-level add-on totals)
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_bidding_results()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base   integer;
  v_addon  integer;
  v_teams  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read bidding results';
  end if;

  v_base := greatest(public.get_setting_int('solving_timer_seconds', 4500), 0);
  v_addon := greatest(public.get_setting_int('admin_dev_addon_seconds', 0), 0);

  select coalesce(jsonb_agg(team_obj order by team_name), '[]'::jsonb)
  into v_teams
  from (
    select
      t.name as team_name,
      jsonb_build_object(
        'team_id',        t.id,
        'team_name',      t.name,
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
              'total_dev_seconds', v_base + v_addon + coalesce((
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
        'won_count',               agg.won_count,
        'total_base_dev_seconds',  v_base,
        'total_addon_dev_seconds', v_addon + agg.bonus_dev_seconds,
        'total_bonus_dev_seconds', agg.bonus_dev_seconds,
        'total_dev_seconds',       v_base + v_addon + agg.bonus_dev_seconds
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
    'teams',                  coalesce(v_teams, '[]'::jsonb),
    'base_dev_seconds',       v_base,
    'admin_dev_addon_seconds', v_addon,
    'server_time',            clock_timestamp()
  );
end;
$$;

revoke all on function public.get_bidding_results() from public;
grant execute on function public.get_bidding_results() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 6. get_live_auction_state(): include teams.character_index
--    (redefinition of 023 adding the picture source column)
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_live_auction_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session   public.auction_sessions%rowtype;
  v_slot      public.slots%rowtype;
  v_topic     public.topics%rowtype;
  v_leader    text;
  v_winner    text;
  v_teams     jsonb;
  v_bids      jsonb;
  v_settings  jsonb;
  v_events    jsonb;
  v_elims     jsonb;
  v_has_slot  boolean := false;
  v_min_bid   integer := 10;
  v_min_raise integer := 5;
begin
  -- ── 0. Settle any expired item first ────────────────────────
  perform public.settle_expired_slots();

  v_min_bid   := greatest(public.get_setting_int('min_bid', 10), 1);
  v_min_raise := greatest(public.get_setting_int('min_raise', 5), 1);

  select * into v_session from public.get_active_session() limit 1;

  -- Find the active open slot
  select s.* into v_slot
  from public.slots s
  where s.status = 'open'
  order by s.round, s.question_number nulls last, s.id
  limit 1;
  v_has_slot := found;

  if not v_has_slot and v_session.active_slot_id is not null then
    select s.* into v_slot from public.slots s where s.id = v_session.active_slot_id;
    v_has_slot := found;
  end if;

  if v_has_slot and v_slot.topic_id is not null then
    select t.* into v_topic from public.topics t where t.id = v_slot.topic_id;
  end if;

  if v_has_slot and v_slot.leader_team_id is not null then
    select t.name into v_leader from public.teams t where t.id = v_slot.leader_team_id;
  end if;

  if v_has_slot and v_slot.winner_team_id is not null then
    select t.name into v_winner from public.teams t where t.id = v_slot.winner_team_id;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',         b.id,
             'slot_id',    b.slot_id,
             'team_id',    b.team_id,
             'team_name',  coalesce(t.name, 'Unknown team'),
             'amount',     b.amount,
             'server_time', b.server_time
           ) order by b.server_time desc
         ), '[]'::jsonb)
  into v_bids
  from public.bids b
  left join public.teams t on t.id = b.team_id
  where v_has_slot and b.slot_id = v_slot.id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',              t.id,
             'name',            t.name,
             'character_index', t.character_index,
             'balance',         coalesce(w.balance, 0),
             'eliminated',      public.team_is_eliminated(t.id),
             'current_bid',     coalesce(lb.amount, 0),
             'won_count',       coalesce(wq.cnt, 0),
             'qualified',       (coalesce(wq.cnt, 0) >= 2),
             'needs_questions', (coalesce(wq.cnt, 0) < 2)
           ) order by t.name
         ), '[]'::jsonb)
  into v_teams
  from public.teams t
  left join public.wallets w on w.team_id = t.id
  left join lateral (
    select count(*) as cnt
    from public.slots s
    where s.winner_team_id = t.id and s.status = 'sold'
  ) wq on true
  left join lateral (
    select max(b.amount) as amount
    from public.bids b
    where b.team_id = t.id and v_has_slot and b.slot_id = v_slot.id
  ) lb on true;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  into v_settings
  from public.settings
  where key in ('min_bid','min_raise','opening_window_seconds','timer_extension_seconds',
                'bonus_time_seconds','solving_timer_seconds','starting_wallet_balance',
                'bonus_points_rate');

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',               e.id,
             'event_type',       e.event_type,
             'slot_id',          e.slot_id,
             'team_id',          e.team_id,
             'payload',          e.payload,
             'timer_ends_at',    e.timer_ends_at,
             'timer_status',     e.timer_status,
             'server_timestamp', e.server_timestamp
           ) order by e.server_timestamp desc
         ), '[]'::jsonb)
  into v_events
  from (
    select * from public.auction_events
    order by server_timestamp desc
    limit 40
  ) e;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'team_id',       el.team_id,
             'team_name',     t.name,
             'rule',          el.rule,
             'reason',        el.reason,
             'eliminated_at', el.eliminated_at
           ) order by el.eliminated_at desc
         ), '[]'::jsonb)
  into v_elims
  from public.team_eliminations el
  join public.teams t on t.id = el.team_id
  where el.restored_at is null;

  return jsonb_build_object(
    'server_time', clock_timestamp(),
    'total_items',  (select count(*) from public.slots),
    'items_sold',   (select count(*) from public.slots where status = 'sold'),
    'items_unsold', (select count(*) from public.slots where status in ('skipped', 'pending') and not exists (select 1 from public.slots k where k.topic_id = public.slots.topic_id and k.status = 'sold')),
    'items_open',   (select count(*) from public.slots where status = 'open'),
    'session', case when v_session.id is null then null else jsonb_build_object(
      'id',         v_session.id,
      'status',     v_session.status,
      'round',      v_session.round,
      'is_paused',  v_session.is_paused,
      'timer_status', v_session.timer_status,
      'timer_ends_at', v_session.timer_ends_at,
      'paused_remaining_seconds', v_session.paused_remaining_seconds,
      'total_bonus_seconds', v_session.total_bonus_seconds,
      'total_manual_extension_seconds', v_session.total_manual_extension_seconds,
      'active_slot_id', v_session.active_slot_id
    ) end,
    'active_slot', case when v_slot.id is null then null else jsonb_build_object(
      'id',           v_slot.id,
      'status',       v_slot.status,
      'round',        v_slot.round,
      'current_bid',  v_slot.current_bid,
      'min_bid',      v_slot.min_bid,
      'min_next_bid', case when v_slot.leader_team_id is null
                            then greatest(coalesce(v_slot.min_bid, 0), v_min_bid)
                            else v_slot.current_bid + v_min_raise end,
      'leader_team_id', v_slot.leader_team_id,
      'leader_team_name', v_leader,
      'winner_team_id', v_slot.winner_team_id,
      'winner_team_name', v_winner,
      'end_time',     v_slot.end_time,
      'timer_status', v_slot.timer_status,
      'paused_remaining_seconds', v_slot.paused_remaining_seconds,
      'question_number', v_slot.question_number,
      'topic', case when v_topic.id is null then null else jsonb_build_object(
        'id',          v_topic.id,
        'level',       v_topic.level,
        'title',       v_topic.title,
        'description', v_topic.description,
        'criterion',   v_topic.criterion
      ) end
    ) end,
    'bids',          coalesce(v_bids, '[]'::jsonb),
    'teams',         coalesce(v_teams, '[]'::jsonb),
    'settings',      coalesce(v_settings, '{}'::jsonb),
    'events',        coalesce(v_events, '[]'::jsonb),
    'eliminations',  coalesce(v_elims, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_live_auction_state() from public;
grant execute on function public.get_live_auction_state() to authenticated, anon, service_role;
