-- ============================================================
-- Migration 024: Captain-only login, team-based bid authorisation
-- ============================================================
-- Login is now strictly captain-only: `/api/login` signs in the
-- designated captain's Auth account and rejects every other roster
-- row. Teammates are never issued an Auth account during registration,
-- so they cannot log in at all.
--
-- Because the application layer already guarantees that only the
-- captain can be signed in, `place_bid()` no longer needs a separate
-- "only the team captain" gate. Instead it resolves the caller to the
-- team they belong to (captain or teammate) and still guarantees that
-- a caller can only ever bid for their own team. This removes the
-- brittle captain-identity check that could reject a legitimate
-- captain when `members.id` / `teams.captain_id` were out of sync,
-- while keeping the actual security boundary intact.
-- ============================================================

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
  v_user_id       uuid;
  v_email         text;
  v_team_id       uuid;
  v_team_name     text;
  v_is_captain    boolean := false;
  v_slot          public.slots%rowtype;
  v_balance       integer;
  v_min_bid       integer;
  v_min_raise     integer;
  v_timer_ext     integer;
  v_bid_id        uuid;
  v_new_end       timestamptz;
  v_won_count     integer := 0;
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

  -- ── 2. Resolve the caller's team ────────────────────────────
  -- Primary: canonical chain teams.captain_id = auth.uid()
  select t.id, t.name
  into   v_team_id, v_team_name
  from   public.teams t
  where  t.captain_id = v_user_id
  limit  1;

  -- Secondary: teams.captain_id points to the captain's member row
  if v_team_id is null then
    select t.id, t.name
    into   v_team_id, v_team_name
    from   public.teams t
    join   public.members m on m.id = t.captain_id
    where  m.id = v_user_id
       or  (v_email <> '' and lower(m.email) = v_email)
    limit  1;
  end if;

  -- Tertiary: any member row that belongs to a team
  if v_team_id is null then
    select t.id, t.name
    into   v_team_id, v_team_name
    from   public.teams t
    join   public.members m on m.team_id = t.id
    where  m.id = v_user_id
       or  (v_email <> '' and lower(m.email) = v_email)
    limit  1;
  end if;

  if v_team_id is null then
    raise exception 'You are not registered with any team';
  end if;

  -- Only a genuine captain may repair/promote the canonical identity
  -- chain. A teammate bid must never overwrite teams.captain_id.
  select exists (
    select 1
    from   public.teams t
    where  t.id = v_team_id
      and  (
        t.captain_id = v_user_id
        or (
          v_email <> ''
          and exists (
            select 1
            from   public.members cap
            where  cap.id = t.captain_id
              and  lower(coalesce(cap.email, '')) = v_email
          )
        )
      )
  )
  into v_is_captain;

  if not v_is_captain then
    -- app_metadata is written only by the server/admin API, so a
    -- participant cannot promote themselves to captain.
    v_is_captain := coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      ''
    ) = 'captain';
  end if;

  if v_is_captain then
    update public.teams
    set    captain_id = v_user_id
    where  id = v_team_id
      and  captain_id is distinct from v_user_id;

    update public.members
    set    id = v_user_id
    where  team_id = v_team_id
      and  (id = v_user_id or (v_email <> '' and lower(email) = v_email))
      and  id <> v_user_id;
  end if;

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
