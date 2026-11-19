-- ============================================================
-- Migration 023: 3-Round Auction Question Allocation System & Qualification
-- ============================================================
-- Implements the 3-round contest structure:
-- Round 1: First question allocation (target: 1 question per team)
-- Round 2: Second question allocation (target: 2 questions per team)
-- Round 3: Recovery auction (only teams with < 2 questions participate; teams with 2 are excluded)
-- Final Elimination Check: Teams with >= 2 questions qualify; teams with < 2 are eliminated.
-- Universal Rule: No team can ever acquire > 2 questions in total.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Extend CHECK constraints to allow Round 3
-- ─────────────────────────────────────────────────────────────
alter table public.slots drop constraint if exists slots_round_check;
alter table public.slots add constraint slots_round_check check (round in (1, 2, 3));

alter table public.auction_sessions drop constraint if exists auction_sessions_round_check;
alter table public.auction_sessions add constraint auction_sessions_round_check check (round in (1, 2, 3));

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'team_allocations'
  ) then
    alter table public.team_allocations drop constraint if exists team_allocations_round_check;
    alter table public.team_allocations add constraint team_allocations_round_check check (round in (1, 2, 3));
  end if;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 2. start_auction — supports rounds 1, 2, and 3
-- ─────────────────────────────────────────────────────────────
create or replace function public.start_auction(p_round integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_snapshot jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to start the auction';
  end if;

  if p_round is null or p_round not in (1, 2, 3) then
    raise exception 'Round must be 1, 2, or 3';
  end if;

  select * into v_session from public.get_active_session() limit 1;

  if found then
    -- If active session exists but round differs, update round
    if v_session.round is distinct from p_round then
      update public.auction_sessions
      set round = p_round, updated_at = clock_timestamp()
      where id = v_session.id;

      perform public.emit_auction_event(
        'round_changed',
        null,
        null,
        jsonb_build_object('round', p_round, 'previous_round', v_session.round)
      );

      insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
      values (
        auth.uid(), 'round_changed', 'auction_session', v_session.id,
        jsonb_build_object('round', p_round, 'previous_round', v_session.round)
      );
    end if;

    return jsonb_build_object(
      'success',          true,
      'already_started',  true,
      'session_id',       v_session.id,
      'status',           v_session.status,
      'round',            p_round
    );
  end if;

  select jsonb_object_agg(key, value) into v_snapshot
  from public.settings
  where key in ('min_bid','min_raise','opening_window_seconds','timer_extension_seconds',
                'bonus_time_seconds','solving_timer_seconds','starting_wallet_balance');

  insert into public.auction_sessions (
    status, round, is_paused, timer_status, started_at, settings_snapshot
  )
  values (
    'ready', p_round, false, 'idle', clock_timestamp(), coalesce(v_snapshot, '{}'::jsonb)
  )
  returning * into v_session;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_started', 'auction_session', v_session.id,
    jsonb_build_object('round', p_round, 'settings', v_snapshot)
  );

  return jsonb_build_object(
    'success',         true,
    'already_started', false,
    'session_id',      v_session.id,
    'status',          v_session.status,
    'round',           v_session.round,
    'server_time',     clock_timestamp()
  );
end;
$$;

revoke all on function public.start_auction(integer) from public;
grant execute on function public.start_auction(integer) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. set_auction_round — admin RPC to switch/advance round
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_auction_round(p_round integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to set auction round';
  end if;

  if p_round is null or p_round not in (1, 2, 3) then
    raise exception 'Round must be 1, 2, or 3';
  end if;

  select * into v_session from public.get_active_session() limit 1;

  if not found then
    return public.start_auction(p_round);
  end if;

  update public.auction_sessions
  set round = p_round, updated_at = clock_timestamp()
  where id = v_session.id;

  perform public.emit_auction_event(
    'round_changed',
    null,
    null,
    jsonb_build_object('round', p_round, 'previous_round', v_session.round)
  );

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'round_changed', 'auction_session', v_session.id,
    jsonb_build_object('round', p_round, 'previous_round', v_session.round)
  );

  return jsonb_build_object(
    'success',        true,
    'session_id',     v_session.id,
    'round',          p_round,
    'previous_round', v_session.round,
    'server_time',    clock_timestamp()
  );
end;
$$;

