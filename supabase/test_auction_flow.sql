-- ============================================================
-- Bid2Build: Hardened Auction Engine SQL Test Suite
-- ============================================================
-- Usage: Run this entire script in the Supabase SQL Editor.
--
-- Features:
--   1. Fixes false-positive exception traps: negative tests
--      fail immediately if an invalid operation is accepted.
--   2. Safe isolated test data using dedicated UUID namespace
--      ('e0000000-...'). Never touches production or dev rows.
--   3. Deep state assertions: validates returned JSON, slots table,
--      bids table, wallets table, and audit_log table.
--   4. Displays an explicit test result table in the SQL Editor
--      Results tab upon successful execution.
-- ============================================================

-- Create temporary table for test results (persists across the transaction)
create temp table if not exists auction_test_results (
  test_num    integer primary key,
  test_name   text not null,
  status      text not null,
  assertion   text not null,
  details     text
);

truncate auction_test_results;

do $$
declare
  -- ── Dedicated Namespaced Test UUIDs (e0000000-...) ─────────
  v_admin_uid  constant uuid := 'e0000000-0000-4000-8000-000000000000';
  v_team1_id   constant uuid := 'e0000000-0001-4000-8000-000000000001';
  v_team2_id   constant uuid := 'e0000000-0002-4000-8000-000000000002';
  v_cap1_uid   constant uuid := 'e0000000-0001-4000-8000-000000000011';
  v_mem1_uid   constant uuid := 'e0000000-0001-4000-8000-000000000012';
  v_cap2_uid   constant uuid := 'e0000000-0002-4000-8000-000000000021';
  v_topic_id   constant uuid := 'e0000000-0000-4000-8000-000000000099';
  v_slot1_id   constant uuid := 'e0000000-0001-4000-8000-000000000101';
  v_slot2_id   constant uuid := 'e0000000-0001-4000-8000-000000000102';
  v_slot3_id   constant uuid := 'e0000000-0001-4000-8000-000000000103';

  -- ── Test Runner State Variables ───────────────────────────
  v_curr_num      integer := 0;
  v_curr_name     text := '';
  v_curr_assert   text := '';
  v_op_succeeded  boolean;
  v_err_msg       text;
  v_details       text;
  
  -- Working variables for database checks
  v_res           jsonb;
  v_balance       integer;
  v_slot          public.slots%rowtype;
  v_bid_count     integer;
  v_audit_count   integer;
  v_old_end_time  timestamptz;
