-- Migration 009: Admin Auction Features (Starting Points, Full Reset, and Add Topic)
-- ============================================================
-- 1. Adds `min_bid` column to `public.slots` to store configured starting points.
-- 2. Updates `open_slot` to accept `p_starting_bid integer default 10` and enforce single active slot.
-- 3. Updates `place_bid` to enforce `min_bid` when no bids have been placed yet.
-- 4. Creates `reset_auction` RPC for atomic full reset of slots, bids, and wallets.
-- 5. Creates `create_auction_topic` RPC for atomic creation of topics and associated slots.
-- ============================================================

-- Step 1: Add min_bid column to slots
alter table public.slots
add column if not exists min_bid integer not null default 10 check (min_bid > 0);

comment on column public.slots.min_bid is
  'Minimum opening bid points for this slot, configured by admin before opening.';

-- Step 1B: Verify and enforce exactly one active auction slot at database level
do $$
declare
  v_open_count integer;
begin
  select count(*) into v_open_count
  from public.slots
  where status = 'open';

  if v_open_count > 1 then
    raise exception 'Cannot create unique index slots_single_open_idx: % open slots already exist in database. Resolve multiple open slots before applying migration.', v_open_count;
  end if;
end $$;

create unique index if not exists slots_single_open_idx
on public.slots (status)
where status = 'open';

comment on index public.slots_single_open_idx is
  'Database invariant enforcing at most one active auction slot with status open across the entire contest.';

-- Step 1C: Verify and prevent duplicate topic titles at database level
do $$
declare
  v_dup_title text;
  v_dup_count integer;
begin
  select min(trim(title)), count(*)
  into v_dup_title, v_dup_count
  from public.topics
  group by lower(trim(title))
  having count(*) > 1
  limit 1;

  if v_dup_title is not null then
    raise exception 'Cannot create unique index topics_title_lower_idx: duplicate topic title "%" exists (% occurrences) in database. Resolve duplicate topics before applying migration.', v_dup_title, v_dup_count;
  end if;
end $$;

create unique index if not exists topics_title_lower_idx
on public.topics (lower(trim(title)));

comment on index public.topics_title_lower_idx is
  'Guarantees case-insensitive uniqueness of topic titles at database level.';

-- Step 2: Drop existing open_slot(uuid) to replace with open_slot(uuid, integer)
drop function if exists public.open_slot(uuid);

create or replace function public.open_slot(
  p_slot_id      uuid,
  p_starting_bid integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot      public.slots%rowtype;
  v_end       timestamptz;
  v_open_secs integer := 10; -- Rule Book §5.2: 10s opening window
begin
  if not public.is_admin() then
    raise exception 'Admin access required to open auction slots';
  end if;

  if p_starting_bid is null or p_starting_bid <= 0 then
    raise exception 'Starting bid points must be a positive integer';
  end if;

  -- Enforce single active slot rule on database level
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

  -- 10-second opening window (Rule Book §5.2)
  v_end := clock_timestamp() + make_interval(secs => v_open_secs);

  begin
    update public.slots
    set  status   = 'open',
         end_time = v_end,
         min_bid  = p_starting_bid
    where id = p_slot_id;
  exception
    when unique_violation then
      raise exception 'Another auction slot is already open for bidding. Close or skip it before opening a new slot.';
  end;

  -- Audit
  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'slot_opened', 'slot', p_slot_id,
    jsonb_build_object(
      'round',        v_slot.round,
      'topic_id',     v_slot.topic_id,
      'end_time',     v_end,
      'starting_bid', p_starting_bid
    )
  );

  return jsonb_build_object(
    'success',      true,
    'slot_id',      p_slot_id,
    'status',       'open',
    'end_time',     v_end,
    'starting_bid', p_starting_bid
  );
end;
$$;

revoke all    on function public.open_slot(uuid, integer) from public;
grant execute on function public.open_slot(uuid, integer) to authenticated;


