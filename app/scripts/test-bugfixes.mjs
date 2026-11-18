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
      ('${TEAM_B}', 'Team Beta',  '${CAPTAIN_B}');

    insert into public.members (id, team_id, name, email) values
      ('${CAPTAIN_A}', '${TEAM_A}', 'Alpha Captain', '4mt24cs001@mite.ac.in'),
      ('${CAPTAIN_B}', '${TEAM_B}', 'Beta Captain',  '4mt24cs002@mite.ac.in');

    insert into auth.users (id, email) values
      ('${CAPTAIN_A}', '4mt24cs001@mite.ac.in'),
      ('${CAPTAIN_B}', '4mt24cs002@mite.ac.in');

    insert into public.wallets (team_id, balance) values
      ('${TEAM_A}', 100), ('${TEAM_B}', 100);
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
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 25)`, [slot1]), /Bid too low/)
    return 'min next bid is 30'
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

  await check('one win per round is enforced after a restart', async () => {
    const nextRound1 = await slotFor('Hyperlocal Marketplace')
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.open_slot($1)`, [nextRound1])
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(
      db,
      'bid',
      () => db.query(`select public.place_bid($1, 10)`, [nextRound1]),
      /already won a slot in Round 1/
    )
    await asUser(db, ADMIN, 'admin')
    await db.query(`select public.skip_slot($1)`, [nextRound1])
    return 'winner of round 1 blocked from round 1 items'
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
