
-- Migration 005: Secure auction bidding

create or replace function public.place_bid(
  p_slot_id uuid,
  p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_team_id uuid;
  v_slot public.slots%rowtype;
  v_old_team uuid;
  v_old_bid integer;
  v_required integer;
  v_balance integer;
begin
  -- 1. Identify authenticated captain
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select m.team_id
  into v_team_id
  from public.members m
  join public.teams t on t.id = m.team_id
  where m.id = v_user_id
    and t.captain_id = v_user_id;

  if v_team_id is null then
    raise exception 'Only the team captain can bid';
  end if;

  -- 2. Validate bid amount
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid amount must be positive';
  end if;

  -- 3. Lock auction slot to prevent concurrent bids
  select *
  into v_slot
  from public.slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Auction slot not found';
  end if;

  if v_slot.status <> 'open' then
    raise exception 'Auction slot is not open';
  end if;

  if v_slot.end_time is null or v_slot.end_time <= now() then
    raise exception 'Auction slot has expired';
  end if;

  if p_amount <= v_slot.current_bid then
    raise exception 'Bid must exceed current bid';
  end if;

  v_old_team := v_slot.leader_team_id;
  v_old_bid := v_slot.current_bid;

  if v_old_team = v_team_id then
    raise exception 'Your team is already leading this slot';
  end if;

  -- 4. Lock bidder wallet and verify balance
  select w.balance
  into v_balance
  from public.wallets w
  where w.team_id = v_team_id
    and w.round = v_slot.round
  for update;

  if not found then
    raise exception 'Wallet not found for this round';
  end if;

  if v_balance < p_amount then
    raise exception 'Insufficient wallet balance';
  end if;

  -- 5. Refund previous leader's reserved bid
  if v_old_team is not null then
    update public.wallets
    set balance = balance + v_old_bid
    where team_id = v_old_team
      and round = v_slot.round;

    if not found then
      raise exception 'Previous leader wallet not found';
    end if;
  end if;

  -- 6. Reserve new bid amount
  update public.wallets
  set balance = balance - p_amount
  where team_id = v_team_id
    and round = v_slot.round;

  -- 7. Record bid
  insert into public.bids (
    slot_id,
    team_id,
    amount
  )
  values (
    p_slot_id,
    v_team_id,
    p_amount
  );

  -- 8. Update auction slot
  update public.slots
  set current_bid = p_amount,
      leader_team_id = v_team_id
  where id = p_slot_id;

  return jsonb_build_object(
    'success', true,
    'slot_id', p_slot_id,
    'team_id', v_team_id,
    'amount', p_amount,
    'remaining_balance', v_balance - p_amount
  );
end;
$$;

-- Only authenticated users may invoke the function
revoke all on function public.place_bid(uuid, integer) from public;
grant execute on function public.place_bid(uuid, integer) to authenticated;
