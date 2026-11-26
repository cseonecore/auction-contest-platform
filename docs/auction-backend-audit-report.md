# Bid2Build — Auction Backend Architecture Audit

Everything below is from `supabase/migrations/*` (applied in filename order, last-writer-wins on `create or replace`) and `docs/auction-architecture.md`, `docs/auction-database-contract.md`, `docs/auction-realtime-events.md`.

---

## 1. Slot opening / completion — the function inventory

### 1.1 Opening (pending → open)

| Function | Signature | Notes |
|---|---|---|
| `open_slot()` | `open_slot(p_slot_id uuid, p_starting_bid integer default null)` → `jsonb` | Current definition: migration **023_three_round_auction.sql:181-287** (also 020:36-149). Re-opened in 023 to allow reopening `pending` **and `skipped`** slots ("in later rounds"). |
| `open_bidding()` | `open_bidding(p_slot_id uuid default null)` → `jsonb` | 015:708-741 (redefined 020:158-194). Resolves target as `coalesce(p_slot_id, v_session.active_slot_id)` and calls `open_slot()`. |
| `select_auction_question()` | `select_auction_question(p_slot_id uuid)` → `jsonb` | 015:633-702. Admin; sets `slots.session_id` and `auction_sessions.active_slot_id`, moves session to `question_selection`. |

### 1.2 Completion (open → sold / skipped)

| Function | Signature | Notes |
|---|---|---|
| `close_slot()` | `close_slot(p_slot_id uuid)` → `jsonb` | Current: wrapper in **021_auction_bugfixes.sql:452-465** delegating to `settle_slot()`. |
| `settle_slot()` | `settle_slot(p_slot_id uuid)` → `jsonb` | Current: **021_auction_bugfixes.sql:305-444** (recreated verbatim by **029_restore_missing_functions.sql:34-173** because production was missing it). This is the authoritative finaliser. |
| `skip_slot()` | `skip_slot(p_slot_id uuid)` → `jsonb` | 015:487-537 → redefined 021:537-588. Admin override: `pending` or `open` → `skipped`. |
| `settle_expired_slots()` | `settle_expired_slots()` → `jsonb` | 021:474-528 (restored by 029:181-234). Loops `open`+`running` slots where `end_time <= clock_timestamp()` and settles each with `for update skip locked`; per-item failures are logged to `audit_log` (`slot_settlement_failed`) and the item is left open. |
| `close_bidding()` | `close_bidding(p_slot_id uuid default null)` → `jsonb` | 015:747-781. Wrapper: `close_slot()` + session → `bidding_closed`. |
| `finalize_auction()` | `finalize_auction(p_slot_id uuid default null)` → `jsonb` | 015:787-820. Wrapper: `close_slot()` + session → `solving`. |

### 1.3 Bidding write path

| Function | Signature | Notes |
|---|---|---|
| `place_bid()` | `place_bid(p_slot_id uuid, p_amount integer)` → `jsonb` | Current: **023_three_round_auction.sql:387-609** (evolved 005 → 007 → 009 → 015 → 021 → 022 → 023 → 024). The only participant-facing write; the ONLY place that raises `current_bid`. |

### 1.4 Live-state reads

| Function | Signature | Notes |
|---|---|---|
| `get_live_auction_state()` | `get_live_auction_state()` → `jsonb` | Current: **023_three_round_auction.sql:707-892** (redefined at 017:15-194, 021:859-1039, 023, 026:~500). Current calls `settle_expired_slots()` first and returns session, active slot, bids, teams, settings, last-40 events, eliminations. |
| `get_current_auction_item()` | `get_current_auction_item()` → `jsonb` | 017:203-216 — returns `get_live_auction_state() → 'active_slot'`. |
| `get_auction_history(p_limit integer default 100)` | → `jsonb` | 017:225-263. |
| `get_team_auction_state(p_team_id uuid)` | → `jsonb` | 017:318-371 / 021:1048-1117. |
| `get_team_bid_history(p_team_id uuid)` | → `jsonb` | 017:272-309. |
| `get_team_points_balance(p_team_id uuid)` | → `jsonb` | 012_wallet_ledger.sql:173-218. |

### 1.5 Verbatim: current `open_slot()` (023, lines 181-287)

```sql
create or replace function public.open_slot(
  p_slot_id       uuid,
  p_starting_bid  integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
  if exists (select 1 from public.slots where status = 'open' and id <> p_slot_id) then
    raise exception 'Another auction slot is already open for bidding. Close or skip it before opening a new slot.';
  end if;
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then
    raise exception 'Slot not found';
  end if;
  if v_slot.status not in ('pending', 'skipped') then
    raise exception 'Only pending or skipped slots can be opened. Current status: %', v_slot.status;
  end if;
  if exists (select 1 from public.slots s where s.topic_id = v_slot.topic_id and s.status = 'sold') then
    raise exception 'This problem statement has already been sold and cannot be auctioned again.';
  end if;
  v_window  := greatest(public.get_setting_int('opening_window_seconds', 10), 1);
  v_min_bid := coalesce(p_starting_bid,
    greatest(coalesce(v_slot.min_bid, 0), public.get_setting_int('min_bid', 10)));
  v_end := clock_timestamp() + make_interval(secs => v_window);
  -- Attach the item to the active session, if there is one.
  select * into v_session from public.auction_sessions s
  where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                     'finalizing','question_assigned','solving')
  order by s.created_at desc limit 1;
  if v_session.id is not null then
    update public.auction_sessions set active_slot_id = p_slot_id,
      updated_at = clock_timestamp() where id = v_session.id;
  end if;
  update public.slots set
    status = 'open', current_bid = 0, min_bid = v_min_bid,
    round = coalesce(v_session.round, v_slot.round),
    end_time = v_end, leader_team_id = null, winner_team_id = null,
    timer_status = 'running', timer_started_at = clock_timestamp(),
    timer_paused_at = null, paused_remaining_seconds = v_window, sold_at = null
  where id = p_slot_id;
  return jsonb_build_object('success', true, 'slot_id', p_slot_id, 'status', 'open',
    'round', coalesce(v_session.round, v_slot.round), 'end_time', v_end,
    'window_seconds', v_window, 'min_bid', v_min_bid, 'starting_bid', v_min_bid,
    'server_time', clock_timestamp());
end;
$$;
-- grants: authenticated, service_role   (023:289-290; 020:151-152)
```

