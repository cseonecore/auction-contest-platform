-- ============================================================
-- Migration 015: Auction engine — settings-driven rules,
-- session state machine, authoritative timer, exactly-once
-- wallet deduction.
-- ============================================================
-- This migration REPLACES the bodies of place_bid, open_slot,
-- close_slot and skip_slot (same signatures, so no grant changes
-- are required) and ADDS the session / timer functions.
--
-- Authorisation is enforced INSIDE these functions (is_admin(),
-- is_admin_or_judge(), current_team_id()), never in the API
-- route alone.
--
-- Concurrency contract for place_bid:
--   1. SELECT ... FROM slots WHERE id = p_slot_id FOR UPDATE
--      serialises every bid for that item.
--   2. The wallet row is locked FOR UPDATE before the balance
--      check.
--   3. The slot's current_bid is only ever increased; the highest
--      bid can never regress.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. place_bid — the only participant-facing write
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
  v_user_id    uuid;
  v_team_id    uuid;
  v_team_name  text;
  v_slot       public.slots%rowtype;
  v_balance    integer;
  v_won_round  boolean;
  v_min_bid    integer;
  v_min_raise  integer;
  v_timer_ext  integer;
  v_bid_id     uuid;
  v_new_end    timestamptz;
begin
  -- ── 1. Authentication ───────────────────────────────────────
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- ── 2. Resolve the caller to their registered team ──────────
  select t.id, t.name
  into   v_team_id, v_team_name
  from   public.teams t
  where  t.captain_id = v_user_id
  limit 1;

  if v_team_id is null then
    select m.team_id, t.name
    into   v_team_id, v_team_name
    from   public.members m
    join   public.teams   t on t.id = m.team_id
    where  m.id        = v_user_id
      and  t.captain_id = v_user_id
    limit 1;
  end if;

  if v_team_id is null then
    raise exception 'Only the team captain can place bids';
  end if;

  -- ── 3. Elimination gate ─────────────────────────────────────
  if public.team_is_eliminated(v_team_id) then
    raise exception 'Your team has been eliminated and can no longer bid';
  end if;

  -- ── 4. Validate the amount ──────────────────────────────────
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid amount must be a positive integer';
  end if;

  -- ── 5. Lock the auction item (prevents concurrent bids) ─────
  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Auction slot not found';
  end if;

  -- ── 6. Item state ───────────────────────────────────────────
  if v_slot.status <> 'open' then
    raise exception 'This auction slot is not open for bidding';
  end if;

  if v_slot.timer_status = 'paused' then
    raise exception 'Bidding is currently paused';
  end if;

  if v_slot.end_time is null or v_slot.end_time <= clock_timestamp() then
    raise exception 'This auction slot has expired';
  end if;

  -- A paused session also blocks bidding.
  if v_slot.session_id is not null and exists (
    select 1 from public.auction_sessions s
    where s.id = v_slot.session_id and s.is_paused
  ) then
    raise exception 'Bidding is currently paused';
  end if;

  -- ── 7. Minimum bid / minimum raise (settings driven) ────────
  v_min_raise := greatest(public.get_setting_int('min_raise', 10), 1);

  if v_slot.leader_team_id is null then
    v_min_bid := greatest(
      coalesce(v_slot.min_bid, 0),
      public.get_setting_int('min_bid', 10)
    );
  else
    v_min_bid := v_slot.current_bid + v_min_raise;
  end if;

  if p_amount < v_min_bid then
    raise exception
      'Bid too low. Current bid is % pts — minimum next bid is % pts.',
      v_slot.current_bid, v_min_bid;
  end if;

  -- ── 8. Cannot bid against yourself ──────────────────────────
  if v_slot.leader_team_id = v_team_id then
    raise exception 'Your team is already the highest bidder on this slot';
  end if;

  -- ── 9. One win per round (Rule Book §5.3) ───────────────────
  select exists(
    select 1
    from public.slots s
    where s.winner_team_id = v_team_id
      and s.round          = v_slot.round
      and s.status         = 'sold'
  )
  into v_won_round;

  if v_won_round then
    raise exception
      'Your team has already won a slot in Round %. Each team may win one slot per round.',
      v_slot.round;
  end if;

  -- ── 10. Balance check (Rule Book §5.1 — wallet is the remaining budget) ─
  select w.balance
  into   v_balance
  from   public.wallets w
  where  w.team_id = v_team_id
  for    update;

  if not found then
    raise exception 'Wallet not found for this team';
  end if;

  if v_balance < p_amount then
    raise exception
      'Insufficient balance. Your wallet has % pts; this bid requires % pts.',
      v_balance, p_amount;
  end if;

  -- ── 11. Record the bid ──────────────────────────────────────
  insert into public.bids (slot_id, team_id, amount)
  values (p_slot_id, v_team_id, p_amount)
  returning id into v_bid_id;

  -- ── 12. Promote the item (current_bid only ever increases) ─
  v_timer_ext := greatest(public.get_setting_int('timer_extension_seconds', 5), 0);

  v_new_end := greatest(v_slot.end_time, clock_timestamp())
               + make_interval(secs => v_timer_ext);

  update public.slots
  set  current_bid     = p_amount,
       leader_team_id  = v_team_id,
       end_time        = v_new_end,
       timer_status    = 'running',
       timer_started_at = coalesce(timer_started_at, clock_timestamp())
  where id = p_slot_id;

  -- ── 13. Audit ───────────────────────────────────────────────
  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    v_user_id, v_team_id, 'bid_placed', 'slot', p_slot_id,
    jsonb_build_object(
      'bid_id',         v_bid_id,
      'team_id',        v_team_id,
      'team_name',      v_team_name,
      'amount',         p_amount,
      'previous_bid',   v_slot.current_bid,
      'end_time',       v_new_end,
      'timer_extension', v_timer_ext
    )
  );

  -- ── 14. Result ──────────────────────────────────────────────
  return jsonb_build_object(
    'success',         true,
    'slot_id',         p_slot_id,
    'team_id',         v_team_id,
    'team_name',       v_team_name,
    'bid_id',          v_bid_id,
    'amount',          p_amount,
    'current_bid',     p_amount,
    'leader_team_id',  v_team_id,
    'min_next_bid',    p_amount + v_min_raise,
    'wallet_balance',  v_balance,
    'end_time',        v_new_end,
    'server_time',     clock_timestamp()
  );
