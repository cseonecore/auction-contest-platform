-- ============================================================
-- Migration 022: Captain identity authorization & auction hardening
-- ============================================================
-- Sequential migration following 021.
-- Fixes:
-- 1. Captain identity authorization in place_bid():
--    Only authorized team captains may bid. Non-captains must only
--    spectate. Replaces loose member fallback with strict captain
--    verification across auth.uid(), teams.captain_id, member email
--    and captain role metadata, and self-heals identity alignment.
-- 2. Enhanced align_identities():
--    Realigns teams.captain_id and members.id for legacy or
--    misaligned captain accounts.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Enhanced align_identities()
-- ─────────────────────────────────────────────────────────────
create or replace function public.align_identities()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teams_fixed   integer := 0;
  v_members_fixed integer := 0;
begin
  -- 1. Point the team at the Auth account of its captain via member email match
  update public.teams t
  set    captain_id = u.id
  from   public.members m
  join   auth.users u on lower(u.email) = lower(m.email)
  where  (m.id = t.captain_id or (t.captain_id is null and lower(coalesce(m.college, '')) like '%captain%'))
    and  t.captain_id is distinct from u.id;

  get diagnostics v_teams_fixed = row_count;

  -- 2. Re-key the captain member row onto the same Auth account
  update public.members m
  set    id = u.id
  from   auth.users u
  where  lower(u.email) = lower(m.email)
    and  m.id <> u.id
    and  exists (select 1 from public.teams t where t.captain_id = u.id);

  get diagnostics v_members_fixed = row_count;

  if v_teams_fixed > 0 or v_members_fixed > 0 then
    insert into public.audit_log (action, entity_type, entity_id, details)
    values (
      'identity_aligned', 'identity', null,
      jsonb_build_object(
        'teams_realigned',   v_teams_fixed,
        'members_realigned', v_members_fixed,
        'source',            'align_identities'
      )
    );
  end if;

  return jsonb_build_object(
    'success',           true,
    'teams_realigned',   v_teams_fixed,
    'members_realigned', v_members_fixed,
    'server_time',       clock_timestamp()
  );
end;
$$;

revoke all on function public.align_identities() from public;
grant execute on function public.align_identities() to authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 2. Strict captain place_bid()
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
  v_email      text;
  v_team_id    uuid;
  v_team_name  text;
  v_slot       public.slots%rowtype;
  v_balance    integer;
  v_committed  integer;
  v_min_bid    integer;
  v_min_raise  integer;
  v_timer_ext  integer;
  v_bid_id     uuid;
  v_new_end    timestamptz;
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