### 1.6 Verbatim: `settle_slot()` — the "close_slot" engine (021:305-444)

```sql
create or replace function public.settle_slot(p_slot_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_slot     public.slots%rowtype;
  v_balance  integer; v_bid_id uuid; v_session uuid; v_topic text;
begin
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then raise exception 'Slot not found'; end if;
  if v_slot.status <> 'open' then
    raise exception 'Only open slots can be settled. Current status: %', v_slot.status;
  end if;
  select t.title into v_topic from public.topics t where t.id = v_slot.topic_id;
  select s.id into v_session from public.auction_sessions s where s.active_slot_id = p_slot_id limit 1;
  if v_session is null then
    select s.id into v_session from public.auction_sessions s
    where s.status in ('ready','question_selection','bidding_open','bidding_closed',
                       'finalizing','question_assigned','solving')
    order by s.created_at desc limit 1;
  end if;
  -- ── Case A: no bids → unsold ────────────────────────────────
  if v_slot.leader_team_id is null then
    update public.slots set status = 'skipped', winner_team_id = null,
      timer_status = 'completed', timer_paused_at = null, sold_at = clock_timestamp()
    where id = p_slot_id;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'slot_unsold', 'slot', p_slot_id,
      jsonb_build_object('reason','no_bids','round',v_slot.round,'topic_title',v_topic));
    if v_session is not null then
      update public.auction_sessions set status = 'bidding_closed', updated_at = clock_timestamp()
      where id = v_session and status in ('bidding_open','finalizing');
    end if;
    return jsonb_build_object('success', true, 'status','skipped', 'outcome','unsold',
      'slot_id', p_slot_id, 'topic_title', v_topic, 'server_time', clock_timestamp());
  end if;
  -- ── Case B: a winner exists → exactly one wallet debit ──────
  select b.id into v_bid_id from public.bids b
  where b.slot_id = p_slot_id and b.team_id = v_slot.leader_team_id
  order by b.server_time desc, b.id desc limit 1;
  perform public.apply_wallet_transaction(
    v_slot.leader_team_id, 'win_deduction', -v_slot.current_bid,
    p_slot_id, v_bid_id, auth.uid(), 'Winning bid for auction item',
    jsonb_build_object('round', v_slot.round, 'topic_id', v_slot.topic_id));
  select w.balance into v_balance from public.wallets w where w.team_id = v_slot.leader_team_id;
  update public.slots set status = 'sold', winner_team_id = v_slot.leader_team_id,
    timer_status = 'completed', timer_paused_at = null, sold_at = clock_timestamp()
  where id = p_slot_id;
  insert into public.audit_log (...) values (auth.uid(), v_slot.leader_team_id, 'slot_sold', 'slot',
    p_slot_id, jsonb_build_object('winner_team_id', v_slot.leader_team_id,
    'winning_bid', v_slot.current_bid, 'round', v_slot.round,
    'topic_id', v_slot.topic_id, 'topic_title', v_topic));
  if v_session is not null then
    update public.auction_sessions set status = 'question_assigned', updated_at = clock_timestamp()
    where id = v_session and status in ('bidding_open','bidding_closed','finalizing');
  end if;
  return jsonb_build_object('success', true, 'status','sold', 'slot_id', p_slot_id,
    'winner_team_id', v_slot.leader_team_id, 'winning_bid', v_slot.current_bid,
    'new_balance', v_balance, 'topic_title', v_topic, 'server_time', clock_timestamp());
end;
$$;
-- note: PUBLIC except SET by triggers; settled statuses: sold / skipped(→"unsold" in events)
```

### 1.7 Verbatim: `place_bid()` — current (023:387-609)