-- Step 3: Update place_bid to use v_slot.min_bid when leader_team_id is null
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
  v_slot       public.slots%rowtype;
  v_balance    integer;
  v_won_round  boolean;
  v_min_bid    integer;
  v_timer_ext  integer := 5; -- Rule Book §5.2: adds 5 seconds
begin
  -- ── 1. Caller must be authenticated ────────────────────────
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- ── 2. Caller must be the team captain ─────────────────────
  select t.id
  into   v_team_id
  from   public.teams t
  where  t.captain_id = v_user_id
  limit 1;

  if v_team_id is null then
    select m.team_id
    into   v_team_id
    from   public.members m
    join   public.teams   t on t.id = m.team_id
    where  m.id         = v_user_id
      and  t.captain_id = v_user_id
    limit 1;
  end if;

  if v_team_id is null then
    raise exception 'Only the team captain can place bids';
  end if;

  -- ── 3. Basic amount sanity ──────────────────────────────────
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid amount must be a positive integer';
  end if;

  -- ── 4. Lock the slot row (prevents race conditions) ─────────
  select *
  into   v_slot
  from   public.slots
  where  id = p_slot_id
  for    update;

  if not found then
    raise exception 'Auction slot not found';
  end if;

  -- ── 5. Slot must be open ────────────────────────────────────
  if v_slot.status <> 'open' then
    raise exception 'This auction slot is not open for bidding';
  end if;

  -- ── 6. Slot must not have expired ───────────────────────────
  if v_slot.end_time is null or v_slot.end_time <= clock_timestamp() then
    raise exception 'This auction slot has expired';
  end if;

  -- ── 7. Minimum bid calculation ─────────────────────────────
  --    If no bids have been placed yet (leader_team_id is null),
  --    the opening minimum bid is the configured slot min_bid.
  --    If bids already exist, raise must be at least 10 above current_bid.
  if v_slot.leader_team_id is null then
    v_min_bid := coalesce(v_slot.min_bid, 10);
  else
    v_min_bid := v_slot.current_bid + 10;
  end if;

  if p_amount < v_min_bid then
    raise exception
      'Bid too low. Minimum required bid is % pts.',
      v_min_bid;
  end if;

  -- ── 8. Cannot re-bid while already leading ──────────────────
  if v_slot.leader_team_id = v_team_id then
    raise exception 'Your team is already the highest bidder on this slot';
  end if;

  -- ── 9. One slot per round: team must not have already won ────
  select exists(
    select 1
    from   public.slots s
    where  s.winner_team_id = v_team_id
      and  s.round          = v_slot.round
      and  s.status         = 'sold'
  )
  into v_won_round;

  if v_won_round then
    raise exception
      'Your team has already won a slot in Round %. Each team may win one slot per round.',
      v_slot.round;
  end if;

  -- ── 10. Balance check: can the team afford to WIN this bid? ──
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
  values (p_slot_id, v_team_id, p_amount);

  -- ── 12. Update slot: new leader, new current bid, +5s timer ─
  update public.slots
  set  current_bid    = p_amount,
       leader_team_id = v_team_id,
       end_time       = end_time + make_interval(secs => v_timer_ext)
  where id = p_slot_id;

  -- ── 13. Return result ───────────────────────────────────────
  return jsonb_build_object(
    'success',        true,
    'slot_id',        p_slot_id,
    'team_id',        v_team_id,
    'amount',         p_amount,
    'wallet_balance', v_balance
  );
end;
$$;

revoke all    on function public.place_bid(uuid, integer) from public;
grant execute on function public.place_bid(uuid, integer) to authenticated;


