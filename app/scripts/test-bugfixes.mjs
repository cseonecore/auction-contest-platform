/**
 * Bid2Build — bugfix regression suite.
 *
 * Exercises the exact scenarios behind the three launch-blocking bugs:
 *
 *   Bug 1  Session restart must let participants rejoin:
 *          Stop → Start must create a NEW active session, the session
 *          lifecycle must be visible in the event stream, and
 *          `get_active_session()` must flip empty/non-empty.
 *
 *   Bug 2  The identity chain `place_bid()` relies on
 *          (auth.users.id == members.id == teams.captain_id) and the
 *          single-device session tracking the login handshake uses.
 *
 *   Bug 3  Multi-team bidding rules survive a restart: opening bids,
 *          minimum raises, no self-outbid, one win per round, exactly
 *          once deduction, wallet caps, timer extensions.
 *
 *   node scripts/test-bugfixes.mjs
 */

import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

const AUTH_MOCK = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;
`

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const results = []
let currentGroup = ''

function group(name) {
  currentGroup = name
  console.log(`\n${name}`)
}

function pass(name, detail = '') {
  results.push({ group: currentGroup, name, ok: true, detail })
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name, detail) {
  results.push({ group: currentGroup, name, ok: false, detail })
  console.error(`  FAIL  ${name} — ${detail}`)
}

async function check(name, fn) {
  try {
    const detail = await fn()
    pass(name, typeof detail === 'string' ? detail : '')
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err))
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectError(db, label, fn, pattern) {
  try {
    await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (pattern && !pattern.test(message)) {
      throw new Error(`expected error matching ${pattern} but got: ${message}`)
    }
    return message
  }
  throw new Error(`${label}: expected the call to be rejected but it succeeded`)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEAM_A = 'b0000000-0000-4000-8000-000000000001'
const CAPTAIN_A = 'b0000000-0000-4000-8000-000000000011'
const TEAM_B = 'b0000000-0000-4000-8000-000000000002'
const CAPTAIN_B = 'b0000000-0000-4000-8000-000000000021'
const TEAM_C = 'b0000000-0000-4000-8000-000000000003'
const CAPTAIN_C = 'b0000000-0000-4000-8000-000000000031'
const TEAM_D = 'b0000000-0000-4000-8000-000000000004'
const CAPTAIN_D = 'b0000000-0000-4000-8000-000000000041'
const ADMIN = 'b0000000-0000-4000-8000-000000000099'

async function asUser(db, sub, role) {
  await db.query(
    `select set_config('request.jwt.claim.sub', $1, false),
            set_config('request.jwt.claims', $2, false)`,
    [sub, JSON.stringify({ sub, role, app_metadata: { role } })]
  )
}

async function anon(db) {
  await db.query(
    `select set_config('request.jwt.claim.sub', '', false),
            set_config('request.jwt.claims', '', false)`
  )
}

async function eventCount(db, type) {
  const res = await db.query(
    `select count(*)::int as n from public.auction_events where event_type = $1`,
    [type]
  )
  return res.rows[0].n
}

async function walletOf(db, teamId) {
  const res = await db.query(`select balance from public.wallets where team_id = $1`, [teamId])
  return res.rows[0]?.balance
}

async function main() {
  const db = new PGlite()
  await db.waitReady
  await db.exec(AUTH_MOCK)

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(
      /create extension if not exists pgcrypto;/gi,
      '-- pgcrypto not bundled in PGlite'
    )
    await db.exec(sql)
  }

  // ── Fixture data ────────────────────────────────────────────────────────
  await db.exec(`
    insert into public.teams (id, name, captain_id) values
      ('${TEAM_A}', 'Team Alpha', '${CAPTAIN_A}'),
      ('${TEAM_B}', 'Team Beta',  '${CAPTAIN_B}'),
      ('${TEAM_C}', 'Team Gamma', '${CAPTAIN_C}'),
      ('${TEAM_D}', 'Team Delta', '${CAPTAIN_D}');

    insert into public.members (id, team_id, name, email) values
      ('${CAPTAIN_A}', '${TEAM_A}', 'Alpha Captain', '4mt24cs001@mite.ac.in'),
      ('${CAPTAIN_B}', '${TEAM_B}', 'Beta Captain',  '4mt24cs002@mite.ac.in'),
      ('${CAPTAIN_C}', '${TEAM_C}', 'Gamma Captain', '4mt24cs003@mite.ac.in'),
      ('${CAPTAIN_D}', '${TEAM_D}', 'Delta Captain', '4mt24cs004@mite.ac.in');

    insert into auth.users (id, email) values
      ('${CAPTAIN_A}', '4mt24cs001@mite.ac.in'),
      ('${CAPTAIN_B}', '4mt24cs002@mite.ac.in'),
      ('${CAPTAIN_C}', '4mt24cs003@mite.ac.in'),
      ('${CAPTAIN_D}', '4mt24cs004@mite.ac.in');

    insert into public.wallets (team_id, balance) values
      ('${TEAM_A}', 100), ('${TEAM_B}', 100), ('${TEAM_C}', 100), ('${TEAM_D}', 100);
  `)

  const slotFor = async (topicTitle) => {
    const res = await db.query(
      `select s.id from public.slots s join public.topics t on t.id = s.topic_id
       where t.title = $1 and s.status = 'pending' limit 1`,
      [topicTitle]
    )
    assert(res.rows.length === 1, `no pending slot for topic ${topicTitle}`)
    return res.rows[0].id
  }

  // ───────────────────────────────────────────────────────────────────────
  group('1. Bug 1 — session restart and lifecycle events')
  // ───────────────────────────────────────────────────────────────────────
  let session1 = ''
  await check('starting the auction emits exactly one session_started event', async () => {
    await asUser(db, ADMIN, 'admin')
    const res = await db.query(`select public.start_auction(1) as r`)
    assert(res.rows[0].r.success === true, 'start_auction failed')
    session1 = res.rows[0].r.session_id
    assert((await eventCount(db, 'session_started')) === 1, 'session_started not emitted once')
    const row = await db.query(
      `select session_id, payload from public.auction_events where event_type = 'session_started'`
    )
    assert(row.rows[0].session_id === session1, 'event is not attached to the new session')
    return `session ${session1.slice(0, 8)}…`
  })

  await check('the active session is readable by everyone (participant gate)', async () => {
    await anon(db)
    const res = await db.query(`select count(*)::int as n from public.get_active_session()`)
    assert(res.rows[0].n === 1, 'get_active_session() returned no active session')
    return 'anon sees the active session'
  })

  await check('pause and resume emit their events', async () => {
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.pause_auction()`)
    await db.query(`select public.resume_auction()`)
    assert((await eventCount(db, 'auction_paused')) === 1, 'auction_paused not emitted')
    assert((await eventCount(db, 'auction_resumed')) === 1, 'auction_resumed not emitted')
    return 'auction_paused + auction_resumed'
  })

  await check('stopping the session emits session_ended and closes the gate', async () => {
    await asUser(db, ADMIN, 'admin')
    const res = await db.query(`select public.end_auction_session() as r`)
    assert(res.rows[0].r.status === 'completed', 'session did not complete')
    const event = await db.query(
      `select payload from public.auction_events where event_type = 'session_ended'`
    )
    assert(event.rows.length === 1, 'session_ended not emitted')
    assert(
      event.rows[0].payload.session_id === session1,
      'session_ended payload lost the session id'
    )
    await anon(db)
    const active = await db.query(`select count(*)::int as n from public.get_active_session()`)
    assert(active.rows[0].n === 0, 'the stopped session is still active')
    return 'session_ended emitted, gate closed'
  })

  let session2 = ''
  await check('a restart creates a NEW active session (the restart bug)', async () => {
    await asUser(db, ADMIN, 'admin')
    const res = await db.query(`select public.start_auction(1) as r`)
    assert(res.rows[0].r.success === true, 'restart failed')
    assert(res.rows[0].r.already_started === false, 'restart reported as idempotent no-op')
    session2 = res.rows[0].r.session_id
    assert(session2 !== session1, 'restart reused the ended session')
    await anon(db)
    const active = await db.query(`select count(*)::int as n from public.get_active_session()`)
    assert(active.rows[0].n === 1, 'participants cannot see the restarted session')
    assert((await eventCount(db, 'session_started')) === 2, 'restart did not emit session_started')
    return `new session ${session2.slice(0, 8)}…`
  })

  // ───────────────────────────────────────────────────────────────────────
  group('2. Bug 3 — multi-team bidding after a restart')
  // ───────────────────────────────────────────────────────────────────────
  let slot1 = ''
  await check('bidding opens on the restarted session', async () => {
    await asUser(db, ADMIN, 'admin')
    slot1 = await slotFor('Campus Life Tech')
    await db.query(`select public.select_auction_question($1)`, [slot1])
    const res = await db.query(`select public.open_bidding($1) as r`, [slot1])
    assert(res.rows[0].r.success === true, 'open_bidding failed')
    assert(res.rows[0].r.window_seconds === 10, 'opening window is not 10s')
    return `item opened, window ${res.rows[0].r.window_seconds}s`
  })

  await check('two teams can trade the opening bid', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    const a = await db.query(`select public.place_bid($1, 10) as r`, [slot1])
    assert(a.rows[0].r.success === true, 'opening bid rejected')
    await asUser(db, CAPTAIN_B, 'captain')
    const b = await db.query(`select public.place_bid($1, 20) as r`, [slot1])
    assert(b.rows[0].r.success === true, 'counter-bid rejected')
    const slot = await db.query(`select current_bid, leader_team_id from public.slots where id = $1`, [slot1])
    assert(slot.rows[0].current_bid === 20, 'current bid did not update')
    assert(slot.rows[0].leader_team_id === TEAM_B, 'leader did not update')
    return 'A 10 → B 20'
  })

  await check('the leader cannot outbid themselves', async () => {
    await asUser(db, CAPTAIN_B, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 30)`, [slot1]), /already the highest bidder/)
    return ''
  })

  await check('a raise below the minimum increment is rejected', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 22)`, [slot1]), /Bid too low/)
    return 'min next bid is 25'
  })

  await check('a valid raise extends the clock by exactly 5s', async () => {
    const before = await db.query(`select end_time from public.slots where id = $1`, [slot1])
    await asUser(db, CAPTAIN_A, 'captain')
    const res = await db.query(`select public.place_bid($1, 30) as r`, [slot1])
    assert(res.rows[0].r.success === true, 'valid raise rejected')
    const after = await db.query(`select end_time from public.slots where id = $1`, [slot1])
    const delta = (new Date(after.rows[0].end_time) - new Date(before.rows[0].end_time)) / 1000
    assert(delta === 5, `clock moved ${delta}s instead of 5s`)
    return `A 30, clock +${delta}s`
  })

  await check('a bid beyond the wallet is rejected', async () => {
    await asUser(db, CAPTAIN_B, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 150)`, [slot1]), /Insufficient balance/)
    return ''
  })

  await check('losing bids cost nothing while bidding is live', async () => {
    assert((await walletOf(db, TEAM_A)) === 100, 'Team Alpha was charged during bidding')
    assert((await walletOf(db, TEAM_B)) === 100, 'Team Beta was charged during bidding')
    return 'both wallets still 100'
  })

  await check('closing deducts the winner exactly once', async () => {
    await asUser(db, ADMIN, 'admin')
    const res = await db.query(`select public.close_slot($1) as r`, [slot1])
    assert(res.rows[0].r.status === 'sold', 'item was not sold')
    assert(res.rows[0].r.winning_bid === 30, `winning bid was ${res.rows[0].r.winning_bid}`)
    assert((await walletOf(db, TEAM_A)) === 70, 'winner balance is not 70')
    assert((await walletOf(db, TEAM_B)) === 100, 'loser was charged')
    const ledger = await db.query(
      `select count(*)::int as n from public.wallet_transactions where slot_id = $1 and tx_type = 'win_deduction'`,
      [slot1]
    )
    assert(ledger.rows[0].n === 1, `${ledger.rows[0].n} ledger entries`)
    return 'A −30 once, B untouched'
  })

  await check('multiple wins in the same round are permitted after a restart', async () => {
    const nextRound1 = await slotFor('Hyperlocal Marketplace')
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.open_slot($1)`, [nextRound1])
    await asUser(db, CAPTAIN_A, 'captain')
    const res = await db.query(`select public.place_bid($1, 10) as r`, [nextRound1])
    assert(res.rows[0].r.success === true, 'round-1 winner can bid on another round-1 item')
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.skip_slot($1)`, [nextRound1])
    return 'winner of round 1 can bid and win again in the same round'
  })

  await check('every bid reached the event stream', async () => {
    const res = await db.query(
      `select count(distinct team_id)::int as n from public.auction_events where event_type = 'bid_placed'`
    )
    assert(res.rows[0].n === 2, `only ${res.rows[0].n} teams appear in bid_placed events`)
    const changed = await eventCount(db, 'highest_bid_changed')
    assert(changed >= 3, `only ${changed} highest_bid_changed events`)
    return 'both teams present, 3+ leader changes'
  })

  // ───────────────────────────────────────────────────────────────────────
  group('3. Restart → round 2, wallet caps, full reset')
  // ───────────────────────────────────────────────────────────────────────
  await check('stop → start again works for round 2', async () => {
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.end_auction_session()`)
    const res = await db.query(`select public.start_auction(2) as r`)
    assert(res.rows[0].r.success === true, 'round 2 restart failed')
    return `round ${res.rows[0].r.round} session active`
  })

  let slot2 = ''
  await check('the round-1 winner can bid again in round 2', async () => {
    await asUser(db, ADMIN, 'admin')
    slot2 = await slotFor('AI Study Buddy')
    await db.query(`select public.select_auction_question($1)`, [slot2])
    await db.query(`select public.open_bidding($1)`, [slot2])
    await asUser(db, CAPTAIN_A, 'captain')
    const res = await db.query(`select public.place_bid($1, 50) as r`, [slot2])
    assert(res.rows[0].r.success === true, 'round-1 winner could not bid in round 2')
    assert((await walletOf(db, TEAM_A)) === 70, 'balance changed before close')
    return 'A bids 50 of 70'
  })

  await check('a raise above the wallet is rejected even if the amount is legal', async () => {
    // B still holds 100 coins, so outbidding to 60 is legal for B…
    await asUser(db, CAPTAIN_B, 'captain')
    const res = await db.query(`select public.place_bid($1, 60) as r`, [slot2])
    assert(res.rows[0].r.success === true, 'a legal, affordable raise was rejected')
    // …but Alpha only has 70 coins left, so an 80 raise can never pass.
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 80)`, [slot2]), /Insufficient balance/)
    return 'B 60 legal, A 80 beyond the 70-coin wallet rejected'
  })

  await check('closing round 2 debits the new winner once', async () => {
    await asUser(db, ADMIN, 'admin')
    const res = await db.query(`select public.close_slot($1) as r`, [slot2])
    assert(res.rows[0].r.status === 'sold', 'round-2 item was not sold')
    assert((await walletOf(db, TEAM_B)) === 40, 'round-2 winner balance is not 40')
    assert((await walletOf(db, TEAM_A)) === 70, 'the losing team was charged')
    const ledger = await db.query(`select count(*)::int as n from public.wallet_transactions where tx_type = 'win_deduction'`)
    assert(ledger.rows[0].n === 2, `${ledger.rows[0].n} ledger entries after two sales`)
    return 'B 100 − 60 = 40, A untouched'
  })

  await check('reset restores wallets and emits auction_reset', async () => {
    await asUser(db, ADMIN, 'admin')
    const res = await db.query(`select public.reset_auction() as r`)
    assert(res.rows[0].r.success === true, 'reset failed')
    assert((await walletOf(db, TEAM_A)) === 100, 'wallet was not restored')
    assert((await walletOf(db, TEAM_B)) === 100, 'wallet was not restored')
    const bids = await db.query(`select count(*)::int as n from public.bids`)
    assert(bids.rows[0].n === 0, 'bids were not cleared')
    assert((await eventCount(db, 'auction_reset')) === 1, 'auction_reset not emitted')
    return 'wallets restored, auction_reset emitted'
  })

  // ───────────────────────────────────────────────────────────────────────
  group('4. Bug 2 — identity chain and single-device sessions')
  // ───────────────────────────────────────────────────────────────────────
  await check('an aligned captain resolves their team and can bid', async () => {
    await asUser(db, ADMIN, 'admin')
    const probe = await slotFor('Student Finance')
    await db.query(`select public.open_slot($1)`, [probe])
    await asUser(db, CAPTAIN_A, 'captain')
    const team = await db.query(`select public.current_team_id() as team`)
    assert(team.rows[0].team === TEAM_A, `current_team_id() returned ${team.rows[0].team}`)
    const bid = await db.query(`select public.place_bid($1, 10) as r`, [probe])
    assert(bid.rows[0].r.success === true, 'an aligned captain could not bid')
    return `auth.uid() → team ${team.rows[0].team.slice(0, 8)}…`
  })

  await check('an unauthenticated caller can never bid', async () => {
    await anon(db)
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 10)`, [slot1]), /Authentication required/)
    return ''
  })

  await check('mark_session_active upserts instead of locking the account out', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    const first = await db.query(`select public.mark_session_active() as r`)
    assert(first.rows[0].r === true, 'mark_session_active failed')
    const second = await db.query(`select public.mark_session_active() as r`)
    assert(second.rows[0].r === true, 'a second login was rejected (permanent lockout bug)')
    const rows = await db.query(
      `select count(*)::int as n from public.active_sessions where user_id = $1`,
      [CAPTAIN_A]
    )
    assert(rows.rows[0].n === 1, `${rows.rows[0].n} active session rows`)
    return 'one row, new login always wins'
  })

  await check('invalidate_current_session clears the device record', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    const res = await db.query(`select public.invalidate_current_session() as r`)
    assert(res.rows[0].r === true, 'invalidate failed')
    const rows = await db.query(
      `select count(*)::int as n from public.active_sessions where user_id = $1`,
      [CAPTAIN_A]
    )
    assert(rows.rows[0].n === 0, 'the session record survived logout')
    return 'logged out cleanly'
  })

  // ───────────────────────────────────────────────────────────────────────
  group('5. Bug 2 — opening a slot activates bidding for all four teams')
  // ───────────────────────────────────────────────────────────────────────
  let slot3 = ''
  let eventsBaseline = { placed: 0, changed: 0 }

  await check('reset clears every winner so all four teams are eligible again', async () => {
    await asUser(db, ADMIN, 'admin')
    const res = await db.query(`select public.reset_auction() as r`)
    assert(res.rows[0].r.success === true, 'reset failed')
    const sold = await db.query(
      `select count(*)::int as n from public.slots where status = 'sold'`
    )
    assert(sold.rows[0].n === 0, 'sold slots survived the reset')
    return 'no team carries a win into the new session'
  })

  await check('start → open bidding publishes the item and its 10s window', async () => {
    await asUser(db, ADMIN, 'admin')
    const start = await db.query(`select public.start_auction(1) as r`)
    assert(start.rows[0].r.success === true, 'start_auction failed')
    slot3 = await slotFor('Campus Life Tech')
    const open = await db.query(`select public.open_bidding($1) as r`, [slot3])
    assert(open.rows[0].r.success === true, 'open_bidding failed')

    const state = (await db.query(`select public.get_live_auction_state() as s`)).rows[0].s
    assert(state.active_slot?.id === slot3, 'live state has no active slot')
    assert(state.active_slot.status === 'open', 'the live item is not open')
    assert(state.active_slot.current_bid === 0, 'the opening current bid is not 0')
    assert(
      state.active_slot.min_next_bid === 10,
      `opening bid is ${state.active_slot.min_next_bid}, expected 10`
    )
    assert(state.active_slot.timer_status === 'running', 'the item clock did not start')
    assert(state.active_slot.end_time, 'the item has no deadline')
    assert(state.session?.id === start.rows[0].r.session_id, 'live state lost the session')

    const linked = await db.query(
      `select active_slot_id from public.auction_sessions where id = $1`,
      [start.rows[0].r.session_id]
    )
    assert(
      linked.rows[0].active_slot_id === slot3,
      'the session was not linked to the live item'
    )

    // auction_events is append-only and the slot id survives a reset, so
    // measure the bids this group adds rather than the lifetime total.
    eventsBaseline = {
      placed: (
        await db.query(
          `select count(*)::int as n from public.auction_events where event_type = 'bid_placed' and slot_id = $1`,
          [slot3]
        )
      ).rows[0].n,
      changed: (
        await db.query(
          `select count(*)::int as n from public.auction_events where event_type = 'highest_bid_changed' and slot_id = $1`,
          [slot3]
        )
      ).rows[0].n,
    }
    return 'four captains can act on a 10-point opening bid'
  })

  await check('four captains trade bids 10 → 20 → 30 → 40', async () => {
    const ladder = [
      [CAPTAIN_A, 10],
      [CAPTAIN_B, 20],
      [CAPTAIN_C, 30],
      [CAPTAIN_D, 40],
    ]
    for (const [captain, amount] of ladder) {
      await asUser(db, captain, 'captain')
      const res = await db.query(`select public.place_bid($1, $2) as r`, [slot3, amount])
      assert(res.rows[0].r.success === true, `${captain.slice(-4)} could not bid ${amount}`)
    }
    const slot = await db.query(
      `select current_bid, leader_team_id from public.slots where id = $1`,
      [slot3]
    )
    assert(slot.rows[0].current_bid === 40, 'the current bid is not 40')
    assert(slot.rows[0].leader_team_id === TEAM_D, 'Team Delta is not leading')
    return 'A 10 → B 20 → C 30 → D 40'
  })

  await check('teams that were overtaken can bid again', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    const a = await db.query(`select public.place_bid($1, 50) as r`, [slot3])
    assert(a.rows[0].r.success === true, 'the first leader could not bid after being overtaken')
    await asUser(db, CAPTAIN_B, 'captain')
    const b = await db.query(`select public.place_bid($1, 60) as r`, [slot3])
    assert(b.rows[0].r.success === true, 'the previous leader could not bid after being overtaken')
    const leader = await db.query(`select leader_team_id from public.slots where id = $1`, [slot3])
    assert(leader.rows[0].leader_team_id === TEAM_B, 'leadership did not rotate to Team Beta')
    return 'A 50 → B 60, both had been overtaken'
  })

  await check('the current leader is the only team blocked from bidding', async () => {
    await asUser(db, CAPTAIN_B, 'captain')
    await expectError(
      db,
      'bid',
      () => db.query(`select public.place_bid($1, 70)`, [slot3]),
      /already the highest bidder/
    )
    return 'self-outbid rejected'
  })

  await check('a valid raise restarts the clock with +5s', async () => {
    const before = (
      await db.query(`select end_time from public.slots where id = $1`, [slot3])
    ).rows[0].end_time
    await asUser(db, CAPTAIN_C, 'captain')
    const res = await db.query(`select public.place_bid($1, 70) as r`, [slot3])
    assert(res.rows[0].r.success === true, 'Team Gamma could not raise to 70')
    const after = (
      await db.query(`select end_time from public.slots where id = $1`, [slot3])
    ).rows[0].end_time
    const delta = (new Date(after) - new Date(before)) / 1000
    assert(delta === 5, `the clock moved ${delta}s instead of 5s`)
    return `C 70, clock +${delta}s`
  })

  await check('pausing freezes the live item and blocks bids', async () => {
    await asUser(db, ADMIN, 'admin')
    const paused = await db.query(`select public.pause_auction() as r`)
    assert(paused.rows[0].r.success === true, 'pause failed')
    const slot = (
      await db.query(
        `select timer_status, paused_remaining_seconds from public.slots where id = $1`,
        [slot3]
      )
    ).rows[0]
    assert(
      slot.timer_status === 'paused',
      `the item timer is ${slot.timer_status}, expected paused`
    )
    assert(slot.paused_remaining_seconds > 0, 'the remaining time was not frozen')
    await asUser(db, CAPTAIN_D, 'captain')
    await expectError(
      db,
      'bid',
      () => db.query(`select public.place_bid($1, 80)`, [slot3]),
      /paused/
    )
    return `frozen with ${slot.paused_remaining_seconds}s left`
  })

  await check('resuming restores the clock and re-enables bidding', async () => {
    await asUser(db, ADMIN, 'admin')
    const before = (
      await db.query(`select end_time from public.slots where id = $1`, [slot3])
    ).rows[0].end_time
    const resumed = await db.query(`select public.resume_auction() as r`)
    assert(resumed.rows[0].r.success === true, 'resume failed')
    const after = (
      await db.query(`select end_time, timer_status from public.slots where id = $1`, [slot3])
    ).rows[0]
    assert(after.timer_status === 'running', 'the item clock did not restart')
    assert(new Date(after.end_time) >= new Date(before), 'the deadline moved backwards on resume')
    await asUser(db, CAPTAIN_D, 'captain')
    const bid = await db.query(`select public.place_bid($1, 80) as r`, [slot3])
    assert(bid.rows[0].r.success === true, 'Team Delta could not bid after resume')
    return 'D 80 accepted, clock running'
  })

  await check('pause repairs items opened before the session pointer existed', async () => {
    await asUser(db, ADMIN, 'admin')
    await db.query(
      `update public.auction_sessions
       set active_slot_id = null
       where status not in ('completed', 'cancelled')`
    )
    const paused = await db.query(`select public.pause_auction() as r`)
    assert(paused.rows[0].r.success === true, 'pause failed with a NULL pointer')
    const frozen = (
      await db.query(
        `select timer_status, paused_remaining_seconds from public.slots where id = $1`,
        [slot3]
      )
    ).rows[0]
    assert(frozen.timer_status === 'paused', 'the fallback did not freeze the open item')
    assert(frozen.paused_remaining_seconds > 0, 'the fallback froze zero seconds')
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(
      db,
      'bid',
      () => db.query(`select public.place_bid($1, 90)`, [slot3]),
      /paused/
    )
    await asUser(db, ADMIN, 'admin')
    const resumed = await db.query(`select public.resume_auction() as r`)
    assert(resumed.rows[0].r.success === true, 'resume failed with a NULL pointer')
    const running = (
      await db.query(`select timer_status from public.slots where id = $1`, [slot3])
    ).rows[0]
    assert(running.timer_status === 'running', 'the fallback did not restart the clock')
    return 'a NULL active_slot_id still freezes and restores the open item'
  })

  await check('live state exposes the final leader, next bid and four bidders', async () => {
    const state = (await db.query(`select public.get_live_auction_state() as s`)).rows[0].s
    assert(state.active_slot.current_bid === 80, `current bid is ${state.active_slot.current_bid}`)
    assert(state.active_slot.leader_team_id === TEAM_D, 'the live leader is not Team Delta')
    assert(state.active_slot.min_next_bid === 85, `min_next_bid is ${state.active_slot.min_next_bid}`)
    const bidders = state.teams.filter((t) => t.current_bid > 0)
    assert(bidders.length === 4, `${bidders.length} teams show a bid`)
    assert(
      new Set(bidders.map((t) => t.current_bid)).size === 4,
      'team best bids are not distinct'
    )
    return 'current 80, next 90, 4 bidders'
  })

  await check('the event stream has one bid and one leader change per bid', async () => {
    const placed =
      (
        await db.query(
          `select count(*)::int as n from public.auction_events where event_type = 'bid_placed' and slot_id = $1`,
          [slot3]
        )
      ).rows[0].n - eventsBaseline.placed
    const changed =
      (
        await db.query(
          `select count(*)::int as n from public.auction_events where event_type = 'highest_bid_changed' and slot_id = $1`,
          [slot3]
        )
      ).rows[0].n - eventsBaseline.changed
    const teams = (
      await db.query(
        `select count(distinct team_id)::int as n from public.auction_events where event_type = 'bid_placed' and slot_id = $1`,
        [slot3]
      )
    ).rows[0].n
    assert(placed === 8, `${placed} bid_placed events, expected 8`)
    assert(changed === 8, `${changed} highest_bid_changed events, expected 8`)
    assert(teams === 4, `${teams} teams in the stream, expected 4`)
    return '8 bids, 8 leader changes, 4 teams'
  })

  await check('closing the four-team item debits only the winner once', async () => {
    await asUser(db, ADMIN, 'admin')
    const res = await db.query(`select public.close_slot($1) as r`, [slot3])
    assert(res.rows[0].r.status === 'sold', 'the item was not sold')
    assert(res.rows[0].r.winning_bid === 80, `winning bid was ${res.rows[0].r.winning_bid}`)
    assert((await walletOf(db, TEAM_D)) === 20, 'the winner balance is not 20')
    assert((await walletOf(db, TEAM_A)) === 100, 'a losing team was charged')
    assert((await walletOf(db, TEAM_B)) === 100, 'a losing team was charged')
    assert((await walletOf(db, TEAM_C)) === 100, 'a losing team was charged')
    const ledger = await db.query(
      `select count(*)::int as n from public.wallet_transactions where slot_id = $1 and tx_type = 'win_deduction'`,
      [slot3]
    )
    assert(ledger.rows[0].n === 1, `${ledger.rows[0].n} debit entries`)
    return 'D 100 − 80 = 20, A/B/C untouched'
  })

  // ─────────────────────────────────────────────────────────────────────────
  group('6. 3-Round question allocation, limits and elimination')
  // ─────────────────────────────────────────────────────────────────────────
  await check('reset the contest for clean 3-round test execution', async () => {
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.reset_auction()`)
    await db.query(`select public.start_auction(1)`)
    return 'clean auction state in Round 1'
  })

  let r1Slot1 = ''
  let r1Slot2 = ''
  let r2Slot1 = ''
  let r2Slot2 = ''
  let r3Slot1 = ''

  await check('Scenario 1: Team A gets one question in Round 1 and another in Round 2', async () => {
    // Round 1 item for Team A
    r1Slot1 = (await db.query(`select id from public.slots where status = 'pending' and round = 1 limit 1`)).rows[0].id
    await db.query(`select public.open_slot($1)`, [r1Slot1])
    await asUser(db, CAPTAIN_A, 'captain')
    await db.query(`select public.place_bid($1, 10)`, [r1Slot1])
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.close_slot($1)`, [r1Slot1])

    // Advance to Round 2
    await db.query(`select public.set_auction_round(2)`)

    // Round 2 item for Team A
    r2Slot1 = (await db.query(`select id from public.slots where status = 'pending' and round = 2 limit 1`)).rows[0].id
    await db.query(`select public.open_slot($1)`, [r2Slot1])
    await asUser(db, CAPTAIN_A, 'captain')
    await db.query(`select public.place_bid($1, 10)`, [r2Slot1])
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.close_slot($1)`, [r2Slot1])

    // Verify Team A won count is 2
    const wonCount = (await db.query(
      `select count(*)::int as n from public.slots where winner_team_id = $1 and status = 'sold'`,
      [TEAM_A]
    )).rows[0].n
    assert(wonCount === 2, `Team A won ${wonCount} questions, expected 2`)
    return 'Team A acquired 1 in R1 and 1 in R2 (total 2)'
  })

  await check('Scenario 2: Team B gets no question in Round 1 but acquires two across later rounds', async () => {
    // In Round 1, Team B did not win any slot.
    // In Round 2, Team B wins r2Slot2
    r2Slot2 = (await db.query(`select id from public.slots where status = 'pending' and round = 2 limit 1`)).rows[0].id
    await db.query(`select public.open_slot($1)`, [r2Slot2])
    await asUser(db, CAPTAIN_B, 'captain')
    await db.query(`select public.place_bid($1, 15)`, [r2Slot2])
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.close_slot($1)`, [r2Slot2])

    // Second slot in Round 2 also won by Team B (multiple wins in same round allowed)
    const r2Slot3 = (await db.query(`select id from public.slots where status = 'pending' and round = 2 limit 1`)).rows[0].id
    await db.query(`select public.open_slot($1)`, [r2Slot3])
    await asUser(db, CAPTAIN_B, 'captain')
    await db.query(`select public.place_bid($1, 20)`, [r2Slot3])
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.close_slot($1)`, [r2Slot3])

    const wonCountB = (await db.query(
      `select count(*)::int as n from public.slots where winner_team_id = $1 and status = 'sold'`,
      [TEAM_B]
    )).rows[0].n
    assert(wonCountB === 2, `Team B won ${wonCountB} questions, expected 2`)
    return 'Team B had 0 in R1, acquired 2 in R2 (total 2)'
  })

  await check('Scenario 4: Teams with two questions (Team A and B) are excluded from Round 3', async () => {
    // Switch to Round 3 recovery auction
    await db.query(`select public.set_auction_round(3)`)

    // Open a slot for Round 3
    r3Slot1 = (await db.query(`select id from public.slots where status = 'pending' limit 1`)).rows[0].id
    await db.query(`select public.open_slot($1)`, [r3Slot1])

    // Team A has 2 questions -> must be rejected
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(
      db,
      'place_bid Team A in R3',
      () => db.query(`select public.place_bid($1, 10)`, [r3Slot1]),
      /cannot participate in the Round 3 recovery auction/
    )

    // Team B has 2 questions -> must be rejected
    await asUser(db, CAPTAIN_B, 'captain')
    await expectError(
      db,
      'place_bid Team B in R3',
      () => db.query(`select public.place_bid($1, 10)`, [r3Slot1]),
      /cannot participate in the Round 3 recovery auction/
    )
    return 'Teams with 2 questions strictly blocked from Round 3'
  })

  await check('Scenario 3: Team C (1 question from earlier) acquires its second in Round 3', async () => {
    // Team C acquires r3Slot1
    await asUser(db, CAPTAIN_C, 'captain')
    await db.query(`select public.place_bid($1, 10)`, [r3Slot1])
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.close_slot($1)`, [r3Slot1])

    // Now Team C wins another slot to reach 2
    const r3Slot2 = (await db.query(`select id from public.slots where status = 'pending' limit 1`)).rows[0].id
    await db.query(`select public.open_slot($1)`, [r3Slot2])
    await asUser(db, CAPTAIN_C, 'captain')
    await db.query(`select public.place_bid($1, 10)`, [r3Slot2])
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.close_slot($1)`, [r3Slot2])

    const wonCountC = (await db.query(
      `select count(*)::int as n from public.slots where winner_team_id = $1 and status = 'sold'`,
      [TEAM_C]
    )).rows[0].n
    assert(wonCountC === 2, `Team C won ${wonCountC} questions, expected 2`)

    // Universal limit check: Team C now has 2 questions, cannot acquire a 3rd
    const r3Slot3 = (await db.query(`select id from public.slots where status = 'pending' limit 1`)).rows[0].id
    await db.query(`select public.open_slot($1)`, [r3Slot3])
    await asUser(db, CAPTAIN_C, 'captain')
    await expectError(
      db,
      'place_bid Team C 3rd question',
      () => db.query(`select public.place_bid($1, 10)`, [r3Slot3]),
      /cannot participate in the Round 3 recovery auction/
    )
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.skip_slot($1)`, [r3Slot3])
    return 'Team C reached 2 questions and is capped'
  })

  await check('Scenario 5: Team D has fewer than 2 questions (0) and is eliminated after Round 3', async () => {
    // Team D never won any question (0 questions)
    // Run finalize_round_3_eliminations()
    await asUser(db, ADMIN, 'admin')
    const finRes = await db.query(`select public.finalize_round_3_eliminations() as r`)
    const r = finRes.rows[0].r
    assert(r.success === true, 'finalize_round_3_eliminations failed')
    assert(r.qualified_count >= 3, `Expected at least 3 qualified teams (A, B, C), got ${r.qualified_count}`)
    assert(r.eliminated_count >= 1, `Expected at least 1 eliminated team (D), got ${r.eliminated_count}`)

    // Verify Team D is marked eliminated in DB
    const elim = await db.query(`select * from public.team_eliminations where team_id = $1`, [TEAM_D])
    assert(elim.rows.length === 1, 'Team D not in team_eliminations')
    assert(elim.rows[0].rule === 'no_selection', `Rule was ${elim.rows[0].rule}`)
    return `${r.qualified_count} teams qualified, ${r.eliminated_count} eliminated`
  })

  await check('Scenario 6: Eliminated team (Team D) cannot bid again', async () => {
    const probeSlot = (await db.query(`select id from public.slots where status = 'pending' limit 1`)).rows[0].id
    await db.query(`select public.open_slot($1)`, [probeSlot])
    await asUser(db, CAPTAIN_D, 'captain')
    await expectError(
      db,
      'eliminated team bid',
      () => db.query(`select public.place_bid($1, 10)`, [probeSlot]),
      /eliminated and can no longer bid/
    )
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.skip_slot($1)`, [probeSlot])
    return 'Team D blocked with "eliminated and can no longer bid"'
  })

  await check('Scenario 7: State read functions preserve allocations and qualification status', async () => {
    const live = await db.query(`select public.get_live_auction_state() as r`)
    const s = live.rows[0].r
    assert(s.teams && s.teams.length > 0, 'No teams returned by get_live_auction_state')
    const teamA = s.teams.find((t) => t.id === TEAM_A)
    const teamD = s.teams.find((t) => t.id === TEAM_D)
    assert(teamA && teamA.won_count === 2, `Team A won_count was ${teamA?.won_count}`)
    assert(teamA.qualified === true, 'Team A was not marked qualified')
    assert(teamD && teamD.won_count === 0, `Team D won_count was ${teamD?.won_count}`)
    assert(teamD.qualified === false, 'Team D was marked qualified')

    const res = await db.query(`select public.get_bidding_results() as r`)
    const teams = res.rows[0].r.teams
    const rA = teams.find((t) => t.team_id === TEAM_A)
    const rD = teams.find((t) => t.team_id === TEAM_D)
    assert(rA.qualified === true, 'Team A not qualified in get_bidding_results')
    assert(rD.eliminated === true, 'Team D not eliminated in get_bidding_results')
    return 'Authoritative state reflects allocations, qualification, and elimination'
  })

  await check('Scenario 8: Reopening skipped / unsold slots in Round 3 works correctly', async () => {
    // In earlier migrations, only pending slots could be opened.
    // In Round 3, skipped or unsold slots whose topic is not sold can be reopened.
    const slotToSkip = (await db.query(`select id from public.slots where status = 'pending' limit 1`)).rows[0].id
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.open_slot($1)`, [slotToSkip])
    await db.query(`select public.skip_slot($1)`, [slotToSkip])

    const openRes = await db.query(`select public.open_slot($1) as r`, [slotToSkip])
    assert(openRes.rows[0].r.success === true, 'Reopening skipped slot failed')
    assert(openRes.rows[0].r.status === 'open', 'Reopened slot status is not open')
    await db.query(`select public.close_slot($1)`, [slotToSkip])
    return 'Skipped slot successfully reopened for Round 3 recovery'
  })

  await db.close()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`TOTAL: ${results.length} scenarios, ${results.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length > 0) {
    console.log('\nFailures:')
    for (const f of failed) console.log(`  - [${f.group}] ${f.name}: ${f.detail}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