```sql
create or replace function public.place_bid(p_slot_id uuid, p_amount integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid; v_email text; v_team_id uuid; v_team_name text;
  v_slot public.slots%rowtype; v_balance integer; v_min_bid integer; v_min_raise integer;
  v_timer_ext integer; v_bid_id uuid; v_new_end timestamptz; v_won_count integer := 0;
  v_session_round integer;
begin
  perform public.settle_expired_slots();              -- 0
  v_user_id := auth.uid(); if v_user_id is null then raise exception 'Authentication required'; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  -- resolve captain chain (teams.captain_id → member via team)
  select t.id, t.name into v_team_id, v_team_name from public.teams t where t.captain_id = v_user_id limit 1;
  if v_team_id is null then select t.id, t.name into v_team_id, v_team_name
    from public.teams t join public.members m on m.id = t.captain_id where m.id = v_user_id or (v_email<>'' and lower(m.email)=v_email) limit 1;
  end if;
  if v_team_id is null then
    select t.id, t.name into v_team_id, v_team_name
    from public.teams t join public.members m on m.team_id = t.id
    where lower(m.email) = v_email
      and (t.captain_id is null or lower(coalesce(m.college,'')) like '%captain%'
           or lower(m.name) like '%captain%'
           or coalesce(auth.jwt()->'user_metadata'->>'role','') = 'captain'
           or coalesce(auth.jwt()->'app_metadata'->>'role','') = 'captain') limit 1;
  end if;
  if v_team_id is null then raise exception 'Only the team captain can place bids'; end if;
  -- self-heal identity (auto-align)
  update public.teams set captain_id = v_user_id where id = v_team_id and (captain_id is null or captain_id <> v_user_id);
  update public.members set id = v_user_id where team_id = v_team_id and (id = v_user_id or (v_email<>'' and lower(email)=v_email)) and id <> v_user_id;
  if public.team_is_eliminated(v_team_id) then raise exception 'Your team has been eliminated and can no longer bid'; end if;
  -- universal 2-question limit + round-3 recovery exclusion
  select count(*) into v_won_count from public.slots where winner_team_id = v_team_id and status = 'sold';
  select s.round into v_session_round from public.auction_sessions s
    where s.status in ('ready','question_selection','bidding_open','bidding_closed','finalizing','question_assigned','solving')
    order by s.created_at desc limit 1;
  if coalesce(v_session_round, 1) = 3 and v_won_count >= 2 then
    raise exception 'Your team already has 2 problem statements and cannot participate in the Round 3 recovery auction.';
  end if;
  if v_won_count >= 2 then
    raise exception 'Your team has already acquired the maximum limit of 2 problem statements.';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Bid amount must be a positive integer'; end if;
  select * into v_slot from public.slots where id = p_slot_id for update;
  if v_slot.status <> 'open' then raise exception 'This auction slot is not open for bidding'; end if;
  if v_slot.end_time is not null and clock_timestamp() > v_slot.end_time then
    raise exception 'This auction slot is not open for bidding (expired)';
  end if;
  if v_slot.timer_status = 'paused' then raise exception 'Bidding is currently paused'; end if;
  if v_slot.leader_team_id is not null and v_slot.leader_team_id = v_team_id then
    raise exception 'Your team is already the highest bidder on this slot';
  end if;
  v_min_bid := greatest(public.get_setting_int('min_bid', 10), 1);
  v_min_raise := greatest(public.get_setting_int('min_raise', 5), 1);
  v_timer_ext := greatest(public.get_setting_int('timer_extension_seconds', 5), 1);
  if v_slot.current_bid = 0 then
    if p_amount < v_min_bid then raise exception 'Bid too low. The opening bid must be at least % pts.', v_min_bid; end if;
  else
    if p_amount < v_slot.current_bid + v_min_raise then
      raise exception 'Bid too low. Current bid is % pts — minimum next bid is % pts.', v_slot.current_bid, v_slot.current_bid + v_min_raise;
    end if;
  end if;
  select coalesce(w.balance, 0) into v_balance from public.wallets w where w.team_id = v_team_id;
  if not found then raise exception 'Wallet not found for team %', v_team_id; end if;
  if p_amount > v_balance then raise exception 'Insufficient balance. Your team has % pts available — cannot bid % pts.', v_balance, p_amount; end if;
  -- extend timer
  if v_slot.end_time is null then
    v_new_end := clock_timestamp() + make_interval(secs => v_timer_ext);
  else
    v_new_end := greatest(v_slot.end_time, clock_timestamp()) + make_interval(secs => v_timer_ext);
  end if;
  update public.slots set current_bid = p_amount, leader_team_id = v_team_id,
    end_time = v_new_end, timer_status = 'running', timer_started_at = coalesce(timer_started_at, clock_timestamp())
  where id = p_slot_id;
  insert into public.bids (slot_id, team_id, amount, server_time)
  values (p_slot_id, v_team_id, p_amount, clock_timestamp()) returning id into v_bid_id;
  return jsonb_build_object('success', true, 'bid_id', v_bid_id, 'slot_id', p_slot_id,
    'team_id', v_team_id, 'team_name', v_team_name, 'amount', p_amount,
    'current_bid', p_amount, 'min_next_bid', p_amount + v_min_raise,
    'end_time', v_new_end, 'new_end_time', v_new_end, 'server_time', clock_timestamp());
end;
$$;
-- grants: authenticated, service_role   (023:608-609)
```

### 1.8 Verbatim: current `get_live_auction_state()` (023:707-892, key parts)