revoke all on function public.set_auction_round(integer) from public;
grant execute on function public.set_auction_round(integer) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. open_slot — allows reopening skipped/unsold slots in later rounds
-- ─────────────────────────────────────────────────────────────
create or replace function public.open_slot(
  p_slot_id       uuid,
  p_starting_bid  integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot      public.slots%rowtype;
  v_end       timestamptz;
  v_window    integer;
  v_min_bid   integer;
  v_session   public.auction_sessions%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to open auction slots';
  end if;

  if p_starting_bid is not null and p_starting_bid <= 0 then
    raise exception 'Starting bid points must be a positive integer';
  end if;

  -- Only one auction item may be open at a time.
  if exists (
    select 1 from public.slots
    where status = 'open' and id <> p_slot_id
  ) then
    raise exception 'Another auction slot is already open for bidding. Close or skip it before opening a new slot.';
  end if;

  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  if v_slot.status not in ('pending', 'skipped') then
    raise exception
      'Only pending or skipped slots can be opened. Current status: %', v_slot.status;
  end if;

  -- The topic must not already have been sold.
  if exists (
    select 1 from public.slots s
    where s.topic_id = v_slot.topic_id and s.status = 'sold'
  ) then
    raise exception 'This problem statement has already been sold and cannot be auctioned again.';
  end if;

  v_window  := greatest(public.get_setting_int('opening_window_seconds', 10), 1);
  v_min_bid := coalesce(
    p_starting_bid,
    greatest(coalesce(v_slot.min_bid, 0), public.get_setting_int('min_bid', 10))
  );

  v_end := clock_timestamp() + make_interval(secs => v_window);

  -- Attach the item to the active session, if there is one.
  select * into v_session
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1;

  if v_session.id is not null then
    update public.auction_sessions
    set active_slot_id = p_slot_id, updated_at = clock_timestamp()
    where id = v_session.id;
  end if;

  -- Open the slot, inheriting active session round if available
  update public.slots
  set    status           = 'open',
         current_bid      = 0,
         min_bid          = v_min_bid,
         round            = coalesce(v_session.round, v_slot.round),
         end_time         = v_end,
         leader_team_id   = null,
         winner_team_id   = null,
         timer_status     = 'running',
         timer_started_at = clock_timestamp(),
         timer_paused_at  = null,
         paused_remaining_seconds = v_window,
         sold_at          = null
  where  id = p_slot_id;

  -- Triggers trg_slot_emit_event and trg_slot_log_audit record the open.
  return jsonb_build_object(
    'success',        true,
    'slot_id',        p_slot_id,
    'status',         'open',
    'round',          coalesce(v_session.round, v_slot.round),
    'end_time',       v_end,
    'window_seconds', v_window,
    'min_bid',        v_min_bid,
    'starting_bid',   v_min_bid,
    'server_time',    clock_timestamp()
  );
end;
$$;

revoke all on function public.open_slot(uuid, integer) from public;
grant execute on function public.open_slot(uuid, integer) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. advance_auction — picks pending or unsold items in round 3
-- ─────────────────────────────────────────────────────────────
create or replace function public.advance_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_open    public.slots%rowtype;
  v_next    public.slots%rowtype;
  v_result  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to advance the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session. Start the auction first.';
  end if;

  -- Close the running item, if any.
  select * into v_open
  from public.slots s
  where s.status = 'open'
  order by s.round, s.question_number nulls last, s.id
  limit 1
  for update;

  if found then
    perform public.close_slot(v_open.id);
  end if;

  -- Pick the next pending item matching the current round,
  -- or if in round 3 (recovery), any pending or skipped item that hasn't been sold.
  if v_session.round = 3 then
    select * into v_next
    from public.slots s
    where s.status in ('pending', 'skipped')
      and not exists (
        select 1 from public.slots k
        where k.topic_id = s.topic_id and k.status = 'sold'
      )
    order by s.round, s.question_number nulls last, s.id
    limit 1
    for update;
  else
    select * into v_next
    from public.slots s
    where s.status = 'pending'
      and s.round = v_session.round
      and not exists (
        select 1 from public.slots k
        where k.topic_id = s.topic_id and k.status = 'sold'
      )
    order by s.round, s.question_number nulls last, s.id
    limit 1
    for update;
  end if;

  if not found then
    update public.auction_sessions
    set status = 'completed', ended_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_session.id;

    return jsonb_build_object(
      'success',       true,
      'session_id',    v_session.id,
      'session_status','completed',
      'message',       'No further auction items remain for this round.'
    );
  end if;

  perform public.select_auction_question(v_next.id);
  v_result := public.open_bidding(v_next.id);

  return v_result || jsonb_build_object(
    'session_id',    v_session.id,
    'next_slot_id',  v_next.id,
    'session_status','bidding_open'
  );
end;
$$;

revoke all on function public.advance_auction() from public;
grant execute on function public.advance_auction() to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 6. place_bid — enforces 2-question limit & Round 3 Recovery exclusion
-- ─────────────────────────────────────────────────────────────
create or replace function public.place_bid(
  p_slot_id uuid,
  p_amount  integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid;
  v_email        text;
  v_team_id      uuid;
  v_team_name    text;
  v_slot         public.slots%rowtype;
  v_balance      integer;
  v_min_bid      integer;
  v_min_raise    integer;
  v_timer_ext    integer;
  v_bid_id       uuid;
  v_new_end      timestamptz;
  v_won_count    integer := 0;
  v_session_round integer;
begin
  -- ── 0. Settle anything the clock already closed ─────────────
  perform public.settle_expired_slots();

  -- ── 1. Authentication ───────────────────────────────────────
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  -- ── 2. Resolve caller as TEAM CAPTAIN ONLY ──────────────────
  -- Primary: canonical chain teams.captain_id = auth.uid()
  select t.id, t.name
  into   v_team_id, v_team_name
  from   public.teams t
  where  t.captain_id = v_user_id
  limit  1;

  -- Secondary: teams.captain_id points to captain's member row
  if v_team_id is null then
    select t.id, t.name
    into   v_team_id, v_team_name
    from   public.teams t
    join   public.members m on m.id = t.captain_id
    where  m.id = v_user_id
       or  (v_email <> '' and lower(m.email) = v_email)
    limit  1;
  end if;

  -- Tertiary: caller's member row is designated captain
  if v_team_id is null and v_email <> '' then
    select t.id, t.name
    into   v_team_id, v_team_name
    from   public.teams t
    join   public.members m on m.team_id = t.id
    where  lower(m.email) = v_email
      and  (
        t.captain_id is null
        or lower(coalesce(m.college, '')) like '%captain%'
        or lower(m.name) like '%captain%'
        or coalesce(auth.jwt()->'user_metadata'->>'role', '') = 'captain'
        or coalesce(auth.jwt()->'app_metadata'->>'role', '') = 'captain'
      )
    limit  1;
  end if;

  if v_team_id is null then
    raise exception 'Only the team captain can place bids';
  end if;

  -- Auto-align captain mapping for future performance and RLS
  update public.teams
  set    captain_id = v_user_id
  where  id = v_team_id
    and  (captain_id is null or captain_id <> v_user_id);

  update public.members
  set    id = v_user_id
  where  team_id = v_team_id
    and  (id = v_user_id or (v_email <> '' and lower(email) = v_email))
    and  id <> v_user_id;

  -- ── 3. Elimination gate ─────────────────────────────────────
  if public.team_is_eliminated(v_team_id) then
    raise exception 'Your team has been eliminated and can no longer bid';
  end if;

  -- ── 3b. Universal Two-Question Limit & Round 3 Recovery Rules ─
  select count(*)
  into   v_won_count
  from   public.slots
  where  winner_team_id = v_team_id
    and  status = 'sold';

  select s.round into v_session_round
  from   public.auction_sessions s
  where  s.status in ('ready','question_selection','bidding_open','bidding_closed','finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1;

  if coalesce(v_session_round, 1) = 3 and v_won_count >= 2 then
    raise exception 'Your team already has 2 problem statements and cannot participate in the Round 3 recovery auction.';
  end if;

  if v_won_count >= 2 then
    raise exception 'Your team has already acquired the maximum limit of 2 problem statements.';
  end if;

  -- ── 4. Validate the amount ──────────────────────────────────
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid amount must be a positive integer';
  end if;

  -- ── 5. Lock the slot row ────────────────────────────────────
  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  if v_slot.status <> 'open' then
    if v_slot.end_time is not null and clock_timestamp() >= v_slot.end_time then
      raise exception 'This auction slot is not open for bidding (expired)';
    else
      raise exception 'This auction slot is not open for bidding';
    end if;
  end if;

  if v_slot.end_time is not null and clock_timestamp() > v_slot.end_time then
    raise exception 'This auction slot is not open for bidding (expired)';
  end if;

  if v_slot.timer_status = 'paused' then
    raise exception 'Bidding is currently paused';
  end if;

  -- ── 6. Self-outbid protection ───────────────────────────────
  if v_slot.leader_team_id is not null and v_slot.leader_team_id = v_team_id then
    raise exception 'Your team is already the highest bidder on this slot';
  end if;

  -- ── 7. Bid amounts & settings ───────────────────────────────
  v_min_bid   := greatest(public.get_setting_int('min_bid', 10), 1);
  v_min_raise := greatest(public.get_setting_int('min_raise', 5), 1);
  v_timer_ext := greatest(public.get_setting_int('timer_extension_seconds', 5), 1);

  if v_slot.current_bid = 0 then
    if p_amount < v_min_bid then
      raise exception 'Bid too low. The opening bid must be at least % pts.', v_min_bid;
    end if;
  else
    if p_amount < v_slot.current_bid + v_min_raise then
      raise exception
        'Bid too low. Current bid is % pts — minimum next bid is % pts.',
        v_slot.current_bid, v_slot.current_bid + v_min_raise;
    end if;
  end if;

  -- ── 8. Available wallet balance ─────────────────────────────
  select coalesce(w.balance, 0)
  into   v_balance
  from   public.wallets w
  where  w.team_id = v_team_id;

  if not found then
    raise exception 'Wallet not found for team %', v_team_id;
  end if;

  if p_amount > v_balance then
    raise exception
      'Insufficient balance. Your team has % pts available — cannot bid % pts.',
      v_balance, p_amount;
  end if;

  -- ── 9. Extend timer ─────────────────────────────────────────
  if v_slot.end_time is null then
    v_new_end := clock_timestamp() + make_interval(secs => v_timer_ext);
  else
    v_new_end := greatest(v_slot.end_time, clock_timestamp())
                 + make_interval(secs => v_timer_ext);
  end if;

  -- ── 10. Persist the slot update ─────────────────────────────
  update public.slots
  set    current_bid      = p_amount,
         leader_team_id   = v_team_id,
         end_time         = v_new_end,
         timer_status     = 'running',
         timer_started_at = coalesce(timer_started_at, clock_timestamp())
  where  id = p_slot_id;

  -- ── 11. Record the bid (trigger trg_bids_emit_event emits bid_placed) ──
  insert into public.bids (slot_id, team_id, amount, server_time)
  values (p_slot_id, v_team_id, p_amount, clock_timestamp())
  returning id into v_bid_id;

  return jsonb_build_object(
    'success',      true,
    'bid_id',       v_bid_id,
    'slot_id',      p_slot_id,
    'team_id',      v_team_id,
    'team_name',    v_team_name,
    'amount',       p_amount,
    'current_bid',  p_amount,
    'min_next_bid', p_amount + v_min_raise,
    'end_time',     v_new_end,
    'new_end_time', v_new_end,
    'server_time',  clock_timestamp()
  );
end;
$$;

revoke all on function public.place_bid(uuid, integer) from public;
grant execute on function public.place_bid(uuid, integer) to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 7. finalize_round_3_eliminations — post-Round 3 qualification check
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
-- 8. get_live_auction_state — includes won_count and qualified per team
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
                            then greatest(coalesce(v_slot.min_bid, v_min_bid), v_min_bid)
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


-- ─────────────────────────────────────────────────────────────
-- 9. get_bidding_results — includes qualified and eliminated flags
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
  v_teams  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to read bidding results';
  end if;

  v_base := greatest(public.get_setting_int('solving_timer_seconds', 120), 0);

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
              'total_dev_seconds', v_base + coalesce((
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
        'total_base_dev_seconds',  v_base * agg.won_count,
        'total_bonus_dev_seconds', agg.bonus_dev_seconds,
        'total_dev_seconds',       v_base * agg.won_count + agg.bonus_dev_seconds
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
    'teams',            coalesce(v_teams, '[]'::jsonb),
    'base_dev_seconds', v_base,
    'server_time',      clock_timestamp()
  );
end;
$$;

revoke all on function public.get_bidding_results() from public;
grant execute on function public.get_bidding_results() to authenticated, service_role;

-- Notify PostgREST to reload schema cache immediately
notify pgrst, 'reload schema';

