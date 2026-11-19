/**
 * Bid2Build — auction engine behaviour suite.
 *
 * Executes the real migration chain and then exercises the auction
 * engine the way PostgreSQL will run it in production: through the
 * SECURITY DEFINER functions, with a simulated authenticated caller
 * (auth.uid() / auth.jwt()).
 *
 *   node scripts/test-auction-engine.mjs
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

const TEAM_A = 'a0000000-0000-4000-8000-000000000001'
const CAPTAIN_A = 'a0000000-0000-4000-8000-000000000011'
const TEAM_B = 'a0000000-0000-4000-8000-000000000002'
const CAPTAIN_B = 'a0000000-0000-4000-8000-000000000021'
const TEAM_C = 'a0000000-0000-4000-8000-000000000003'
const CAPTAIN_C = 'a0000000-0000-4000-8000-000000000031'
const JUDGE = 'a0000000-0000-4000-8000-000000000099'

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
      ('${TEAM_C}', 'Team Gamma', '${CAPTAIN_C}');

    insert into public.members (id, team_id, name, email) values
      ('${CAPTAIN_A}', '${TEAM_A}', 'Alpha Captain', 'alpha@test.invalid'),
      ('${CAPTAIN_B}', '${TEAM_B}', 'Beta Captain',  'beta@test.invalid'),
      ('${CAPTAIN_C}', '${TEAM_C}', 'Gamma Captain', 'gamma@test.invalid');

    insert into public.wallets (team_id, balance) values
      ('${TEAM_A}', 100), ('${TEAM_B}', 100), ('${TEAM_C}', 100);
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

  const walletOf = async (teamId) => {
    const res = await db.query(`select balance from public.wallets where team_id = $1`, [teamId])
    return res.rows[0]?.balance
  }

  const ledgerCount = async (slotId) => {
    const res = await db.query(
      `select count(*)::int as n from public.wallet_transactions
       where slot_id = $1 and tx_type = 'win_deduction'`,
      [slotId]
    )
    return res.rows[0].n
  }

  // ───────────────────────────────────────────────────────────────────────
  group('1. Session lifecycle')
  // ───────────────────────────────────────────────────────────────────────
  await check('non-admin cannot start the auction', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    const msg = await expectError(db, 'start_auction', () => db.query(`select public.start_auction(1)`), /Admin access required/)
    return msg
  })

  await check('admin starts the auction session', async () => {
    await asUser(db, JUDGE, 'admin')
    const res = await db.query(`select public.start_auction(1) as r`)
    assert(res.rows[0].r.success === true, 'start_auction did not succeed')
    assert(res.rows[0].r.status === 'ready', `unexpected status ${res.rows[0].r.status}`)
    return `session ${res.rows[0].r.session_id}`
  })

  await check('starting twice is idempotent', async () => {
    const res = await db.query(`select public.start_auction(1) as r`)
    assert(res.rows[0].r.already_started === true, 'second start was not reported as idempotent')
    return ''
  })

  // ───────────────────────────────────────────────────────────────────────
  group('2. Question selection and opening bidding')
  // ───────────────────────────────────────────────────────────────────────
  let slot1 = ''
  await check('the opening window comes from settings (not hardcoded)', async () => {
    await db.query(`update public.settings set value = '25'::jsonb where key = 'opening_window_seconds'`)
    await asUser(db, JUDGE, 'admin')
    const probe = await slotFor('Student Finance')
    const res = await db.query(`select public.open_slot($1) as r`, [probe])
    assert(res.rows[0].r.window_seconds === 25, `engine ignored the setting (${res.rows[0].r.window_seconds})`)
    await db.query(`select public.skip_slot($1)`, [probe])
    await db.query(`update public.settings set value = '10'::jsonb where key = 'opening_window_seconds'`)
    return 'opening_window_seconds = 25 honoured'
  })

  await check('admin selects a question', async () => {
    slot1 = await slotFor('Campus Life Tech')
    const res = await db.query(`select public.select_auction_question($1) as r`, [slot1])
    assert(res.rows[0].r.success === true, 'select_auction_question failed')
    assert(res.rows[0].r.status === 'question_selection', 'wrong session status')
    return `topic ${res.rows[0].r.topic_title}`
  })

  await check('non-admin cannot select a question', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'select', () => db.query(`select public.select_auction_question($1)`, [slot1]), /Admin access required/)
    await asUser(db, JUDGE, 'admin')
    return ''
  })

  await check('admin opens bidding with the configured window', async () => {
    const res = await db.query(`select public.open_bidding($1) as r`, [slot1])
    assert(res.rows[0].r.success === true, 'open_bidding failed')
    assert(res.rows[0].r.status === 'open', 'slot did not open')
    assert(res.rows[0].r.session_status === 'bidding_open', 'session did not enter bidding_open')
    assert(res.rows[0].r.window_seconds === 10, `window was ${res.rows[0].r.window_seconds}`)
    return `window ${res.rows[0].r.window_seconds}s, min bid ${res.rows[0].r.starting_bid}`
  })

  await check('a second item cannot be opened while one is open', async () => {
    const other = await slotFor('Hyperlocal Marketplace')
    const msg = await expectError(db, 'open', () => db.query(`select public.open_slot($1)`, [other]), /already open/)
    return msg
  })

  // ───────────────────────────────────────────────────────────────────────
  group('3. Bidding rules')
  // ───────────────────────────────────────────────────────────────────────
  await check('an unauthenticated caller cannot bid', async () => {
    await anon(db)
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 10)`, [slot1]), /Authentication required/)
    return ''
  })

  await check('a non-captain member cannot bid', async () => {
    await db.query(`insert into public.members (id, team_id, name, email)
                    values ('a0000000-0000-4000-8000-000000000012', '${TEAM_A}', 'Alpha Member', 'am@test.invalid')`)
    await asUser(db, 'a0000000-0000-4000-8000-000000000012', 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 10)`, [slot1]), /Only the team captain/)
    return ''
  })

  await check('a bid below the minimum is rejected', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 5)`, [slot1]), /Bid too low/)
    return ''
  })

  await check('a valid opening bid is accepted', async () => {
    const res = await db.query(`select public.place_bid($1, 10) as r`, [slot1])
    assert(res.rows[0].r.success === true, 'valid bid rejected')
    assert(res.rows[0].r.current_bid === 10, `current bid is ${res.rows[0].r.current_bid}`)
    assert(res.rows[0].r.min_next_bid === 15, `min next bid is ${res.rows[0].r.min_next_bid}`)
    return `bid ${res.rows[0].r.amount}, next minimum ${res.rows[0].r.min_next_bid}`
  })

  await check('a raise below the minimum increment is rejected', async () => {
    await asUser(db, CAPTAIN_B, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 12)`, [slot1]), /Bid too low/)
    return ''
  })

  await check('the leading team cannot bid against itself', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 30)`, [slot1]), /already the highest bidder/)
    return ''
  })

  await check('a valid raise is accepted and extends the clock', async () => {
    const before = await db.query(`select end_time from public.slots where id = $1`, [slot1])
    await asUser(db, CAPTAIN_B, 'captain')
    const res = await db.query(`select public.place_bid($1, 30) as r`, [slot1])
    assert(res.rows[0].r.success === true, 'raise rejected')
    const after = await db.query(`select end_time from public.slots where id = $1`, [slot1])
    const delta = (new Date(after.rows[0].end_time) - new Date(before.rows[0].end_time)) / 1000
    assert(delta === 5, `timer extended by ${delta}s instead of 5s`)
    return `raise to ${res.rows[0].r.amount}, clock +${delta}s`
  })

  await check('a losing bid does not change the balance (Rule Book 5.1)', async () => {
    const balance = await walletOf(TEAM_A)
    assert(balance === 100, `balance changed to ${balance}`)
    return 'balance still 100'
  })

  await check('a bid above the available balance is rejected', async () => {
    await asUser(db, CAPTAIN_C, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 150)`, [slot1]), /Insufficient balance/)
    return ''
  })

  await check('a bid on a closed item is rejected', async () => {
    const other = await slotFor('Hyperlocal Marketplace')
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 10)`, [other]), /not open for bidding/)
    return ''
  })

  await check('a late bid (after the deadline) is rejected', async () => {
    await db.query(`update public.slots set end_time = clock_timestamp() - interval '1 second' where id = $1`, [slot1])
    await asUser(db, CAPTAIN_C, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 50)`, [slot1]), /expired/)
    await db.query(`update public.slots set end_time = clock_timestamp() + interval '30 seconds' where id = $1`, [slot1])
    return ''
  })

  await check('place_bid locks the item row (FOR UPDATE)', async () => {
    const res = await db.query(
      `select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'place_bid'`
    )
    assert(/for\s+update/i.test(res.rows[0].prosrc), 'place_bid no longer locks the slot row')
    return 'row-level locking present'
  })

  await check('the highest bid can never regress', async () => {
    const before = await db.query(`select current_bid from public.slots where id = $1`, [slot1])
    await asUser(db, CAPTAIN_C, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 25)`, [slot1]), /Bid too low/)
    const after = await db.query(`select current_bid from public.slots where id = $1`, [slot1])
    assert(after.rows[0].current_bid === before.rows[0].current_bid, 'the highest bid regressed')
    return `current bid held at ${after.rows[0].current_bid}`
  })

  // ───────────────────────────────────────────────────────────────────────
  group('4. Pause / resume / timer')
  // ───────────────────────────────────────────────────────────────────────
  await check('pausing preserves the remaining time', async () => {
    await asUser(db, JUDGE, 'admin')
    const res = await db.query(`select public.pause_auction() as r`)
    assert(res.rows[0].r.is_paused === true, 'session was not paused')
    assert(res.rows[0].r.paused_remaining_seconds > 0, 'remaining time was not captured')
    return `${res.rows[0].r.paused_remaining_seconds}s preserved`
  })

  await check('a paused auction rejects bids', async () => {
    await asUser(db, CAPTAIN_C, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 60)`, [slot1]), /paused/)
    return ''
  })

  await check('resuming restores the preserved remaining time', async () => {
    await asUser(db, JUDGE, 'admin')
    const before = await db.query(`select paused_remaining_seconds from public.slots where id = $1`, [slot1])
    const res = await db.query(`select public.resume_auction() as r`)
    assert(res.rows[0].r.is_paused === false, 'session was not resumed')
    const after = await db.query(`select end_time from public.slots where id = $1`, [slot1])
    const remaining = Math.round((new Date(after.rows[0].end_time) - Date.now()) / 1000)
    assert(
      Math.abs(remaining - before.rows[0].paused_remaining_seconds) <= 2,
      `remaining ${remaining}s vs preserved ${before.rows[0].paused_remaining_seconds}s`
    )
    return `restored ${remaining}s`
  })

  await check('the admin can extend the authoritative solving clock', async () => {
    await asUser(db, JUDGE, 'admin')
    await db.query(`select public.start_auction_timer(120)`)
    const before = await db.query(`select timer_ends_at from public.auction_sessions where total_manual_extension_seconds >= 0 limit 1`)
    await db.query(`select public.adjust_auction_timer(30, 'manual')`)
    const after = await db.query(`select timer_ends_at from public.auction_sessions where total_manual_extension_seconds >= 0 limit 1`)
    const delta = Math.round((new Date(after.rows[0].timer_ends_at) - new Date(before.rows[0].timer_ends_at)) / 1000)
    assert(delta === 30, `solving clock moved by ${delta}s instead of 30s`)
    return '+30s'
  })

  await check('the admin can extend the bidding deadline of an open item', async () => {
    await asUser(db, JUDGE, 'admin')
    const before = await db.query(`select end_time from public.slots where id = $1`, [slot1])
    const res = await db.query(`select public.adjust_bidding_timer(30, $1, 'manual') as r`, [slot1])
    assert(res.rows[0].r.success === true, 'adjust_bidding_timer failed')
    const after = await db.query(`select end_time from public.slots where id = $1`, [slot1])
    const delta = Math.round((new Date(after.rows[0].end_time) - new Date(before.rows[0].end_time)) / 1000)
    assert(delta === 30, `bidding clock moved by ${delta}s instead of 30s`)
    return '+30s'
  })

  await check('a non-admin cannot adjust the clock', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'adjust', () => db.query(`select public.adjust_auction_timer(60)`), /Admin access required/)
    return ''
  })

  // ───────────────────────────────────────────────────────────────────────
  group('5. Elimination')
  // ───────────────────────────────────────────────────────────────────────
  await check('a non-admin cannot eliminate a team', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'eliminate', () => db.query(`select public.eliminate_team($1, 'x', 'manual')`, [TEAM_C]), /Admin access required/)
    return ''
  })

  await check('the admin eliminates a team and the reason is recorded', async () => {
    await asUser(db, JUDGE, 'admin')
    const res = await db.query(`select public.eliminate_team($1, 'Failed to participate', 'no_bid') as r`, [TEAM_C])
    assert(res.rows[0].r.success === true, 'elimination failed')
    const rows = await db.query(`select rule, reason, restored_at from public.team_eliminations where team_id = $1`, [TEAM_C])
    assert(rows.rows.length === 1, 'no elimination record')
    assert(rows.rows[0].rule === 'no_bid' && rows.rows[0].reason === 'Failed to participate', 'record is wrong')
    assert(rows.rows[0].restored_at === null, 'the record is already restored')
    return 'recorded with reason and timestamp'
  })

  await check('an eliminated team cannot bid', async () => {
    await asUser(db, CAPTAIN_C, 'captain')
    await expectError(db, 'bid', () => db.query(`select public.place_bid($1, 60)`, [slot1]), /eliminated/)
    return ''
  })

  await check('the admin restores the team and bidding works again', async () => {
    await asUser(db, JUDGE, 'admin')
    const res = await db.query(`select public.restore_team($1, 'reinstated') as r`, [TEAM_C])
    assert(res.rows[0].r.success === true, 'restore failed')
    await asUser(db, CAPTAIN_C, 'captain')
    const bid = await db.query(`select public.place_bid($1, 40) as r`, [slot1])
    assert(bid.rows[0].r.success === true, 'the restored team still cannot bid')
    return 'restored and bidding again'
  })

  // ───────────────────────────────────────────────────────────────────────
  group('6. Finalisation, points and the ledger')
  // ───────────────────────────────────────────────────────────────────────
  await check('a non-admin cannot close an item', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'close', () => db.query(`select public.close_slot($1)`, [slot1]), /Admin access required/)
    return ''
  })

  await check('closing deducts the winning amount exactly once', async () => {
    await asUser(db, JUDGE, 'admin')
    const res = await db.query(`select public.close_slot($1) as r`, [slot1])
    assert(res.rows[0].r.status === 'sold', 'item was not sold')
    assert(res.rows[0].r.winning_bid === 40, `winning bid was ${res.rows[0].r.winning_bid}`)
    const balance = await walletOf(TEAM_C)
    assert(balance === 60, `winner balance is ${balance}, expected 60`)
    const entries = await ledgerCount(slot1)
    assert(entries === 1, `${entries} win_deduction entries were written`)
    return '40 pts deducted once, balance 60'
  })

  await check('finalising twice is rejected (no double charge)', async () => {
    await asUser(db, JUDGE, 'admin')
    await expectError(db, 'close', () => db.query(`select public.close_slot($1)`, [slot1]), /Only open slots/)
    const entries = await ledgerCount(slot1)
    assert(entries === 1, `${entries} win_deduction entries after the retry`)
    const balance = await walletOf(TEAM_C)
    assert(balance === 60, `balance changed to ${balance}`)
    return 'still exactly one ledger entry'
  })

  await check('the losing teams were not charged', async () => {
    assert((await walletOf(TEAM_A)) === 100, 'Team Alpha was charged')
    assert((await walletOf(TEAM_B)) === 100, 'Team Beta was charged')
    return 'balances untouched at 100'
  })

  await check('the ledger explains every balance change', async () => {
    const res = await db.query(
      `select count(*)::int as n, sum(amount)::int as total from public.wallet_transactions`
    )
    assert(res.rows[0].n === 1, `${res.rows[0].n} ledger entries expected 1`)
    assert(res.rows[0].total === -40, `ledger total is ${res.rows[0].total}`)
    return 'one entry of -40 pts'
  })

  await check('a problem statement can only be sold once', async () => {
    await asUser(db, JUDGE, 'admin')
    await expectError(db, 'select', () => db.query(`select public.select_auction_question($1)`, [slot1]), /Only a pending auction item/)
    const topicId = await db.query(`select topic_id from public.slots where id = $1`, [slot1])
    await expectError(
      db,
      'insert',
      () => db.query(
        `insert into public.slots (topic_id, round, status, current_bid, min_bid)
         values ($1, 1, 'pending', 0, 10)`,
        [topicId.rows[0].topic_id]
      ),
      /already been sold/
    )
    return 'the topic is closed for sale'
  })

  // ───────────────────────────────────────────────────────────────────────
  group('7. Submission, approval and bonus time')
  // ───────────────────────────────────────────────────────────────────────
  let submissionId = ''
  let gammaSubmissionId = ''
  await check('a submission is recorded against the assigned question', async () => {
    const res = await db.query(
      `insert into public.submissions (team_id, slot_id, repository_url)
       values ($1, $2, 'https://github.com/test/alpha') returning id`,
      [TEAM_A, slot1]
    )
    submissionId = res.rows[0].id
    return submissionId
  })

  await check('a submission for a question the team does not own is rejected', async () => {
    await asUser(db, JUDGE, 'admin')
    await expectError(
      db,
      'approve',
      () => db.query(`select public.approve_submission($1, 10, 'n/a', false)`, [submissionId]),
      /not linked to a question owned by this team/
    )
    return ''
  })

  await check('bonus cannot be awarded before approval', async () => {
    await asUser(db, JUDGE, 'judge')
    await expectError(db, 'bonus', () => db.query(`select public.grant_bonus_time($1, 'early')`, [submissionId]), /must be approved/)
    return ''
  })

  await check('a participant cannot award a bonus', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'bonus', () => db.query(`select public.grant_bonus_time($1, 'self')`, [submissionId]), /Judge or admin access/)
    return ''
  })

  await check('an approved solution extends the authoritative clock', async () => {
    // The winning team (Gamma) submits for the question it owns.
    const res = await db.query(
      `insert into public.submissions (team_id, slot_id, repository_url)
       values ($1, $2, 'https://github.com/test/gamma') returning id`,
      [TEAM_C, slot1]
    )
    const gammaSubmission = res.rows[0].id
    gammaSubmissionId = gammaSubmission

    await asUser(db, JUDGE, 'judge')
    const before = await db.query(
      `select timer_ends_at, total_bonus_seconds from public.auction_sessions
       where status in ('ready','question_selection','bidding_open','bidding_closed',
                        'finalizing','question_assigned','solving') limit 1`
    )
    const approval = await db.query(`select public.approve_submission($1, 90, 'great work', true) as r`, [gammaSubmission])
    assert(approval.rows[0].r.success === true, 'approval failed')
    assert(approval.rows[0].r.bonus && approval.rows[0].r.bonus.success === true, 'bonus was not granted')

    const after = await db.query(
      `select timer_ends_at, total_bonus_seconds from public.auction_sessions
       where total_bonus_seconds > 0 limit 1`
    )
    assert(after.rows[0].total_bonus_seconds === 60, `total bonus seconds is ${after.rows[0].total_bonus_seconds}`)
    const delta = Math.round((new Date(after.rows[0].timer_ends_at) - new Date(before.rows[0].timer_ends_at)) / 1000)
    assert(delta === 60, `the solving clock moved by ${delta}s instead of 60s`)
    return `+${after.rows[0].total_bonus_seconds}s awarded, clock +${delta}s`
  })

  await check('the same solution cannot award the bonus twice', async () => {
    await asUser(db, JUDGE, 'judge')
    const res = await db.query(`select public.grant_bonus_time($1, 'again') as r`, [gammaSubmissionId])
    assert(res.rows[0].r.already_awarded === true, 'a duplicate bonus was awarded')
    const after = await db.query(`select total_bonus_seconds from public.auction_sessions where total_bonus_seconds > 0 limit 1`)
    assert(after.rows[0].total_bonus_seconds === 60, `the clock grew again (${after.rows[0].total_bonus_seconds})`)
    return 'idempotent — clock unchanged'
  })

  await check('the bonus is recorded in the bonus ledger', async () => {
    const res = await db.query(`select count(*)::int as n from public.bonus_transactions`)
    assert(res.rows[0].n === 1, `${res.rows[0].n} bonus transactions recorded`)
    return 'one ledger row'
  })

  // ───────────────────────────────────────────────────────────────────────
  group('8. Live state and events')
  // ───────────────────────────────────────────────────────────────────────
  await check('the live state exposes the authoritative picture', async () => {
    const res = await db.query(`select public.get_live_auction_state() as r`)
    const state = res.rows[0].r
    assert(state.session, 'no session in the live state')
    assert(state.active_slot, 'no active item in the live state')
    assert(state.active_slot.current_bid === 40, `current bid is ${state.active_slot.current_bid}`)
    assert(Array.isArray(state.teams) && state.teams.length === 3, 'teams missing from the live state')
    assert(state.settings.min_bid === 10, 'settings missing from the live state')
    return `bid ${state.active_slot.current_bid}, ${state.teams.length} teams, ${state.events.length} events`
  })

  await check('every event type is recorded in the event stream', async () => {
    const res = await db.query(
      `select count(distinct event_type)::int as n from public.auction_events
       where event_type in ('bid_placed','highest_bid_changed','auction_finalized',
                             'bidding_opened','bonus_time_granted','team_eliminated',
                             'team_restored')`
    )
    assert(res.rows[0].n >= 6, `only ${res.rows[0].n} distinct event types recorded`)
    return `${res.rows[0].n} event types`
  })

  await check('the event payloads never contain private data', async () => {
    const res = await db.query(
      `select count(*)::int as n from public.auction_events
       where payload::text ~* 'test\\.invalid|repository|judge_notes|access_token'`
    )
    assert(res.rows[0].n === 0, `${res.rows[0].n} events leak private data`)
    return ''
  })

  await check('a team can only read its own bid history', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'history', () => db.query(`select public.get_team_bid_history($1)`, [TEAM_C]), /Not authorised/)
    await asUser(db, JUDGE, 'admin')
    return ''
  })

  // ───────────────────────────────────────────────────────────────────────
  group('9. Reset')
  // ───────────────────────────────────────────────────────────────────────
  await check('the admin reset restores wallets and clears bids', async () => {
    await asUser(db, JUDGE, 'admin')
    const res = await db.query(`select public.reset_auction() as r`)
    assert(res.rows[0].r.success === true, 'reset failed')
    assert((await walletOf(TEAM_C)) === 100, 'wallet was not restored')
    const bids = await db.query(`select count(*)::int as n from public.bids`)
    assert(bids.rows[0].n === 0, 'bids were not cleared')
    const ledger = await db.query(`select count(*)::int as n from public.wallet_transactions`)
    assert(ledger.rows[0].n === 0, 'the ledger was not cleared')
    return 'wallets, bids and ledger restored'
  })

  await check('a non-admin cannot reset the auction', async () => {
    await asUser(db, CAPTAIN_A, 'captain')
    await expectError(db, 'reset', () => db.query(`select public.reset_auction()`), /Admin access required/)
    return ''
  })

  // ───────────────────────────────────────────────────────────────────────
  group('10. Identity chain (auth.users.id == members.id == teams.captain_id)')
  // ───────────────────────────────────────────────────────────────────────
  const LEGACY_MEMBER = 'f0000000-0000-4000-8000-0000000000aa'
  const LEGACY_TEAM = 'f0000000-0000-4000-8000-0000000000bb'
  const LEGACY_AUTH = 'f0000000-0000-4000-8000-0000000000cc'

  await check('a legacy team with a mismatched member id is realigned', async () => {
    await db.exec(`
      insert into auth.users (id, email) values ('${LEGACY_AUTH}', 'legacy@test.invalid');
      insert into public.teams (id, name, captain_id)
        values ('${LEGACY_TEAM}', 'Legacy Team', '${LEGACY_MEMBER}');
      insert into public.members (id, team_id, name, email)
        values ('${LEGACY_MEMBER}', '${LEGACY_TEAM}', 'Legacy Captain', 'legacy@test.invalid');
      insert into public.wallets (team_id, balance) values ('${LEGACY_TEAM}', 100);
    `)

    const before = await db.query(`select public.current_team_id() as team`)
    await asUser(db, LEGACY_AUTH, 'captain')
    const before2 = await db.query(`select public.current_team_id() as team`)
    assert(before2.rows[0].team === null, 'the broken chain already resolved')
    void before

    const res = await db.query(`select public.align_identities() as r`)
    assert(res.rows[0].r.teams_realigned === 1, 'the team was not realigned')
    assert(res.rows[0].r.members_realigned === 1, 'the member was not realigned')

    const member = await db.query(`select id from public.members where team_id = $1`, [LEGACY_TEAM])
    assert(member.rows[0].id === LEGACY_AUTH, `member id is ${member.rows[0].id}`)
    const team = await db.query(`select captain_id from public.teams where id = $1`, [LEGACY_TEAM])
    assert(team.rows[0].captain_id === LEGACY_AUTH, `captain id is ${team.rows[0].captain_id}`)
    return 'auth.users.id == members.id == teams.captain_id'
  })

  await check('the realigned captain can bid', async () => {
    const slot = await slotFor('Smart Attendance and Timetable')
    await asUser(db, JUDGE, 'admin')
    await db.query(`select public.open_slot($1)`, [slot])
    await asUser(db, LEGACY_AUTH, 'captain')
    const res = await db.query(`select public.place_bid($1, 10) as r`, [slot])
    assert(res.rows[0].r.success === true, `the realigned captain could not bid: ${JSON.stringify(res.rows[0].r)}`)
    return `bid accepted for team ${res.rows[0].r.team_id}`
  })

  await check('the realigned captain resolves their own team', async () => {
    await asUser(db, LEGACY_AUTH, 'captain')
    const res = await db.query(`select public.current_team_id() as team`)
    assert(res.rows[0].team === LEGACY_TEAM, `current_team_id() returned ${res.rows[0].team}`)
    return ''
  })

  // ───────────────────────────────────────────────────────────────────────
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