```sql
create or replace function public.get_live_auction_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.auction_sessions%rowtype; v_slot public.slots%rowtype; v_topic public.topics%rowtype;
  v_leader text; v_winner text; v_bids jsonb; v_teams jsonb; v_settings jsonb;
  v_events jsonb; v_elims jsonb; v_has_slot boolean := false;
  v_min_bid integer := 10; v_min_raise integer := 5;
begin
  perform public.settle_expired_slots();            -- server clock owns expiry
  v_min_raise := greatest(public.get_setting_int('min_raise', 5), 1);
  v_min_bid   := public.get_setting_int('min_bid', 10);
  select * into v_session from public.get_active_session() limit 1;
  select s.* into v_slot from public.slots s where s.status = 'open'
    order by s.round, s.question_number nulls last, s.id limit 1;
  if found then v_has_slot := true;
  elsif v_session.active_slot_id is not null then
    select s.* into v_slot from public.slots s where s.id = v_session.active_slot_id;
    v_has_slot := found;
  end if;
  -- … topic/leader/winner lookups …
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'slot_id',b.slot_id,'team_id',b.team_id,
           'team_name',coalesce(t.name,'Unknown team'),'amount',b.amount,'server_time',b.server_time)
         order by b.server_time desc), '[]'::jsonb) into v_bids
  from public.bids b left join public.teams t on t.id = b.team_id
  where v_has_slot and b.slot_id = v_slot.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,
           'balance',coalesce(w.balance,0),'eliminated',public.team_is_eliminated(t.id),
           'current_bid',coalesce(lb.amount,0),'won_count',coalesce(wq.cnt,0),
           'qualified',(coalesce(wq.cnt,0)>=2),'needs_questions',(coalesce(wq.cnt,0)<2))
         order by t.name), '[]'::jsonb) into v_teams
  from public.teams t left join public.wallets w on w.team_id = t.id
  left join lateral (select count(*) as cnt from public.slots s
                     where s.winner_team_id = t.id and s.status = 'sold') wq on true
  left join lateral (select max(b.amount) as amount from public.bids b
                     where b.team_id = t.id and v_has_slot and b.slot_id = v_slot.id) lb on true;
  -- … settings (min_bid, min_raise, opening_window_seconds, timer_extension_seconds,
  --     bonus_time_seconds, solving_timer_seconds, starting_wallet_balance, bonus_points_rate) …
  -- … last-40 auction_events …
  -- … active team_eliminations …
  return jsonb_build_object('server_time', clock_timestamp(),
    'total_items', (select count(*) from public.slots),
    'items_sold',  (select count(*) from public.slots where status = 'sold'),
    'items_unsold',(select count(*) from public.slots where status in ('skipped','pending')
                     and not exists (select 1 from public.slots k where k.topic_id = public.slots.topic_id and k.status='sold')),
    'items_open',  (select count(*) from public.slots where status = 'open'),
    'session',  case when v_session.id is null then null else jsonb_build_object('id',v_session.id,
                 'status',v_session.status,'round',v_session.round,'is_paused',v_session.is_paused,
                 'timer_status',v_session.timer_status,'timer_ends_at',v_session.timer_ends_at,
                 'paused_remaining_seconds',v_session.paused_remaining_seconds,
                 'total_bonus_seconds',v_session.total_bonus_seconds,
                 'total_manual_extension_seconds',v_session.total_manual_extension_seconds,
                 'active_slot_id',v_session.active_slot_id) end,
    'active_slot', case when v_slot.id is null then null else jsonb_build_object('id',v_slot.id,
                 'status',v_slot.status,'round',v_slot.round,'current_bid',v_slot.current_bid,
                 'min_bid',v_slot.min_bid,
                 'min_next_bid', case when v_slot.leader_team_id is null
                                        then greatest(coalesce(v_slot.min_bid, v_min_bid), v_min_bid)
                                        else v_slot.current_bid + v_min_raise end,
                 'leader_team_id',v_slot.leader_team_id,'leader_team_name',v_leader,
                 'winner_team_id',v_slot.winner_team_id,'winner_team_name',v_winner,
                 'end_time',v_slot.end_time,'timer_status',v_slot.timer_status,
                 'paused_remaining_seconds',v_slot.paused_remaining_seconds,
                 'question_number',v_slot.question_number,
                 'topic', case when v_topic.id is null then null else jsonb_build_object(
                   'id',v_topic.id,'level',v_topic.level,'title',v_topic.title,
                   'description',v_topic.description,'criterion',v_topic.criterion) end) end,
    'bids', coalesce(v_bids,'[]'::jsonb), 'teams', coalesce(v_teams,'[]'::jsonb),
    'settings', coalesce(v_settings,'{}'::jsonb), 'events', coalesce(v_events,'[]'::jsonb),
    'eliminations', coalesce(v_elims,'[]'::jsonb));
end;
$$;
-- grants: authenticated, anon, service_role   (023:894-895)
```

---

## 2. How slot completion is determined — sold vs skipped

**Schema (`public.slots`):** `status` CHECK is `('pending','open','sold','skipped')` (001_initial_schema.sql:41-42). **No `auction_rounds` table and no per-slot "completion" flag** — completion is inferred from `status` (+ `sold_at`, `winner_team_id`, `timer_status='completed'`).

**Where each status is written:**

- **`sold`** —
  1. `settle_slot()` Case B (021:407-413): `status='sold', winner_team_id, timer_status='completed', sold_at=clock_timestamp()`, plus `apply_wallet_transaction(...,'win_deduction', -current_bid, ...)` at 021:392-401.
  2. Session updated to `question_assigned` (021:427-431).
  3. Reached via: `close_slot()` (021:452-465), `advance_auction()` (023:325-327), `complete_next_auction_transition()` (015:1005 via `open_bidding` — note this calls `open_slot` not `close_slot`; see defect notes), `close_bidding()`, `finalize_auction()`, `end_auction_session()` (015:1158-1166).