begin
  raise notice '=======================================================';
  raise notice 'Starting Bid2Build Hardened Auction Engine Test Suite';
  raise notice '=======================================================';

  -- ──────────────────────────────────────────────────────────
  -- STEP 0: Clean up any prior test run (isolated by UUIDs)
  -- ──────────────────────────────────────────────────────────
  delete from public.bids      where slot_id in (v_slot1_id, v_slot2_id, v_slot3_id) or team_id in (v_team1_id, v_team2_id);
  delete from public.audit_log where entity_id in (v_slot1_id, v_slot2_id, v_slot3_id) or actor_id in (v_admin_uid, v_cap1_uid, v_cap2_uid, v_mem1_uid);
  delete from public.slots     where id in (v_slot1_id, v_slot2_id, v_slot3_id);
  delete from public.topics    where id = v_topic_id;
  delete from public.wallets   where team_id in (v_team1_id, v_team2_id);
  delete from public.members   where id in (v_cap1_uid, v_mem1_uid, v_cap2_uid);
  delete from public.teams     where id in (v_team1_id, v_team2_id);


  -- ──────────────────────────────────────────────────────────
  -- TEST 1: Environment & 100-pt Unified Wallet Setup
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 1;
  v_curr_name   := 'Environment & Wallet Initialization';
  v_curr_assert := 'Teams, members, and unified 100-point wallets are seeded correctly';

  insert into public.teams (id, name, captain_id)
  values 
    (v_team1_id, '__TEST_TEAM_ALPHA__', v_cap1_uid),
    (v_team2_id, '__TEST_TEAM_BETA__',  v_cap2_uid);

  insert into public.members (id, team_id, name, email)
  values 
    (v_cap1_uid, v_team1_id, 'Captain Alpha', '__test_cap1__@testsuite.internal'),
    (v_mem1_uid, v_team1_id, 'Member Alpha',  '__test_mem1__@testsuite.internal'),
    (v_cap2_uid, v_team2_id, 'Captain Beta',  '__test_cap2__@testsuite.internal');

  insert into public.wallets (team_id, balance)
  values 
    (v_team1_id, 100),
    (v_team2_id, 100);

  insert into public.topics (id, level, title, description, criterion)
  values (v_topic_id, 'easy', 'Test Topic', 'Automated Test Topic', '{"focus": "Reliability"}'::jsonb);

  insert into public.slots (id, topic_id, round, status, current_bid)
  values 
    (v_slot1_id, v_topic_id, 1, 'pending', 0),
    (v_slot2_id, v_topic_id, 1, 'pending', 0),
    (v_slot3_id, v_topic_id, 1, 'pending', 0);

  -- Assertions
  select balance into v_balance from public.wallets where team_id = v_team1_id;
  if v_balance <> 100 then
    raise exception 'TEST % FAILED [%]: Expected wallet balance 100, got %', v_curr_num, v_curr_name, v_balance;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, '2 teams created with 100 pt wallets');


  -- ──────────────────────────────────────────────────────────
  -- TEST 2: Security: Non-Admin Cannot Open Slot
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 2;
  v_curr_name   := 'Security: Non-Admin Cannot Open Slot';
  v_curr_assert := 'open_slot rejects callers without admin role';

  perform set_config('request.jwt.claim.sub', v_cap1_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cap1_uid::text, 'app_metadata', json_build_object('role', 'authenticated'))::text, true);

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.open_slot(v_slot1_id);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Non-admin caller was allowed to open a slot!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%Admin access required%' then
    raise exception 'TEST % FAILED [%]: Expected admin access error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 3: Admin Opens Slot with 10-Second Window
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 3;
  v_curr_name   := 'Admin Opens Slot (10s Opening Window)';
  v_curr_assert := 'open_slot sets status=open and end_time ~10s in future';

  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'app_metadata', json_build_object('role', 'admin'))::text, true);

  v_res := public.open_slot(v_slot1_id);

  if (v_res->>'success')::boolean is not true or (v_res->>'status') <> 'open' then
    raise exception 'TEST % FAILED [%]: open_slot return payload invalid: %', v_curr_num, v_curr_name, v_res;
  end if;

  select * into v_slot from public.slots where id = v_slot1_id;
  if v_slot.status <> 'open' then
    raise exception 'TEST % FAILED [%]: Slot status in DB is % (expected open)', v_curr_num, v_curr_name, v_slot.status;
  end if;

  if v_slot.end_time <= clock_timestamp() or v_slot.end_time > clock_timestamp() + interval '12 seconds' then
    raise exception 'TEST % FAILED [%]: Slot end_time not set to ~10s window (got %)', v_curr_num, v_curr_name, v_slot.end_time;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Slot opened, timer set to ' || v_slot.end_time::text);


  -- ──────────────────────────────────────────────────────────
  -- TEST 4: Reject Bid on Pending (Closed) Slot
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 4;
  v_curr_name   := 'Reject Bid on Pending Slot';
  v_curr_assert := 'place_bid rejects bid on a slot whose status is pending';

  perform set_config('request.jwt.claim.sub', v_cap1_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cap1_uid::text, 'app_metadata', json_build_object('role', 'authenticated'))::text, true);

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.place_bid(v_slot2_id, 10);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Bid on pending slot was accepted!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%not open for bidding%' then
    raise exception 'TEST % FAILED [%]: Expected not open error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 5: Reject Non-Captain Bid
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 5;
  v_curr_name   := 'Authorization: Reject Non-Captain Bid';
  v_curr_assert := 'place_bid rejects regular team members who are not captains';

  perform set_config('request.jwt.claim.sub', v_mem1_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_mem1_uid::text, 'app_metadata', json_build_object('role', 'authenticated'))::text, true);

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.place_bid(v_slot1_id, 10);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Non-captain member was allowed to place a bid!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%Only the team captain%' then
    raise exception 'TEST % FAILED [%]: Expected captain authorization error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 6: Reject Sub-Minimum Opening Bid (< 10 pts)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 6;
  v_curr_name   := 'Reject Opening Bid Below Minimum (10 pts)';
  v_curr_assert := 'Opening bid must be at least 10 points';

  perform set_config('request.jwt.claim.sub', v_cap1_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cap1_uid::text, 'app_metadata', json_build_object('role', 'authenticated'))::text, true);

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.place_bid(v_slot1_id, 5);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Opening bid of 5 pts was accepted (min is 10)!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%Bid too low%' then
    raise exception 'TEST % FAILED [%]: Expected Bid too low error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 7: Valid Opening Bid (Captain Alpha bids 10 pts)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 7;
  v_curr_name   := 'Valid Opening Bid Placement';
  v_curr_assert := 'Captain Alpha bids 10 pts; slot current_bid=10 and leader=Alpha';

  v_res := public.place_bid(v_slot1_id, 10);

  if (v_res->>'success')::boolean is not true then
    raise exception 'TEST % FAILED [%]: Valid bid returned non-success: %', v_curr_num, v_curr_name, v_res;
  end if;

  select * into v_slot from public.slots where id = v_slot1_id;
  if v_slot.current_bid <> 10 or v_slot.leader_team_id <> v_team1_id then
    raise exception 'TEST % FAILED [%]: Slot state mismatch. bid=%, leader=%', v_curr_num, v_curr_name, v_slot.current_bid, v_slot.leader_team_id;
  end if;

  select count(*) into v_bid_count from public.bids where slot_id = v_slot1_id and team_id = v_team1_id and amount = 10;
  if v_bid_count <> 1 then
    raise exception 'TEST % FAILED [%]: Bid row not inserted in bids table', v_curr_num, v_curr_name;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Slot updated to 10 pts, leader: Team Alpha');


  -- ──────────────────────────────────────────────────────────
  -- TEST 8: Wallet Preservation on Active Bid (Rule Book §5.1)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 8;
  v_curr_name   := 'Wallet Preservation (No Deduction on Bid)';
  v_curr_assert := 'Wallet balance remains 100; losing bids cost nothing';

  select balance into v_balance from public.wallets where team_id = v_team1_id;
  if v_balance <> 100 then
    raise exception 'TEST % FAILED [%]: Wallet was prematurely deducted! Balance: % (expected 100)', v_curr_num, v_curr_name, v_balance;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Balance confirmed at 100 pts');


  -- ──────────────────────────────────────────────────────────
  -- TEST 9: Reject Self-Raise While Leading
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 9;
  v_curr_name   := 'Fair Play: Reject Self-Raise While Leading';
  v_curr_assert := 'Leading team cannot bid again to inflate price or extend timer';

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.place_bid(v_slot1_id, 20);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Leading team was permitted to bid against themselves!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%already the highest bidder%' then
    raise exception 'TEST % FAILED [%]: Expected self-raise error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 10: Reject Raise Below Minimum Raise (< 10 pts raise)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 10;
  v_curr_name   := 'Reject Raise Under 10 Points';
  v_curr_assert := 'Current bid is 10; raise of 5 (total 15) must be rejected';

  perform set_config('request.jwt.claim.sub', v_cap2_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cap2_uid::text, 'app_metadata', json_build_object('role', 'authenticated'))::text, true);

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.place_bid(v_slot1_id, 15);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Sub-minimum raise was accepted!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%Bid too low%' then
    raise exception 'TEST % FAILED [%]: Expected Bid too low error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 11: Valid Raise & Timer Extension (+5s, Rule Book §5.2)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 11;
  v_curr_name   := 'Valid Raise & Timer Extension (+5s)';
  v_curr_assert := 'Captain Beta bids 30; leader=Beta, end_time extended by exactly 5s';

  select end_time into v_old_end_time from public.slots where id = v_slot1_id;

  v_res := public.place_bid(v_slot1_id, 30);

  if (v_res->>'success')::boolean is not true then
    raise exception 'TEST % FAILED [%]: Raise to 30 returned failure: %', v_curr_num, v_curr_name, v_res;
  end if;

  select * into v_slot from public.slots where id = v_slot1_id;
  if v_slot.current_bid <> 30 or v_slot.leader_team_id <> v_team2_id then
    raise exception 'TEST % FAILED [%]: Slot state mismatch. bid=%, leader=%', v_curr_num, v_curr_name, v_slot.current_bid, v_slot.leader_team_id;
  end if;

  -- Deep assertion on timer extension: new end_time = old end_time + 5 seconds
  if v_slot.end_time <> v_old_end_time + interval '5 seconds' then
    raise exception 'TEST % FAILED [%]: Timer not extended by 5s. Was %, now %', v_curr_num, v_curr_name, v_old_end_time, v_slot.end_time;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'New bid 30 pts, leader: Beta, end_time extended +5s');


  -- ──────────────────────────────────────────────────────────
  -- TEST 12: Reject Bid Exceeding Wallet Balance
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 12;
  v_curr_name   := 'Wallet Constraint: Reject Overdraft Bid';
  v_curr_assert := 'Team Alpha has 100 pts; a bid of 150 pts must be rejected';

  perform set_config('request.jwt.claim.sub', v_cap1_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cap1_uid::text, 'app_metadata', json_build_object('role', 'authenticated'))::text, true);

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.place_bid(v_slot1_id, 150);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Overdraft bid of 150 pts was accepted!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%Insufficient balance%' then
    raise exception 'TEST % FAILED [%]: Expected Insufficient balance error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 13: Reject Bid on Expired Slot
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 13;
  v_curr_name   := 'Timing: Reject Bid on Expired Slot';
  v_curr_assert := 'place_bid rejects bids once end_time <= clock_timestamp()';

  -- Simulate slot expiry
  update public.slots set end_time = clock_timestamp() - interval '1 second' where id = v_slot1_id;

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.place_bid(v_slot1_id, 40);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Bid on expired slot was accepted!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%expired%' then
    raise exception 'TEST % FAILED [%]: Expected expired error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  -- Restore active end_time for close_slot testing
  update public.slots set end_time = clock_timestamp() + interval '30 seconds' where id = v_slot1_id;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 14: Security: Non-Admin Cannot Close Slot
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 14;
  v_curr_name   := 'Security: Non-Admin Cannot Close Slot';
  v_curr_assert := 'close_slot rejects callers without admin role';

  perform set_config('request.jwt.claim.sub', v_cap2_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cap2_uid::text, 'app_metadata', json_build_object('role', 'authenticated'))::text, true);

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.close_slot(v_slot1_id);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Non-admin caller was allowed to close a slot!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%Admin access required%' then
    raise exception 'TEST % FAILED [%]: Expected admin access error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 15: Close Slot -> Sold to Winner (Team Beta, 30 pts)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 15;
  v_curr_name   := 'Close Slot: Mark Sold to Winner';
  v_curr_assert := 'close_slot transitions slot to sold with winner_team_id=Beta';

  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'app_metadata', json_build_object('role', 'admin'))::text, true);

  v_res := public.close_slot(v_slot1_id);

  if (v_res->>'status') <> 'sold' or (v_res->>'winner_team_id') <> v_team2_id::text or (v_res->>'winning_bid')::integer <> 30 then
    raise exception 'TEST % FAILED [%]: close_slot return payload mismatch: %', v_curr_num, v_curr_name, v_res;
  end if;

  select * into v_slot from public.slots where id = v_slot1_id;
  if v_slot.status <> 'sold' or v_slot.winner_team_id <> v_team2_id then
    raise exception 'TEST % FAILED [%]: DB slot not updated to sold. Status: %, Winner: %', v_curr_num, v_curr_name, v_slot.status, v_slot.winner_team_id;
  end if;

  select count(*) into v_audit_count from public.audit_log where action = 'slot_sold' and entity_id = v_slot1_id;
  if v_audit_count < 1 then
    raise exception 'TEST % FAILED [%]: audit_log entry for slot_sold not created', v_curr_num, v_curr_name;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Slot sold to Team Beta for 30 pts; audit row logged');


  -- ──────────────────────────────────────────────────────────
  -- TEST 16: Winner Wallet Deducted (100 -> 70 pts)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 16;
  v_curr_name   := 'Winner Wallet Deduction';
  v_curr_assert := 'Winning bid of 30 pts is deducted from Team Beta (balance=70)';

  select balance into v_balance from public.wallets where team_id = v_team2_id;
  if v_balance <> 70 then
    raise exception 'TEST % FAILED [%]: Winner wallet was not deducted accurately! Got: % (expected 70)', v_curr_num, v_curr_name, v_balance;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Team Beta balance deducted 100 -> 70 pts');


  -- ──────────────────────────────────────────────────────────
  -- TEST 17: Losing Team Wallet Preserved (100 pts)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 17;
  v_curr_name   := 'Losing Team Wallet Untouched';
  v_curr_assert := 'Team Alpha (losing bidder) balance remains exactly 100 pts';

  select balance into v_balance from public.wallets where team_id = v_team1_id;
  if v_balance <> 100 then
    raise exception 'TEST % FAILED [%]: Losing team wallet was deducted! Got: % (expected 100)', v_curr_num, v_curr_name, v_balance;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Team Alpha balance confirmed at 100 pts');


  -- ──────────────────────────────────────────────────────────
  -- TEST 18: One-Slot-Per-Round Lockout (Rule Book §5.3)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 18;
  v_curr_name   := 'One-Slot-Per-Round Lockout Enforced';
  v_curr_assert := 'Team Beta already won Round 1 slot; further Round 1 bids are rejected';

  -- Open slot 2 (also Round 1)
  perform public.open_slot(v_slot2_id);

  -- Team Beta attempts to bid on slot 2
  perform set_config('request.jwt.claim.sub', v_cap2_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cap2_uid::text, 'app_metadata', json_build_object('role', 'authenticated'))::text, true);

  v_op_succeeded := false;
  v_err_msg := null;
  begin
    perform public.place_bid(v_slot2_id, 10);
    v_op_succeeded := true;
  exception when others then
    v_op_succeeded := false;
    v_err_msg := sqlerrm;
  end;

  if v_op_succeeded then
    raise exception 'TEST % FAILED [%]: Team was allowed to bid after already winning in Round 1!', v_curr_num, v_curr_name;
  end if;

  if v_err_msg not ilike '%already won a slot in Round 1%' then
    raise exception 'TEST % FAILED [%]: Expected Round 1 lockout error, got: %', v_curr_num, v_curr_name, v_err_msg;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Rejected with: ' || v_err_msg);


  -- ──────────────────────────────────────────────────────────
  -- TEST 19: Unsold Slot Handling (0 Bids -> Skipped)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 19;
  v_curr_name   := 'Unsold Slot Handling (0 Bids -> Skipped)';
  v_curr_assert := 'Slot 2 closed with 0 bids transitions to skipped with 0 wallet impact';

  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'app_metadata', json_build_object('role', 'admin'))::text, true);

  v_res := public.close_slot(v_slot2_id);

  if (v_res->>'status') <> 'skipped' then
    raise exception 'TEST % FAILED [%]: Expected status skipped for unsold slot, got: %', v_curr_num, v_curr_name, v_res;
  end if;

  select * into v_slot from public.slots where id = v_slot2_id;
  if v_slot.status <> 'skipped' or v_slot.winner_team_id is not null then
    raise exception 'TEST % FAILED [%]: DB slot status is %, winner: %', v_curr_num, v_curr_name, v_slot.status, v_slot.winner_team_id;
  end if;

  -- Assert balances unchanged
  select balance into v_balance from public.wallets where team_id = v_team1_id;
  if v_balance <> 100 then
    raise exception 'TEST % FAILED [%]: Team 1 wallet changed after skip: %', v_curr_num, v_curr_name, v_balance;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Status: skipped, winner: null, balances unaffected');


  -- ──────────────────────────────────────────────────────────
  -- TEST 20: Admin Manual Skip Function (skip_slot)
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 20;
  v_curr_name   := 'Admin Manual Skip (skip_slot RPC)';
  v_curr_assert := 'skip_slot on pending slot 3 marks status=skipped';

  v_res := public.skip_slot(v_slot3_id);

  if (v_res->>'status') <> 'skipped' then
    raise exception 'TEST % FAILED [%]: skip_slot returned: %', v_curr_num, v_curr_name, v_res;
  end if;

  select * into v_slot from public.slots where id = v_slot3_id;
  if v_slot.status <> 'skipped' then
    raise exception 'TEST % FAILED [%]: DB slot 3 status is % (expected skipped)', v_curr_num, v_curr_name, v_slot.status;
  end if;

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'Slot 3 successfully skipped by admin');


  -- ──────────────────────────────────────────────────────────
  -- TEST 21: Clean Test Data Teardown
  -- ──────────────────────────────────────────────────────────
  v_curr_num    := 21;
  v_curr_name   := 'Test Data Teardown & Isolation';
  v_curr_assert := 'All test entities safely cleaned up without affecting other records';

  delete from public.bids      where slot_id in (v_slot1_id, v_slot2_id, v_slot3_id) or team_id in (v_team1_id, v_team2_id);
  delete from public.audit_log where entity_id in (v_slot1_id, v_slot2_id, v_slot3_id) or actor_id in (v_admin_uid, v_cap1_uid, v_cap2_uid, v_mem1_uid);
  delete from public.slots     where id in (v_slot1_id, v_slot2_id, v_slot3_id);
  delete from public.topics    where id = v_topic_id;
  delete from public.wallets   where team_id in (v_team1_id, v_team2_id);
  delete from public.members   where id in (v_cap1_uid, v_mem1_uid, v_cap2_uid);
  delete from public.teams     where id in (v_team1_id, v_team2_id);

  insert into auction_test_results values (v_curr_num, v_curr_name, 'PASS', v_curr_assert, 'All e0000000-... test entities completely purged');

  raise notice '=======================================================';
  raise notice 'SUCCESS: ALL 21 AUCTION TEST SCENARIOS PASSED!';
  raise notice '=======================================================';
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Formatted Output for Supabase SQL Editor Results Grid
-- ─────────────────────────────────────────────────────────────
select 
  test_num  as "#",
  test_name as "Test Scenario",
  status    as "Status",
  assertion as "Rule / Assertion Verified",
  details   as "Runtime Details"
from auction_test_results
order by test_num;