-- Step 4: Create reset_auction RPC for atomic full reset
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
begin
  -- 1. Must be admin
  if not public.is_admin() then
    raise exception 'Admin access required to reset auction';
  end if;

  -- 2. Lock tables to prevent concurrent race conditions
  lock table public.slots in exclusive mode;
  lock table public.bids in exclusive mode;
  lock table public.wallets in exclusive mode;

  -- 3. Retrieve configured starting balance from settings, fallback to 100
  select coalesce(
    case 
      when jsonb_typeof(value) = 'number' then (value)::text::integer
      when jsonb_typeof(value) = 'string' then (value #>> '{}')::integer
      else (value->>'starting_wallet_balance')::integer
    end,
    100
  )
  into v_starting_balance
  from public.settings
  where key = 'starting_wallet_balance';

  if v_starting_balance is null or v_starting_balance <= 0 then
    v_starting_balance := 100;
  end if;

  -- 4. Delete all auction bids
  delete from public.bids
  where id is not null;
  get diagnostics v_bids_deleted = row_count;

  -- 5. Reset all slots to initial pending state
  update public.slots
  set status         = 'pending',
      current_bid    = 0,
      min_bid        = 10,
      leader_team_id = null,
      winner_team_id = null,
      end_time       = null
  where id is not null;
  get diagnostics v_slots_reset = row_count;

  -- 6. Restore all team wallets to original starting balance
  insert into public.wallets (team_id, balance)
  select id, v_starting_balance from public.teams
  on conflict (team_id) do update set balance = v_starting_balance;
  get diagnostics v_wallets_reset = row_count;

  -- 7. Audit log entry
  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'auction_reset', 'auction', null,
    jsonb_build_object(
      'slots_reset',      v_slots_reset,
      'bids_deleted',     v_bids_deleted,
      'wallets_reset',    v_wallets_reset,
      'starting_balance', v_starting_balance,
      'timestamp',        clock_timestamp()
    )
  );

  return jsonb_build_object(
    'success',          true,
    'slots_reset',      v_slots_reset,
    'bids_deleted',     v_bids_deleted,
    'wallets_reset',    v_wallets_reset,
    'starting_balance', v_starting_balance
  );
end;
$$;

revoke all    on function public.reset_auction() from public;
grant execute on function public.reset_auction() to authenticated;


-- Step 5: Create create_auction_topic RPC for atomic topic and slot creation
create or replace function public.create_auction_topic(
  p_title        text,
  p_description  text,
  p_level        text,
  p_starting_bid integer default 10,
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

  if p_starting_bid is null or p_starting_bid <= 0 then
    raise exception 'Starting bid must be a positive integer';
  end if;

  if p_slots_count is null or p_slots_count < 1 or p_slots_count > 5 then
    p_slots_count := 1;
  end if;

  -- Check for duplicate title
  if exists (
    select 1 from public.topics
    where lower(title) = lower(trim(p_title))
  ) then
    raise exception 'A topic with title "%" already exists', trim(p_title);
  end if;

  v_round := case when p_level = 'easy' then 1 else 2 end;

  -- Insert topic
  begin
    insert into public.topics (level, title, description, criterion)
    values (
      p_level,
      trim(p_title),
      nullif(trim(p_description), ''),
      p_criterion
    )
    returning id into v_topic_id;
  exception
    when unique_violation then
      raise exception 'A topic with title "%" already exists', trim(p_title);
  end;

  -- Create slot(s) for this topic
  for v_i in 1..p_slots_count loop
    insert into public.slots (topic_id, round, status, current_bid, min_bid)
    values (v_topic_id, v_round, 'pending', 0, p_starting_bid)
    returning id into v_slot_id;

    v_slots := v_slots || jsonb_build_object('slot_id', v_slot_id, 'round', v_round);
  end loop;

  -- Audit log
  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'topic_created', 'topic', v_topic_id,
    jsonb_build_object(
      'title',        trim(p_title),
      'level',        p_level,
      'round',        v_round,
      'starting_bid', p_starting_bid,
      'slots_count',  p_slots_count
    )
  );

  return jsonb_build_object(
    'success',      true,
    'topic_id',     v_topic_id,
    'title',        trim(p_title),
    'level',        p_level,
    'round',        v_round,
    'starting_bid', p_starting_bid,
    'slots',        v_slots
  );
end;
$$;

revoke all    on function public.create_auction_topic(text, text, text, integer, jsonb, integer) from public;
grant execute on function public.create_auction_topic(text, text, text, integer, jsonb, integer) to authenticated;