end;
$$;

revoke all    on function public.place_bid(uuid, integer) from public;
grant execute on function public.place_bid(uuid, integer) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. open_slot — pending → open, settings-driven window
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
  v_session   uuid;
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

  if v_slot.status <> 'pending' then
    raise exception
      'Only pending slots can be opened. Current status: %', v_slot.status;
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
  select s.id into v_session
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1;

  update public.slots
  set  status           = 'open',
       end_time         = v_end,
       min_bid          = v_min_bid,
       current_bid      = 0,
       leader_team_id  = null,
       timer_status     = 'running',
       timer_started_at = clock_timestamp(),
       session_id       = coalesce(session_id, v_session)
  where id = p_slot_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'slot_opened', 'slot', p_slot_id,
    jsonb_build_object(
      'round',         v_slot.round,
      'topic_id',      v_slot.topic_id,
      'end_time',      v_end,
      'starting_bid',  v_min_bid,
      'window_seconds', v_window
    )
  );

  return jsonb_build_object(
    'success',         true,
    'slot_id',         p_slot_id,
    'status',          'open',
    'end_time',        v_end,
    'starting_bid',    v_min_bid,
    'window_seconds',  v_window,
    'server_time',     clock_timestamp()
  );
end;
$$;

revoke all on function public.open_slot(uuid, integer) from public;
grant execute on function public.open_slot(uuid, integer) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. close_slot — authoritative finalisation, exactly-once debit
-- ─────────────────────────────────────────────────────────────
create or replace function public.close_slot(p_slot_id uuid)
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
begin
  if not public.is_admin() then
    raise exception 'Admin access required to close auction slots';
  end if;

  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  -- Idempotency: a closed item cannot be closed again.
  if v_slot.status <> 'open' then
    raise exception
      'Only open slots can be closed. Current status: %', v_slot.status;
  end if;

  -- Keep the session in sync.
  select s.id into v_session
  from public.auction_sessions s
  where s.active_slot_id = p_slot_id
  limit 1;

  if v_session is null then
    select s.id into v_session
    from public.auction_sessions s
    where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                        'finalizing','question_assigned','solving')
    order by s.created_at desc
    limit 1;
  end if;

  -- ── Case A: no bids → skipped ───────────────────────────────
  if v_slot.leader_team_id is null then
    update public.slots
    set  status          = 'skipped',
         winner_team_id = null,
         timer_status   = 'completed',
         sold_at        = clock_timestamp()
    where id = p_slot_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(), 'slot_skipped', 'slot', p_slot_id,
      jsonb_build_object('reason', 'no_bids', 'round', v_slot.round)
    );

    if v_session is not null then
      update public.auction_sessions
      set status = 'bidding_closed', updated_at = clock_timestamp()
      where id = v_session and status in ('bidding_open','finalizing');
    end if;

    return jsonb_build_object(
      'success', true,
      'status',  'skipped',
      'slot_id', p_slot_id,
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
       sold_at        = clock_timestamp()
  where id = p_slot_id;

  insert into public.audit_log (actor_id, actor_team_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), v_slot.leader_team_id, 'slot_sold', 'slot', p_slot_id,
    jsonb_build_object(
      'winner_team_id', v_slot.leader_team_id,
      'winning_bid',    v_slot.current_bid,
      'round',          v_slot.round,
      'topic_id',       v_slot.topic_id
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
    'server_time',    clock_timestamp()
  );
end;
$$;

revoke all on function public.close_slot(uuid) from public;
grant execute on function public.close_slot(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. skip_slot — admin override
-- ─────────────────────────────────────────────────────────────
create or replace function public.skip_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.slots%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to skip slots';
  end if;

  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Slot not found';
  end if;

  if v_slot.status not in ('pending', 'open') then
    raise exception
      'Only pending or open slots can be skipped. Current status: %', v_slot.status;
  end if;

  update public.slots
  set  status          = 'skipped',
       winner_team_id = null,
       leader_team_id = null,
       current_bid    = 0,
       end_time       = null,
       timer_status   = 'completed'
  where id = p_slot_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'slot_skipped', 'slot', p_slot_id,
    jsonb_build_object('reason', 'admin_override', 'round', v_slot.round)
  );

  return jsonb_build_object(
    'success', true,
    'status',  'skipped',
    'slot_id', p_slot_id,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.skip_slot(uuid) from public;
grant execute on function public.skip_slot(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 5. Session lifecycle
-- ─────────────────────────────────────────────────────────────
-- IMPORTANT: this MUST return SETOF. A function returning a bare composite
-- type always yields exactly one row (all-NULL when the inner query finds
-- nothing), which silently breaks every `if found` check below.
drop function if exists public.get_active_session();
create or replace function public.get_active_session()
returns setof public.auction_sessions
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc
  limit 1;
$$;

revoke all on function public.get_active_session() from public;
grant execute on function public.get_active_session() to authenticated, anon, service_role;


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

  if p_round is null or p_round not in (1, 2) then
    raise exception 'Round must be 1 or 2';
  end if;

  select * into v_session from public.get_active_session() limit 1;

  if found then
    return jsonb_build_object(
      'success',          true,
      'already_started',  true,
      'session_id',       v_session.id,
      'status',           v_session.status,
      'round',            v_session.round
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
grant execute on function public.start_auction(integer) to authenticated;


create or replace function public.select_auction_question(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot    public.slots%rowtype;
  v_session public.auction_sessions%rowtype;
  v_topic   public.topics%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to select an auction question';
  end if;

  select * into v_slot
  from public.slots s
  where s.id = p_slot_id
  for update;

  if not found then
    raise exception 'Auction slot not found';
  end if;

  if v_slot.status <> 'pending' then
    raise exception 'Only a pending auction item can be selected. Current status: %', v_slot.status;
  end if;

  if exists (
    select 1 from public.slots s
    where s.topic_id = v_slot.topic_id and s.status = 'sold'
  ) then
    raise exception 'This problem statement has already been sold and cannot be auctioned again.';
  end if;

  select * into v_topic from public.topics t where t.id = v_slot.topic_id;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session. Start the auction first.';
  end if;

  update public.slots
  set session_id = v_session.id
  where id = p_slot_id;

  update public.auction_sessions
  set active_slot_id = p_slot_id,
      status         = 'question_selection',
      updated_at     = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'question_selected', 'slot', p_slot_id,
    jsonb_build_object('topic_id', v_slot.topic_id, 'title', v_topic.title, 'session_id', v_session.id)
  );

  return jsonb_build_object(
    'success',     true,
    'slot_id',     p_slot_id,
    'topic_id',    v_slot.topic_id,
    'topic_title', v_topic.title,
    'level',       v_topic.level,
    'session_id',  v_session.id,
    'status',      'question_selection',
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.select_auction_question(uuid) from public;
grant execute on function public.select_auction_question(uuid) to authenticated;


create or replace function public.open_bidding(p_slot_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_target  uuid;
  v_result  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to open bidding';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session. Start the auction first.';
  end if;

  v_target := coalesce(p_slot_id, v_session.active_slot_id);
  if v_target is null then
    raise exception 'Select a problem statement before opening bidding';
  end if;

  v_result := public.open_slot(v_target);

  update public.auction_sessions
  set status = 'bidding_open', is_paused = false, updated_at = clock_timestamp()
  where id = v_session.id;

  return v_result || jsonb_build_object('session_id', v_session.id, 'session_status', 'bidding_open');
end;
$$;

revoke all on function public.open_bidding(uuid) from public;
grant execute on function public.open_bidding(uuid) to authenticated;


create or replace function public.close_bidding(p_slot_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_target  uuid;
  v_result  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to close bidding';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  v_target := coalesce(p_slot_id, v_session.active_slot_id);
  if v_target is null then
    raise exception 'There is no open auction item to close';
  end if;

  v_result := public.close_slot(v_target);

  update public.auction_sessions
  set status = 'bidding_closed', updated_at = clock_timestamp()
  where id = v_session.id
    and status in ('bidding_open', 'question_selection', 'finalizing');

  return v_result || jsonb_build_object('session_id', v_session.id);
end;
$$;

revoke all on function public.close_bidding(uuid) from public;
grant execute on function public.close_bidding(uuid) to authenticated;


create or replace function public.finalize_auction(p_slot_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_target  uuid;
  v_result  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to finalize the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  v_target := coalesce(p_slot_id, v_session.active_slot_id);
  if v_target is null then
    raise exception 'There is no auction item to finalize';
  end if;

  v_result := public.close_slot(v_target);

  update public.auction_sessions
  set status = 'solving', updated_at = clock_timestamp()
  where id = v_session.id;

  return v_result || jsonb_build_object('session_id', v_session.id, 'session_status', 'solving');
end;
$$;

revoke all on function public.finalize_auction(uuid) from public;
grant execute on function public.finalize_auction(uuid) to authenticated;


create or replace function public.advance_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session      public.auction_sessions%rowtype;
  v_open         public.slots%rowtype;
  v_next         public.slots%rowtype;
  v_result       jsonb;
  v_advancing    boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to advance the auction';
  end if;

  -- Concurrency guard: prevent duplicate advances from double-click,
  -- multiple admin devices, realtime reconnect, or page refresh.
  select coalesce(setting->>'value', 'false') into v_advancing
  from public.settings
  where key = 'auction_advancing';

  if v_advancing = 'true' then
    raise exception 'An auction advance is already in progress. Please wait for it to complete.';
  end if;

  -- Mark the advance as in progress.
  update public.settings set value = 'true' where key = 'auction_advancing';

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

  -- Set the time when the next slot may be opened (3-second delay).
  -- This prevents the next lot from being opened before the previous
  -- lot is fully finalized, and protects against refreshes/reconnects
  -- creating duplicate advances.
  update public.settings set value = clock_timestamp() + make_interval(secs => 3) where key = 'next_auction_open_at';

  -- Pick the next pending item.
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

  if not found then
    -- No more slots for this round; mark session completed.
    update public.auction_sessions
    set status = 'completed', ended_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_session.id;

    -- Clear the advance guard and transition timestamp.
    update public.settings set value = 'false' where key = 'auction_advancing';
    update public.settings set value = null where key = 'next_auction_open_at';

    return jsonb_build_object(
      'success',      true,
      'session_id',   v_session.id,
      'session_status','completed',
      'message',      'No further auction items remain for this round.'
    );
  end if;

  -- Do NOT open the next slot immediately. Instead, record the transition
  -- timestamp and return success. The caller should check
  -- complete_next_auction_transition after the delay.
  perform public.select_auction_question(v_next.id);

  return jsonb_build_object(
    'success',      true,
    'session_id',   v_session.id,
    'next_slot_id', v_next.id,
    'session_status', 'advancing',
    'message',      'Advance initiated. Next slot will open automatically after a 3-second delay.'
  );
end;
$$;

/**
 * See advance_auction() for the transition flow.
 * After advance_auction() sets next_auction_open_at (3-second delay),
 * this function may be called to check whether the delay has elapsed
 * and, if so, open the next pending slot and start its bidding timer.
 */
create or replace function public.complete_next_auction_transition()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now            timestamptz;
  v_open_at        timestamptz;
  v_should_transition boolean;
  v_session        public.auction_sessions%rowtype;
  v_next           public.slots%rowtype;
  v_result         jsonb;
begin
  -- Check whether the delay has elapsed.
  select coalesce(setting->>'value', null) into v_open_at
  from public.settings
  where key = 'next_auction_open_at';
  v_now := clock_timestamp();
  v_should_transition := v_open_at is not null and v_open_at::timestamptz <= v_now;

  if not v_should_transition then
    -- Delay has not yet elapsed; return current status.
    return jsonb_build_object(
      'success',      true,
       'session_status', 'advancing',
      'message',      'Delay still active — next slot will open shortly.'
    );
  end if;

  -- Fetch the active session.
  select * into v_session from public.get_active_session() limit 1;
  if not found then
    -- No session; nothing to transition.
    update public.settings set value = null where key = 'next_auction_open_at';
    update public.settings set value = 'false' where key = 'auction_advancing';
    return jsonb_build_object(
      'success', true,
      'message', 'No active auction session.'
    );
  end if;

  -- Find the next pending slot in the current round.
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

  if not found then
    -- No more pending slots; mark session completed.
    update public.auction_sessions
    set status = 'completed', ended_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_session.id;

    -- Clear the transition state.
    update public.settings set value = null where key = 'next_auction_open_at';
    update public.settings set value = 'false' where key = 'auction_advancing';

    return jsonb_build_object(
      'success',      true,
      'session_id',   v_session.id,
      'session_status','completed',
      'message',      'No further auction items remain for this round.'
    );
  end if;

  -- Open the next slot for bidding.
  perform public.open_bidding(v_next.id);

  -- Clear the transition state.
  update public.settings set value = null where key = 'next_auction_open_at';
  update public.settings set value = 'false' where key = 'auction_advancing';

  return jsonb_build_object(
    'success',      true,
    'session_id',   v_session.id,
    'next_slot_id', v_next.id,
    'session_status', 'bidding_open',
    'message',      'Next auction slot opened automatically after delay.'
  );
end;
$$;

revoke all on function public.advance_auction() from public;
grant execute on function public.advance_auction() to authenticated;


create or replace function public.pause_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_slot    public.slots%rowtype;
  v_remaining integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to pause the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  update public.auction_sessions
  set is_paused = true, updated_at = clock_timestamp()
  where id = v_session.id;

  -- Freeze the running item's clock.
  select * into v_slot
  from public.slots s
  where s.id = v_session.active_slot_id
  for update;

  if found and v_slot.status = 'open' and v_slot.end_time is not null then
    v_remaining := greatest(0, ceil(extract(epoch from (v_slot.end_time - clock_timestamp()))))::integer;

    update public.slots
    set timer_status             = 'paused',
        timer_paused_at          = clock_timestamp(),
        paused_remaining_seconds = v_remaining
    where id = v_slot.id;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_paused', 'auction_session', v_session.id,
    jsonb_build_object('paused_remaining_seconds', v_remaining)
  );

  return jsonb_build_object(
    'success',    true,
    'session_id', v_session.id,
    'is_paused',  true,
    'paused_remaining_seconds', v_remaining,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.pause_auction() from public;
grant execute on function public.pause_auction() to authenticated;


create or replace function public.resume_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_slot    public.slots%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to resume the auction';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  update public.auction_sessions
  set is_paused = false, updated_at = clock_timestamp()
  where id = v_session.id;

  select * into v_slot
  from public.slots s
  where s.id = v_session.active_slot_id
  for update;

  if found and v_slot.status = 'open' and v_slot.timer_status = 'paused' then
    update public.slots
    set timer_status    = 'running',
        end_time        = clock_timestamp() + make_interval(secs => v_slot.paused_remaining_seconds),
        timer_paused_at = null
    where id = v_slot.id;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_resumed', 'auction_session', v_session.id, '{}'::jsonb
  );

  return jsonb_build_object(
    'success',    true,
    'session_id', v_session.id,
    'is_paused',  false,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.resume_auction() from public;
grant execute on function public.resume_auction() to authenticated;


create or replace function public.end_auction_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_open    public.slots%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to end the auction session';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  select * into v_open
  from public.slots s
  where s.status = 'open'
  limit 1
  for update;

  if found then
    perform public.close_slot(v_open.id);
  end if;

  update public.auction_sessions
  set status = 'completed', ended_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'auction_completed', 'auction_session', v_session.id, '{}'::jsonb
  );

  return jsonb_build_object(
    'success',    true,
    'session_id', v_session.id,
    'status',     'completed',
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.end_auction_session() from public;
grant execute on function public.end_auction_session() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6. Authoritative solving clock
-- ─────────────────────────────────────────────────────────────
create or replace function public.start_auction_timer(p_seconds integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_secs    integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to start the timer';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  if v_session.timer_status = 'running' then
    return jsonb_build_object(
      'success', true, 'session_id', v_session.id,
      'timer_status', v_session.timer_status,
      'timer_ends_at', v_session.timer_ends_at
    );
  end if;

  v_secs := coalesce(p_seconds, public.get_setting_int('solving_timer_seconds', 120));

  update public.auction_sessions
  set timer_status     = 'running',
      timer_started_at = coalesce(timer_started_at, clock_timestamp()),
      timer_ends_at    = clock_timestamp() + make_interval(secs => v_secs),
      updated_at       = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_started', 'auction_session', v_session.id,
    jsonb_build_object('seconds', v_secs)
  );

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'timer_status', 'running',
    'timer_ends_at', clock_timestamp() + make_interval(secs => v_secs),
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.start_auction_timer(integer) from public;
grant execute on function public.start_auction_timer(integer) to authenticated;


create or replace function public.pause_auction_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session   public.auction_sessions%rowtype;
  v_remaining integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to pause the timer';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  if v_session.timer_status <> 'running' or v_session.timer_ends_at is null then
    raise exception 'The timer is not running';
  end if;

  v_remaining := greatest(0, ceil(extract(epoch from (v_session.timer_ends_at - clock_timestamp()))))::integer;

  update public.auction_sessions
  set timer_status             = 'paused',
      timer_paused_at          = clock_timestamp(),
      paused_remaining_seconds = v_remaining,
      updated_at               = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_paused', 'auction_session', v_session.id,
    jsonb_build_object('paused_remaining_seconds', v_remaining)
  );

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'timer_status', 'paused',
    'paused_remaining_seconds', v_remaining,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.pause_auction_timer() from public;
grant execute on function public.pause_auction_timer() to authenticated;


create or replace function public.resume_auction_timer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_ends_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to resume the timer';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  if v_session.timer_status <> 'paused' then
    raise exception 'The timer is not paused';
  end if;

  v_ends_at := clock_timestamp() + make_interval(secs => v_session.paused_remaining_seconds);

  update public.auction_sessions
  set timer_status    = 'running',
      timer_ends_at   = v_ends_at,
      timer_paused_at = null,
      updated_at      = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_resumed', 'auction_session', v_session.id,
    jsonb_build_object('timer_ends_at', v_ends_at)
  );

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'timer_status', 'running',
    'timer_ends_at', v_ends_at,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.resume_auction_timer() from public;
grant execute on function public.resume_auction_timer() to authenticated;


create or replace function public.adjust_auction_timer(
  p_seconds integer,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.auction_sessions%rowtype;
  v_ends_at timestamptz;
  v_paused  integer;
  v_status  text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to adjust the timer';
  end if;

  if p_seconds is null or p_seconds = 0 then
    raise exception 'A non-zero number of seconds is required';
  end if;

  select * into v_session from public.get_active_session() limit 1;
  if not found then
    raise exception 'No active auction session.';
  end if;

  v_status := v_session.timer_status;
  v_ends_at := v_session.timer_ends_at;
  v_paused  := v_session.paused_remaining_seconds;

  if v_status = 'paused' then
    v_paused := greatest(0, v_paused + p_seconds);
  else
    if v_ends_at is null then
      v_ends_at := clock_timestamp();
    end if;
    v_ends_at := v_ends_at + make_interval(secs => p_seconds);
    if v_status = 'idle' then
      v_status := 'running';
    end if;
  end if;

  update public.auction_sessions
  set timer_status                   = v_status,
      timer_ends_at                  = v_ends_at,
      paused_remaining_seconds       = v_paused,
      total_manual_extension_seconds = total_manual_extension_seconds + p_seconds,
      updated_at                     = clock_timestamp()
  where id = v_session.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_extended', 'auction_session', v_session.id,
    jsonb_build_object('seconds', p_seconds, 'reason', p_reason, 'timer_ends_at', v_ends_at)
  );

  return jsonb_build_object(
    'success', true, 'session_id', v_session.id,
    'timer_status', v_status,
    'timer_ends_at', v_ends_at,
    'seconds', p_seconds,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.adjust_auction_timer(integer, text) from public;
grant execute on function public.adjust_auction_timer(integer, text) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6b. adjust_bidding_timer — extend the bidding deadline of an
--     open auction item (the clock that a bid also extends).
-- ─────────────────────────────────────────────────────────────
create or replace function public.adjust_bidding_timer(
  p_seconds integer,
  p_slot_id uuid default null,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot    public.slots%rowtype;
  v_ends_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to adjust the bidding timer';
  end if;

  if p_seconds is null or p_seconds = 0 then
    raise exception 'A non-zero number of seconds is required';
  end if;

  if p_slot_id is null then
    select s.* into v_slot
    from public.slots s
    where s.status = 'open'
    order by s.round, s.question_number nulls last, s.id
    limit 1
    for update;
  else
    select s.* into v_slot
    from public.slots s
    where s.id = p_slot_id
    for update;
  end if;

  if not found then
    raise exception 'No open auction item to adjust';
  end if;

  if v_slot.status <> 'open' then
    raise exception 'Only an open auction item has a bidding timer';
  end if;

  v_ends_at := greatest(coalesce(v_slot.end_time, clock_timestamp()), clock_timestamp())
               + make_interval(secs => p_seconds);

  update public.slots
  set end_time = v_ends_at,
      timer_status = case when timer_status = 'paused' then 'paused' else 'running' end,
      total_manual_extension_seconds = total_manual_extension_seconds + p_seconds
  where id = v_slot.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'timer_extended', 'slot', v_slot.id,
    jsonb_build_object('seconds', p_seconds, 'reason', p_reason, 'end_time', v_ends_at)
  );

  return jsonb_build_object(
    'success', true,
    'slot_id', v_slot.id,
    'end_time', v_ends_at,
    'seconds', p_seconds,
    'timer_status', v_slot.timer_status,
    'server_time', clock_timestamp()
  );
end;
$$;

revoke all on function public.adjust_bidding_timer(integer, uuid, text) from public;
grant execute on function public.adjust_bidding_timer(integer, uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 7. reset_auction — explicit, audited full reset
-- ─────────────────────────────────────────────────────────────
create or replace function public.reset_auction()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starting_balance integer;
  v_bids_deleted     integer;
  v_slots_reset      integer;
  v_wallets_reset    integer;
  v_ledger_cleared   integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to reset auction';
  end if;

  lock table public.slots in exclusive mode;
  lock table public.bids in exclusive mode;
  lock table public.wallets in exclusive mode;

  v_starting_balance := public.get_setting_int('starting_wallet_balance', 100);
  if v_starting_balance is null or v_starting_balance <= 0 then
    v_starting_balance := 100;
  end if;

  delete from public.bids where id is not null;
  get diagnostics v_bids_deleted = row_count;

  -- The ledger describes the current contest state; a full reset
  -- invalidates it. The reset itself is permanently recorded in
  -- audit_log below.
  delete from public.wallet_transactions where id is not null;
  get diagnostics v_ledger_cleared = row_count;

  update public.slots
  set status                   = 'pending',
      current_bid              = 0,
      min_bid                  = public.get_setting_int('min_bid', 10),
      leader_team_id           = null,
      winner_team_id           = null,
      end_time                 = null,
      timer_status             = 'idle',
      timer_started_at         = null,
      timer_paused_at          = null,
      paused_remaining_seconds = 0,
      total_bonus_seconds      = 0,
      total_manual_extension_seconds = 0,
      session_id               = null,
      sold_at                  = null
  where id is not null;
  get diagnostics v_slots_reset = row_count;

  insert into public.wallets (team_id, balance)
  select id, v_starting_balance from public.teams
  on conflict (team_id) do update set balance = v_starting_balance;
  get diagnostics v_wallets_reset = row_count;

  update public.auction_sessions
  set status = 'cancelled', ended_at = clock_timestamp(), updated_at = clock_timestamp()
  where status not in ('completed', 'cancelled');

  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'auction_reset', 'auction', null,
    jsonb_build_object(
      'slots_reset',    v_slots_reset,
      'bids_deleted',   v_bids_deleted,
      'wallets_reset',  v_wallets_reset,
      'ledger_cleared', v_ledger_cleared,
      'starting_balance', v_starting_balance,
      'timestamp',      clock_timestamp()
    )
  );

  return jsonb_build_object(
    'success',          true,
    'slots_reset',      v_slots_reset,
    'bids_deleted',     v_bids_deleted,
    'wallets_reset',    v_wallets_reset,
    'ledger_cleared',   v_ledger_cleared,
    'starting_balance', v_starting_balance,
    'server_time',      clock_timestamp()
  );
end;
$$;

revoke all on function public.reset_auction() from public;
grant execute on function public.reset_auction() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 8. create_auction_topic — respects one-item-per-topic
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_auction_topic(
  p_title        text,
  p_description  text,
  p_level        text,
  p_starting_bid integer default null,
  p_criterion    jsonb default null,
  p_slots_count  integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic_id uuid;
  v_round    integer;
  v_i        integer;
  v_slots    jsonb := '[]'::jsonb;
  v_slot_id  uuid;
  v_min_bid  integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required to create auction topics';
  end if;

  if p_title is null or trim(p_title) = '' then
    raise exception 'Topic title is required';
  end if;

  if p_level not in ('easy', 'hard') then
    raise exception 'Topic level must be either easy or hard';
  end if;

  v_min_bid := coalesce(
    p_starting_bid,
    greatest(public.get_setting_int('min_bid', 10), 1)
  );

  if v_min_bid <= 0 then
    raise exception 'Starting bid must be a positive integer';
  end if;

  -- One auction item per problem statement.
  if p_slots_count is null or p_slots_count < 1 then
    p_slots_count := 1;
  end if;

  if exists (
    select 1 from public.topics where lower(title) = lower(trim(p_title))
  ) then
    raise exception 'A topic with title "%" already exists', trim(p_title);
  end if;

  v_round := case when p_level = 'easy' then 1 else 2 end;

  begin
    insert into public.topics (level, title, description, criterion)
    values (p_level, trim(p_title), nullif(trim(p_description), ''), p_criterion)
    returning id into v_topic_id;
  exception
    when unique_violation then
      raise exception 'A topic with title "%" already exists', trim(p_title);
  end;

  for v_i in 1..p_slots_count loop
    begin
      insert into public.slots (topic_id, round, status, current_bid, min_bid)
      values (v_topic_id, v_round, 'pending', 0, v_min_bid)
      returning id into v_slot_id;
    exception
      when check_violation then
        raise exception 'Only one auction item may exist per problem statement.';
    end;

    v_slots := v_slots || jsonb_build_object('slot_id', v_slot_id, 'round', v_round);
  end loop;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'topic_created', 'topic', v_topic_id,
    jsonb_build_object(
      'title',        trim(p_title),
      'level',        p_level,
      'round',        v_round,
      'starting_bid', v_min_bid,
      'slots_count',  p_slots_count
    )
  );

  return jsonb_build_object(
    'success',      true,
    'topic_id',     v_topic_id,
    'title',        trim(p_title),
    'level',        p_level,
    'round',        v_round,
    'starting_bid', v_min_bid,
    'slots',        v_slots,
    'server_time',  clock_timestamp()
  );
end;
$$;

revoke all on function public.create_auction_topic(text, text, text, integer, jsonb, integer) from public;
grant execute on function public.create_auction_topic(text, text, text, integer, jsonb, integer) to authenticated;
