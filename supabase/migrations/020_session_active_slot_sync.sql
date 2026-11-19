-- ============================================================
-- Migration 020: keep `auction_sessions.active_slot_id` in sync
-- ============================================================
-- Defect fixed
-- -------------
-- The admin "Open Slot" button calls `open_bidding(slot_id)` directly,
-- without first calling `select_auction_question()`. `open_slot()` only
-- attached the slot to the session (`slots.session_id`) and never wrote
-- `auction_sessions.active_slot_id`, so the session did not know which
-- item was live.
--
-- Consequences:
--   * `pause_auction()` looked up `active_slot_id`, found NULL, and did
--     NOT freeze the live item's clock. The countdown kept running while
--     the auction was paused, so on resume the item could already be
--     expired and participants could no longer bid.
--   * `resume_auction()` likewise had no item to restore.
--
-- Fix
-- ---
--   1. `open_slot()` records the live item on the session.
--   2. `open_bidding()` records it too (defence in depth, and repairs any
--      slot opened by an older client build before this migration).
--   3. `pause_auction()` / `resume_auction()` fall back to the single
--      `status = 'open'` slot when `active_slot_id` is still NULL, so
--      items opened before this migration pause correctly as well.
--
-- No RPC signature, table, policy or grant changes: this migration only
-- replaces the four function bodies. UI and state management are
-- untouched.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. open_slot — link the opened item to its session
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

  -- IMPORTANT: the session must know which item is live so the pause /
  -- resume pair can freeze and restore that item's clock.
  if v_session is not null then
    update public.auction_sessions
    set  active_slot_id = p_slot_id,
         updated_at     = clock_timestamp()
    where id = v_session;
  end if;

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
-- 2. open_bidding — persist the live item pointer
-- ─────────────────────────────────────────────────────────────
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
  set status         = 'bidding_open',
      is_paused      = false,
      active_slot_id = v_target,
      updated_at     = clock_timestamp()
  where id = v_session.id;

  return v_result || jsonb_build_object('session_id', v_session.id, 'session_status', 'bidding_open');
end;
$$;

revoke all on function public.open_bidding(uuid) from public;
grant execute on function public.open_bidding(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. pause_auction — freeze the live item even for sessions that
--    were opened before `active_slot_id` was recorded
-- ─────────────────────────────────────────────────────────────
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

  -- Fallback: an item opened before migration 020 has no pointer yet.
  if not found then
    select * into v_slot
    from public.slots s
    where s.status = 'open'
    order by s.round, s.question_number nulls last, s.id
    limit 1
    for update;
  end if;

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


-- ─────────────────────────────────────────────────────────────
-- 4. resume_auction — restore the frozen clock on the same item
-- ─────────────────────────────────────────────────────────────
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

  -- Fallback for items opened before migration 020.
  if not found then
    select * into v_slot
    from public.slots s
    where s.status = 'open'
    order by s.round, s.question_number nulls last, s.id
    limit 1
    for update;
  end if;

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
