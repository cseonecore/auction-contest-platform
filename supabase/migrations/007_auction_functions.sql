-- Migration 007: Auction lifecycle functions
-- ============================================================
-- Rewrites place_bid to match the Rule Book wallet model
-- (losing bids free, deduction on win only) and adds the three
-- admin-facing slot lifecycle functions.
--
-- Rule Book v1.0 constraints enforced:
--  §5.1  Every team has 100 points in one wallet.
--  §5.1  Losing bids cost nothing. Deductions occur only in close_slot on WIN.
--  §5.2  Opening window: 10 seconds.
--  §5.2  Valid bid adds 5 seconds to clock.
--  §5.3  Opening bid minimum: 10 pts.
--  §5.3  Minimum raise: 10 pts above current bid.
--  §5.3  Only captain can place bids.
--  §5.3  One slot won per round per team.
--  §5.3  Team cannot re-bid while already leading.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. place_bid(p_slot_id, p_amount)
--    Called from the frontend via supabase.rpc('place_bid', {...})
--    NO wallet deduction here — losing bids cost nothing.
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
  -- Check via teams.captain_id matching auth.uid() directly or via members table
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

  -- ── 7. Minimum bid & minimum raise (both = 10 pts) ──────────
  --    If no current bids (current_bid = 0), opening minimum is 10.
  --    If bids already exist, raise must be at least 10 above current_bid.
  if v_slot.current_bid = 0 then
    v_min_bid := 10;
  else
    v_min_bid := v_slot.current_bid + 10;
  end if;

  if p_amount < v_min_bid then
    raise exception
      'Bid too low. Current bid is % pts — minimum next bid is % pts.',
      v_slot.current_bid, v_min_bid;
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
  --     Losing bids cost nothing, but we verify the team can pay
  --     p_amount if they close as the winner.
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
  --     NO wallet deduction — losing bids cost nothing.
  --     Deduction happens only in close_slot() when the team wins.
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


-- ─────────────────────────────────────────────────────────────
-- 2. open_slot(p_slot_id)
--    Admin-only. Transitions a slot from pending → open.
--    Sets the 10-second opening window (Rule Book §5.2).
-- ─────────────────────────────────────────────────────────────
create or replace function public.open_slot(p_slot_id uuid)
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

  update public.slots
  set  status   = 'open',
       end_time = v_end
  where id = p_slot_id;

  -- Audit
  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'slot_opened', 'slot', p_slot_id,
    jsonb_build_object(
      'round',    v_slot.round,
      'topic_id', v_slot.topic_id,
      'end_time', v_end
    )
  );

  return jsonb_build_object(
    'success',  true,
    'slot_id',  p_slot_id,
    'status',   'open',
    'end_time', v_end
  );
end;
$$;

revoke all    on function public.open_slot(uuid) from public;
grant execute on function public.open_slot(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. close_slot(p_slot_id)
--    Admin-only. Transitions an open slot to sold or skipped.
--    THIS is the only place where the wallet is deducted.
-- ─────────────────────────────────────────────────────────────
create or replace function public.close_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot    public.slots%rowtype;
  v_balance integer;
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

  if v_slot.status <> 'open' then
    raise exception
      'Only open slots can be closed. Current status: %', v_slot.status;
  end if;

  -- Case A: No bids were placed → skip the slot (Rule Book §5.2 step 2)
  if v_slot.leader_team_id is null then
    update public.slots
    set  status         = 'skipped',
         winner_team_id = null
    where id = p_slot_id;

    insert into public.audit_log (action, entity_type, entity_id, details)
    values (
      'slot_skipped', 'slot', p_slot_id,
      jsonb_build_object('reason', 'no_bids', 'round', v_slot.round)
    );

    return jsonb_build_object(
      'success', true,
      'status',  'skipped',
      'slot_id', p_slot_id
    );
  end if;

  -- Case B: Bids exist → deduct winning amount from winner's wallet
  select w.balance
  into   v_balance
  from   public.wallets w
  where  w.team_id = v_slot.leader_team_id
  for    update;

  if not found then
    raise exception 'Winner wallet not found';
  end if;

  if v_balance < v_slot.current_bid then
    raise exception
      'Winner has insufficient balance (% pts available, % pts required). '
      'Manual intervention required.',
      v_balance, v_slot.current_bid;
  end if;

  -- ── THE ONLY WALLET DEDUCTION IN THE ENTIRE AUCTION ─────────
  update public.wallets
  set  balance = balance - v_slot.current_bid
  where team_id = v_slot.leader_team_id;

  -- Mark slot as sold with winner
  update public.slots
  set  status         = 'sold',
       winner_team_id = v_slot.leader_team_id
  where id = p_slot_id;

  -- Audit
  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'slot_sold', 'slot', p_slot_id,
    jsonb_build_object(
      'winner_team_id', v_slot.leader_team_id,
      'winning_bid',    v_slot.current_bid,
      'round',          v_slot.round
    )
  );

  return jsonb_build_object(
    'success',        true,
    'status',         'sold',
    'slot_id',        p_slot_id,
    'winner_team_id', v_slot.leader_team_id,
    'winning_bid',    v_slot.current_bid,
    'new_balance',    v_balance - v_slot.current_bid
  );
end;
$$;

revoke all    on function public.close_slot(uuid) from public;
grant execute on function public.close_slot(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. skip_slot(p_slot_id)
--    Admin override: skip a pending or open slot immediately.
--    No wallet changes (no bid was won).
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

  -- Reset slot to a clean skipped state; no wallet changes
  update public.slots
  set  status         = 'skipped',
       winner_team_id = null,
       leader_team_id = null,
       current_bid    = 0,
       end_time       = null
  where id = p_slot_id;

  insert into public.audit_log (action, entity_type, entity_id, details)
  values (
    'slot_skipped', 'slot', p_slot_id,
    jsonb_build_object(
      'reason', 'admin_override',
      'round',  v_slot.round
    )
  );

  return jsonb_build_object(
    'success', true,
    'status',  'skipped',
    'slot_id', p_slot_id
  );
end;
$$;

revoke all    on function public.skip_slot(uuid) from public;
grant execute on function public.skip_slot(uuid) to authenticated;