- **`skipped`** —
  1. `settle_slot()` Case A (021:350-357): `status='skipped', winner_team_id=null, timer_status='completed', sold_at=clock_timestamp()` — **the same `sold_at` is written even for unsold items** (see defect notes).
  2. Session → `bidding_closed` (021:369-373).
  3. Reached via: `close_slot()`, `advance_auction()`, `close_bidding()`, `skip_slot()` (015:515-522, 021:565-573 — which additionally clears `end_time`).
- **`pending`→`open`** — only `open_slot()` (023:259-272) sets `status='open'`, `end_time = clock_timestamp() + opening_window_seconds` (settings), `timer_status='running'`, `current_bid=0`, `leader_team_id=null`, `min_bid` set.
- **Expiry is NOT a slot status.** `place_bid()` and `get_live_auction_state()` call `settle_expired_slots()` (021:884, 023:412, 729), which settles any `status='open' and timer_status='running' and end_time <= clock_timestamp()` slot via `settle_slot()`. A slot therefore becomes `sold`/`skipped` on the first read/bid after the clock expires, or via an admin `close_slot`/`skip_slot`. Note `'expired'` is a legal value of both `slots.timer_status` and `auction_sessions.timer_status` (011:37-38, 72-73) but no code path sets `slots.timer_status='expired'` — everything settles to `'completed'`.
- **`auction_sessions` state machine** (011:25-50): `draft, ready, question_selection, bidding_open, bidding_closed, finalizing, question_assigned, solving, completed, cancelled` — pause is `is_paused` flag, not a state. 023 extends `round` CHECK to (1,2,3).

---

## 3. Round management

**There is no rounds table.** Verified: no `auction_rounds` table exists anywhere in the repo (grep across `supabase/migrations`). 023:24-29 has a guarded `alter table team_allocations ...` for `round` but the table itself doesn't exist in migrations (`information_schema.tables` guard, 023:21-31). Rounds are:

- **`public.slots.round`** — CHECK `in (1,2)` from 001_initial_schema.sql:40, extended to `(1,2,3)` by 023:15-16. Assigned at creation: `create_auction_topic` → `v_round := case when p_level = 'easy' then 1 else 2 end` (021:640, 023 has same); seed inserts via 011:432-447 (`case when n.level='easy' then 1 else 2 end`); reopened slots inherit `coalesce(v_session.round, v_slot.round)` in 023's `open_slot` (023:263).
- **`public.auction_sessions.round`** — `int not null default 1`, CHECK extended to 3 (011:33, 023:19).
- **Round→slot mapping** — `slots.round` is the link; admin `start_auction(p_round)` (015:569, 023:37) and `set_auction_round(p_round)` (023:124-172) set the session round; 023's `start_auction` also emits `round_changed` when switching rounds on an active session.
- **"Next eligible slot" queries** — see §8.
- **Round-3 rules** (023): `place_bid` blocks teams with ≥2 wins in round 3 (023:492-494) and blocks anyone with ≥2 wins universally (023:496-498). `advance_auction()` in round 3 picks `status in ('pending','skipped')` items not yet sold (023:331-354). `finalize_round_3_eliminations()` (023:615-698) eliminates everyone with < 2 sold wins, emits `qualification_finalized`.

---

## 4. Slot ordering

- `slots.question_number` — added in 011:88, populated for seeded slots in 011:449-458 (`case when t.level='easy' then 0 else 10 end + row_number() over (partition by t.level order by t.id)`), set for admin-created topics to `max(question_number)+1` (021:685-687). Indexed with round: `idx_slots_question_number on slots (round, question_number)` (011:460-461).
- **Ordering expression used by every "next slot" query**: `order by s.round, s.question_number nulls last, s.id` (e.g. 023:321, 339, 351; 015:865, 888).
- Other slot indexes: `idx_slots_topic`, `idx_slots_status`, `idx_slots_session` (011:101-103); `slots_topic_sold_once_idx` (partial unique, 011:315-317); `slots_one_active_per_topic_idx` (partial unique, 011:323-325); `slots_single_open_idx` (partial unique on `status='open'`, 009:31-33).

---

## 5. Event stream

**Table** — `public.auction_events` (016:17-28): `id uuid PK`, `session_id → auction_sessions(on delete set null)`, `event_type text`, `slot_id/team_id uuid`, `payload jsonb`, `timer_ends_at/timer_status` (deadline snapshot at event time), `server_timestamp/created_at`. Indexes on created_at desc, (session_id, created_at desc), event_type (016:34-36). Append-only (write revoked from authenticated/anon, granted to service_role, 016:385-387; duplicates-by-id de-dup key documented in docs).

**Emitter** — `emit_auction_event(p_event_type, p_slot_id, p_team_id, p_payload)` (016:42-74, grants to service_role only, 016:76-77). It resolves the active session (`status in ('ready','question_selection','bidding_open','bidding_closed','finalizing','question_assigned','solving')` ordered by `created_at desc`).

**Trigger functions on `public.slots`** — current versions:
- `trg_slots_emit_event()` — `021:735-848` (created as current; earlier 021:83-192 identical to 016's). Emits on INSERT (`bidding_opened` if status='open' else `question_selected`), on status transitions (`bidding_opened`/`auction_finalized`/`slot_updated`), on `current_bid` changes while open (`highest_bid_changed`), on `timer_status` changes (`timer_paused`/`timer_resumed`/`timer_updated`).

**On `public.bids`** — `trg_bids_emit_event()` (016:203-242): `bid_placed`.
**On `public.wallet_transactions`** — `trg_wallet_tx_emit_event()` (016:248-276): `auction_finalized` for `win_deduction`, else `points_changed`.
**On `public.bonus_transactions`** — `trg_bonus_emit_event()` (016:287-315): `bonus_time_granted`.
**On `public.team_eliminations`** — `trg_elimination_emit_event()` (016:326-370): `team_eliminated` / `team_restored`.

**Realtime** — migration **018_rls_hardening.sql:16-33** adds `slots, bids, wallets, settings, teams, auction_sessions, auction_events, wallet_transactions, bonus_transactions, team_eliminations` to `supabase_realtime` (guards `duplicate_object`/`undefined_object`). Contract: clients subscribe to INSERT on `public.auction_events`, de-dup by id, re-read `get_live_auction_state()` on each event (debounced ~120ms; docs/auction-realtime-events.md:70-95).

**Event catalogue** (docs/auction-realtime-events.md:42-62, verified against triggers):
`bidding_opened`, `bidding_closed`, `auction_finalized` (payload status='sold' or 'unsold'), `highest_bid_changed`, `bid_placed`, `timer_paused`, `timer_resumed`, `timer_updated`, `question_selected`, `round_changed`, `auction_started` (via audit_log, no table emit), `auction_completed`, `team_eliminated`, `team_restored`, `bonus_time_granted`, `points_changed`, `slot_updated`, `qualification_finalized`. Client-derived only: `team_outbid`. Not published: `solution_submitted`, `solution_approved`, `solution_rejected`, `solution_reopened`.

Note: slot `status → 'skipped'` maps to event `auction_finalized` with payload `'status'='unsold'` (021:783-808). `skipped` also writes `sold_at` (021:350-357) — a naming inconsistency worth flagging.

---

## 6. Concurrency safeguards

**Row locks (`FOR UPDATE`):**
- `place_bid()` — slot row: 015:87-91 / 023:506-510; wallet row: 015:158-162 / 021:219-223.
- `open_slot()` — existence check (no lock) + slot lock (015:258-269, 023:206-217).
- `close_slot()`/`settle_slot()` — slot lock (015:362-366, 021:318-322).
- `settle_expired_slots()` — `for update skip locked` (021:494).
- `advance_auction()` — open slot `for update` (023:318-323); next slot `for update` (023:332-341).
- `reset_auction()` — `lock table public.slots/bids/wallets/submissions/evaluations/bonus_transactions in exclusive mode` (037:44-49; 021:1520-1522).

**Unique constraints / indexes (the "invariants"):**
- `slots_single_open_idx` — `UNIQUE(status) WHERE status='open'` — at most one open slot (009:31-33). Created after a pre-check `do $$` block that aborts migration if violated (009:18-29).
- `slots_topic_sold_once_idx` — `UNIQUE(topic_id) WHERE status='sold'` — one sale per problem statement (011:315-317).
- `slots_one_active_per_topic_idx` — `UNIQUE(topic_id) WHERE status IN ('pending','open')` (011:323-325).
- `wallet_tx_win_deduction_once_idx` — `UNIQUE(slot_id) WHERE tx_type='win_deduction' and slot_id is not null` (012:83-85) — exactly-once win debit.
- `auction_sessions_single_active_idx` — `UNIQUE(status) WHERE status IN (non-terminal)` (011:58-61).
- `topics_title_lower_idx` — `UNIQUE(lower(trim(title)))` (009:56-57).
- Trigger backstops: `enforce_single_active_slot_per_topic()` on `slots` (`before insert or update of topic_id, status`, 011:332-374) — readable errors instead of raw unique violations; `trg_single_active_slot_per_topic` (011:371-374).

**Idempotency:**
- `close_slot()` 022 version: returns existing `sold`/`skipped` state without re-settling (022:92-110).
- `skip_slot()`: `raise exception` on non-`pending`/`open` statuses — idempotent in effect (admin re-skip rejected).
- `advance_auction()` (015): the `auction_advancing` settings flag rejects double-advances (015:845-854).

---

## 7. Scheduled jobs / waits / NOTIFY — what exists

- **pg_cron / cron schema: NONE.** Repo-wide greps for `pg_cron`, `cron.schedule`, `cron\.` in `supabase/` find nothing (only unrelated "background" CSS/JS matches).
- **NOTIFY / LISTEN:** the only one is `notify pgrst, 'reload schema'` at the end of 001 (?), actually in 011/015/037 (015:1021, 037:148, 011 has it at line ~505?). Effect: PostgREST cache invalidation, not scheduling.
- **Server-side "waits":** none — no `pg_sleep`, no sleeps, no cron. The only delay mechanism is settings-based:
  - `advance_auction()` (015:826-922) sets `settings.next_auction_open_at = clock_timestamp() + make_interval(secs => 3)` (015:877) and `settings.auction_advancing='true'` (015:854).
  - `complete_next_auction_transition()` (015:931-1019) is the poller: checks `v_open_at <= clock_timestamp()` (015:946-950) and, when elapsed, calls `open_bidding(v_next.id)` (015:1005).
  - **Notable:** `complete_next_auction_transition` has **no callers in the repo** — the only reference is its wrapper in `app/features/admin/services/adminAuctionService.ts:132`. In 023, `advance_auction()` was rewritten (023:296-378) to close + select + **open immediately** — the 3-second delay machinery is effectively dead code there. Client-side, the projector does a 15-second heartbeat read (docs/auction-realtime-events.md:104-105); clients reconcile by re-reading `get_live_auction_state()` after each event (docs §3).
- **Clearing of the guard state:** `auction_advancing='false'` and `next_auction_open_at=null` are written in `advance_auction` completion paths (015:899-900, 965-966, 993-994, 1008-1009) and by `reset_auction()` (037:104-105) — "a pending 3-second transition cannot reopen a slot" (037:15-16, 102-105).

---

## 8. Auto-advance RPCs — `advance_auction()` and `complete_next_auction_transition()`

### `advance_auction()` — current (023:296-378)

```sql
create or replace function public.advance_auction() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session  public.auction_sessions%rowtype;
  v_open     public.slots%rowtype; v_next public.slots%rowtype; v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required to advance the auction'; end if;
  select * into v_session from public.get_active_session() limit 1;
  if not found then raise exception 'No active auction session. Start the auction first.'; end if;
  -- Close the running item, if any.
  select * into v_open from public.slots s where s.status = 'open'
    order by s.round, s.question_number nulls last, s.id limit 1 for update;
  if found then perform public.close_slot(v_open.id); end if;
  -- Pick the next pending item matching the current round, or in round 3,
  -- any pending or skipped item that hasn't been sold.
  if v_session.round = 3 then
    select * into v_next from public.slots s where s.status in ('pending','skipped')
      and not exists (select 1 from public.slots k where k.topic_id = s.topic_id and k.status = 'sold')
      order by s.round, s.question_number nulls last, s.id limit 1 for update;
  else
    select * into v_next from public.slots s where s.status = 'pending'
      and s.round = v_session.round
      and not exists (select 1 from public.slots k where k.topic_id = s.topic_id and k.status = 'sold')
      order by s.round, s.question_number nulls last, s.id limit 1 for update;
  end if;
  if not found then
    update public.auction_sessions set status='completed', ended_at=clock_timestamp(), updated_at=clock_timestamp()
    where id = v_session.id;
    return jsonb_build_object('success',true,'session_id',v_session.id,
      'session_status','completed','message','No further auction items remain for this round.');
  end if;
  perform public.select_auction_question(v_next.id);
  v_result := public.open_bidding(v_next.id);
  return v_result || jsonb_build_object('session_id', v_session.id,
    'next_slot_id', v_next.id, 'session_status','bidding_open');
end;
$$;
```

**Next-eligible-slot logic (verbatim, current):**
- 015's variant (lines 879-890, pre-023): `select * into v_next from public.slots s where s.status = 'pending' and s.round = v_session.round and not exists (select 1 from public.slots k where k.topic_id = s.topic_id and k.status = 'sold') order by s.round, s.question_number nulls last, s.id limit 1 for update;` — no round-3 branch.
- 023 adds the round-3 branch above (031:331-354 in 023's advance; also 015:880-890 + 015:974-984 in `complete_next_auction_transition`).
- Same pattern appears in `open_slot`'s "one open at a time" existence check (015:258-263, 020:61-66, 023:206-211) and `get_live_auction_state`'s "active slot" select (015:862-867, 023:737-741, 021:891-895).

### `complete_next_auction_transition()` — current (015:931-1019)

```sql
create or replace function public.complete_next_auction_transition() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now            timestamptz; v_open_at timestamptz; v_should_transition boolean;
  v_session        public.auction_sessions%rowtype; v_next public.slots%rowtype; v_result jsonb;
begin
  select coalesce(setting->>'value', null) into v_open_at from public.settings where key = 'next_auction_open_at';
  v_now := clock_timestamp();
  v_should_transition := v_open_at is not null and v_open_at::timestamptz <= v_now;
  if not v_should_transition then
    return jsonb_build_object('success', true, 'session_status','advancing',
      'message','Delay still active — next slot will open shortly.');
  end if;
  select * into v_session from public.get_active_session() limit 1;
  if not found then
    update public.settings set value = null where key = 'next_auction_open_at';
    update public.settings set value = 'false' where key = 'auction_advancing';
    return jsonb_build_object('success', true, 'message','No active auction session.');
  end if;
  select * into v_next from public.slots s where s.status = 'pending'
    and s.round = v_session.round
    and not exists (select 1 from public.slots k where k.topic_id = s.topic_id and k.status = 'sold')
    order by s.round, s.question_number nulls last, s.id limit 1 for update;
  if not found then
    update public.auction_sessions set status='completed', ended_at=clock_timestamp(), updated_at=clock_timestamp()
    where id = v_session.id;
    update public.settings set value = null where key = 'next_auction_open_at';
    update public.settings set value = 'false' where key = 'auction_advancing';
    return jsonb_build_object('success', true, 'session_id', v_session.id,
      'session_status','completed','message','No further auction items remain for this round.');
  end if;
  perform public.open_bidding(v_next.id);
  update public.settings set value = null where key = 'next_auction_open_at';
  update public.settings set value = 'false' where key = 'auction_advancing';
  return jsonb_build_object('success', true, 'session_id', v_session.id,
    'next_slot_id', v_next.id, 'session_status','bidding_open',
    'message','Next auction slot opened automatically after delay.');
end;
$$;
```

---

## 9. Schema of `public.slots` and `public.auction_rounds` (verification)

**`public.slots` final schema** (001:37-47 + adds):

| Column | Type / constraint | Added in |
|---|---|---|
| `id` | uuid PK, `gen_random_uuid()` default | 001:38 |
| `topic_id` | uuid NOT NULL FK → topics | 001:39 |
| `round` | integer NOT NULL, CHECK `in (1,2)` → extended `(1,2,3)` in 023:15-16 | 001:40 |
| `status` | text NOT NULL default 'pending', CHECK `in ('pending','open','sold','skipped')` | 001:41-42 |
| `current_bid` | integer NOT NULL default 0 | 001:43 |
| `leader_team_id` | uuid FK → teams (nullable) | 001:44 |
| `end_time` | timestamptz (nullable) — authoritative bidding deadline | 001:45 |
| `winner_team_id` | uuid FK → teams | 001:46 |
| `min_bid` | integer NOT NULL default 10, CHECK > 0 (009:11-12) | 009:11 |
| `session_id` | uuid FK → auction_sessions(id) `on delete set null` | 011:69-70 |
| `timer_status` | text default 'idle', CHECK `in ('idle','running','paused','expired','completed')` | 011:71-73 |
| `timer_started_at`, `timer_paused_at`, `paused_remaining_seconds`, `total_bonus_seconds`, `total_manual_extension_seconds` | timestamptz / int ≥ 0 | 011:74-86 |
| `question_number` | integer (nullable until seeded) | 011:87-88 |
| `sold_at` | timestamptz | 011:89-90 |
| `created_at` | timestamptz default now() | 011:91-92 |
| Indexes | `idx_slots_topic`, `idx_slots_status`, `idx_slots_session`, `idx_slots_question_number (round, question_number)`; partial uniques: `slots_single_open_idx`, `slots_one_active_per_topic_idx`, `slots_topic_sold_once_idx` | 011:101-103, 020, 009:31, 011:315-325 |
| Triggers | `trg_single_active_slot_per_topic` (011), `trg_slots_emit_event` (016/021) | |

**`public.auction_rounds`:** does not exist. The only trace is a guarded `alter table team_allocations ...` in 023:24-31 (executes only if the table exists; the table is not created by any migration — grep for `team_allocations` across `supabase/migrations` returns only 023:25-28).

**`public.wallets` (current):** 006_fix_wallet_schema.sql dropped the 001 per-round table and created `wallets(team_id PK FK → teams on delete cascade, balance integer not null default 100 CHECK (balance ≥ 0), created_at)` — one wallet per team, no round column (006:24-30).

---

## 10. Notable observations / risks (brief)

1. **Dead auto-advance path** — `complete_next_auction_transition()` has no caller (015:931-1019; only reference is the service wrapper at `app/features/admin/services/adminAuctionService.ts:132`). 023's `advance_auction()` opens the next slot immediately (023:369-370), so the 3-second `next_auction_open_at` flow is obsolete.
2. **`sold_at` written for unsold slots** — `settle_slot()` Case A writes `sold_at` for `status='skipped'` (021:355-356); 023's get_live_auction_state counts unsold in `items_unsold` by `status in ('skipped','pending')` (023:846) — the semantic overlap is confusing.
3. **`'expired'` timer_status unused** — `slots.timer_status` and `auction_sessions.timer_status` both CHECK `in ('idle','running','paused','expired','completed')` (011:37-38, 72-73) but nothing sets `'expired'`.
4. **One-win-per-round was removed** — 021's header (021:18-21) documents that the round limit in `place_bid()` was removed; 023 re-adds the *universal* 2-win cap plus the round-3 recovery exclusion.
5. **Migration skew** — later migrations define functions with the same names multiple times (`get_live_auction_state` in 017, 021, 023, 026; `close_slot` in 007, 009, 015, 021, 022; `place_bid` in 005, 007, 009, 015, 021, 022, 023, 024). The last-applied definition wins — callers of the admin API must confirm which body is live; 029 exists specifically because production had missing function bodies (029:1-28).
6. **Pause-while-open gap (fixed by 020)** — fixed by 020_session_active_slot_sync.sql (writes `auction_sessions.active_slot_id` in `open_slot` 020:99-114 and `open_bidding` 020:185-190, with fallback lookups in `pause_auction`/`resume_auction` 020:228-242, 300-313).
7. **Expiry is read-triggered** — `settle_expired_slots()` is called from `place_bid()` (023:412, 022:102) and `get_live_auction_state()` (023:729, 026:519); there is no background sweeper, so an expired item stays `open` (bids still accepted? — see below) until one of these runs. Actually: `place_bid()` calls `settle_expired_slots()` first, so bids can't be placed on an expired item through the normal path; `get_live_auction_state()` settles before returning, so surfaces converge.

---

## 11. Methodology

Files read in order: `supabase/migrations/011_auction_core.sql` (first), `015_auction_engine.sql` (rest), `009_admin_auction_features.sql`, `023_three_round_auction.sql`, `020_session_active_slot_sync.sql`, `021_auction_bugfixes.sql`, `016_auction_events.sql`, `017_read_functions.sql`, plus supporting `001-002, 005, 006, 007, 008, 012, 013, 014, 018, 022, 024, 025, 026, 027, 028, 029, 030, 032, 033, 034, 035, 036, 037` and `docs/auction-architecture.md`, `docs/auction-database-contract.md`, `docs/auction-realtime-events.md`; greps for `auction_rounds`, `pg_cron`, `complete_next_auction_transition` callers (`app/`), `setTimeout/setInterval/poll` in admin hooks, and `cron.`/`pg_sleep` across `supabase/`. Verbatim SQL quoted above is from the files cited.
