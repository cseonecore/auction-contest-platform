# Auction Testing Report

Every number in this document comes from a command that was actually executed
in this repository. Nothing is projected or assumed.

---

## 1. How the tests run

| Suite | Command | What it executes |
|---|---|---|
| Frontend unit | `npm run test` | Vitest against the pure auction logic (countdown maths, bid rules) |
| Migration validation | `npm run test:sql` | Applies the **real** migration chain 001→020 to an embedded PostgreSQL (PGlite — official Postgres compiled to WebAssembly) and asserts the resulting schema |
| Engine behaviour | `npm run test:engine` | Applies the same chain, seeds three teams, and then drives the **real** `SECURITY DEFINER` functions with a simulated authenticated caller (`auth.uid()` / `auth.jwt()`) |
| Bugfix regression | `npm run test:bugfixes` | Restart, four-team bidding, previous-leader re-eligibility, pause/resume, event stream, wallet and identity scenarios |
| Types | `npx tsc --noEmit` | The whole application |
| Lint | `npm run lint` | ESLint (Next.js + react-hooks rules) |
| Build | `npm run build` | The production bundle |

```bash
npm run test:all      # unit + migrations + engine + bugfixes
```

> **Why PGlite?** The migrations are executed by a real PostgreSQL engine, so
> plpgsql bodies, triggers, constraints, RLS and index semantics are genuinely
> tested — not mocked. The only concession is that `create extension pgcrypto`
> is stripped, because PGlite does not bundle it; `gen_random_uuid()` has been
> core PostgreSQL since v13, so nothing depends on the extension.

---

## 2. Results

### 2.1 Frontend unit — `npm run test`

```
 ✓ tests/bid-validation.test.ts (13 tests)
 ✓ tests/timer-utils.test.ts  (6 tests)

 Test Files  2 passed (2)
      Tests  19 passed (19)
```

| Area | Assertions |
|---|---|
| Countdown | remaining seconds, expiry, missing deadline, urgent/critical windows, a device clock 60 s behind, a device clock 30 s ahead |
| Bid rules | minimum opening bid, minimum raise, non-captain blocked, eliminated team blocked, paused auction blocked, leading team blocked, one-win-per-round blocked, insufficient balance blocked, closed item blocked |
| Advisory context | an expired client countdown or missing session never blocks an item the backend still has open |

### 2.2 Migration validation — `npm run test:sql`

```
  PASS  001_initial_schema.sql
  PASS  002_add_remaining_tables.sql
  PASS  003_enable_rls.sql
  PASS  004_rls_policies.sql
  PASS  005_place_bid.sql
  PASS  006_fix_wallet_schema.sql
  PASS  007_auction_functions.sql
  PASS  008_auction_seed_data.sql
  PASS  009_admin_auction_features.sql
  PASS  009_auction_public_reads.sql
  PASS  010_single_device_sessions.sql
  PASS  011_auction_core.sql
  PASS  012_wallet_ledger.sql
  PASS  013_elimination.sql
  PASS  014_bonus_time.sql
  PASS  015_auction_engine.sql
  PASS  016_auction_events.sql
  PASS  017_read_functions.sql
  PASS  018_rls_hardening.sql
  PASS  019_session_event_stream.sql
  PASS  020_session_active_slot_sync.sql

  PASS  20 topics seeded
  PASS  exactly one active auction item per topic
  PASS  auction items equal the number of topics (20)
  PASS  settings present
  PASS  new RPCs are callable (36)
  PASS  RLS enabled on every auction table
  PASS  no auction table is left without RLS
  PASS  sold-once unique index exists
  PASS  win-deduction once index exists

All migrations applied cleanly and every post-migration check passed.

Consolidated runbook (docs/supabase-migration-runbook.sql):
  PASS  the runbook applies as a single batch on top of 001-009
        topics=20 slots=20 functions=53
```

### 2.3 Engine behaviour — `npm run test:engine`

```
TOTAL: 53 scenarios, 53 passed, 0 failed
```

<details>
<summary>Full scenario list</summary>

**1 · Session lifecycle**
- non-admin cannot start the auction
- admin starts the auction session
- starting twice is idempotent

**2 · Question selection and opening bidding**
- the opening window comes from settings (not hardcoded) — `opening_window_seconds = 25` honoured
- admin selects a question
- non-admin cannot select a question
- admin opens bidding with the configured window
- a second item cannot be opened while one is open

**3 · Bidding rules**
- an unauthenticated caller cannot bid
- a non-captain member cannot bid
- a bid below the minimum is rejected
- a valid opening bid is accepted
- a raise below the minimum increment is rejected
- the leading team cannot bid against itself
- a valid raise is accepted and extends the clock (+5 s)
- a losing bid does not change the balance (Rule Book §5.1)
- a bid above the available balance is rejected
- a bid on a closed item is rejected
- a late bid (after the deadline) is rejected
- `place_bid` locks the item row (FOR UPDATE)
- the highest bid can never regress

**4 · Pause / resume / timer**
- pausing preserves the remaining time
- a paused auction rejects bids
- resuming restores the preserved remaining time
- the admin can extend the authoritative solving clock
- the admin can extend the bidding deadline of an open item
- a non-admin cannot adjust the clock

**5 · Elimination**
- a non-admin cannot eliminate a team
- the admin eliminates a team and the reason is recorded
- an eliminated team cannot bid
- the admin restores the team and bidding works again

**6 · Finalisation, points and the ledger**
- a non-admin cannot close an item
- closing deducts the winning amount exactly once
- finalising twice is rejected (no double charge)
- the losing teams were not charged
- the ledger explains every balance change
- a problem statement can only be sold once

**7 · Submission, approval and bonus time**
- a submission is recorded against the assigned question
- a submission for a question the team does not own is rejected
- bonus cannot be awarded before approval
- a participant cannot award a bonus
- an approved solution extends the authoritative clock
- the same solution cannot award the bonus twice
- the bonus is recorded in the bonus ledger

**8 · Live state and events**
- the live state exposes the authoritative picture
- every event type is recorded in the event stream
- the event payloads never contain private data
- a team can only read its own bid history

**9 · Reset**
- the admin reset restores wallets and clears bids
- a non-admin cannot reset the auction

**10 · Identity chain**
- a legacy team with a mismatched member id is realigned
- the realigned captain can bid
- the realigned captain resolves their own team

</details>

### 2.4 Bugfix regression — `npm run test:bugfixes`

```
TOTAL: 36 scenarios, 36 passed, 0 failed
```

The suite covers the three launch-blocking defects end to end against the
real SQL engine:

**1 · Session restart (Bug 1)**
- `start_auction` emits exactly one `session_started` event
- anonymous participants can read the active session (page gate)
- pause/resume emit `auction_paused` / `auction_resumed`
- stop emits `session_ended` and `get_active_session()` becomes empty
- restart creates a **new** session id, reopens the gate and emits a second
  `session_started` — no re-login or manual database edit

**2 · Bidding after a restart (Bug 3)**
- opening bidding publishes the item with a settings-driven 10 s window
- opening bid 10, every accepted raise is at least +10 over the leader
- the leader cannot outbid itself; an overtaken team can bid again
- a raise below the minimum increment is rejected
- a valid raise extends the deadline by exactly 5 s
- a bid above the wallet is rejected; losing bids cost nothing
- closing debits the winner exactly once; one win per round is enforced
- every bid and leader change reaches the event stream

**3 · Round 2, wallet caps and reset**
- stop → start again creates a round-2 session
- the round-1 winner can bid again in round 2
- affordable raises pass, unaffordable raises fail even when above the minimum
- reset restores wallets, clears bids and emits `auction_reset`

**4 · Identity and single-device sessions (Bug 2)**
- an aligned captain resolves their team and bids
- an unauthenticated caller cannot bid
- `mark_session_active` upserts instead of locking an account out
- `invalidate_current_session` clears the device record

**5 · Four-team rotation and pause/resume (Bug 2 + Bug 3)**
- reset clears every winner, so all four teams are eligible again
- `start → open bidding` links the live item to the session, exposes
  `min_next_bid = 10` and a running authoritative timer
- four captains trade 10 → 20 → 30 → 40
- two previously overtaken teams bid again (50, 60)
- only the current leader is blocked
- a valid raise restarts the clock with +5 s
- pause freezes the item clock and rejects bids; resume restores the clock
  and accepts the next bid
- an item with a NULL `active_slot_id` (opened before migration 020) still
  freezes and restores through the fallback path
- the live read contract exposes current bid 80, next bid 90 and four bidders
- the event stream contains 8 `bid_placed` and 8 `highest_bid_changed` events
- closing debits only the winner, once

### 2.5 Types, lint and build

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | pre-existing debt only: 1 error (`prefer-const` in `app/api/login/route.ts`) and warnings in untouched registration/admin files — none introduced by this fix |
| `npm run build` | **✓ Compiled successfully** — all routes generated, including `/projector/auction` |

---

## 3. Root causes and changes

### 3.1 Bug 1 — participants could not rejoin after Stop → Start

**Root cause.** Stopping a session sets it to `completed`, and
`get_active_session()` correctly excludes completed/cancelled rows. The restart
itself creates a new session, but the session state machine emitted **no
realtime events**: `session_started`, `session_ended`, `auction_paused`,
`auction_resumed` and `auction_reset` were silent. A client that was already on
the auction page therefore had no event to trigger its authoritative re-read.
The participant page has no session gate, so access recovers as soon as the
client re-reads the state (realtime, 15 s poll, focus or a manual refresh).

**Change.** Migration `019_session_event_stream.sql` (committed earlier) adds
the session trigger that publishes those five events through the existing
`emit_auction_event()` function.

**Verified.** `test:bugfixes` group 1: stop closes the gate, restart creates a
**new** session id, reopens the gate for an anonymous reader, and emits a second
`session_started`.

### 3.2 Bug 2 — opening a slot did not enable valid bidding / broke pause

**Root cause.** The admin **Open Slot** button calls
`open_bidding(slot_id)` directly. `open_slot()` stored the link on the slot
(`slots.session_id`) but never wrote `auction_sessions.active_slot_id`, because
only `select_auction_question()` used to set it. With a NULL pointer:

* `pause_auction()` found no live item and did **not** freeze its countdown;
* `resume_auction()` found no item and did **not** restore it;
* a pause could therefore run the item past its deadline, after which every bid
  was rejected as expired.

The client panel was already correct (opening bid = `min_bid` = 10, next bid =
leader + `min_raise` = +10, disabled for the leader / eliminated / non-captain /
unaffordable / paused / non-open item).

**Change.** Migration `020_session_active_slot_sync.sql` replaces four
functions without changing any signature:

* `open_slot()` records `active_slot_id` on its session;
* `open_bidding()` records it too (defence in depth and repair for items opened
  by an older client);
* `pause_auction()` / `resume_auction()` fall back to the single `status='open'`
  item when the pointer is still NULL, so already-open production items pause
  correctly.

No table, column, policy, grant or RPC signature changed.

**Verified.** `test:bugfixes` group 5: four captains bid 10 → 20 → 30 → 40,
overtaken teams bid again, only the leader is blocked, +5 s per raise, pause
freezes 45 s of clock and rejects a bid, resume restores it and accepts the bid,
and the live state reports current 80 / next 90.

### 3.3 Bug 3 — realtime bidding did not stay in sync

**Root cause.** The database triggers already published `bid_placed`,
`highest_bid_changed`, timer and wallet events, and the client re-read
`get_live_auction_state()` on every event, on reconnect, every 15 s while
visible and on focus. The missing lifecycle events (3.1) and the broken pause
clock (3.2) were the paths that could leave two clients disagreeing.

**Change.** No new state management. The existing single-source contract
(`auction_events` + `get_live_auction_state()`) was kept; 019 and 020 close the
gaps.

**Verified.** `test:bugfixes` group 5 proves the read contract and event stream:
8 accepted bids produce 8 `bid_placed`, 8 `highest_bid_changed` and 4 distinct
teams; the live state reports the same current bid / leader / next bid that
`place_bid()` returned.

### 3.4 Files changed by this pass

| File | Change |
|---|---|
| `supabase/migrations/020_session_active_slot_sync.sql` | **New** — replaces `open_slot`, `open_bidding`, `pause_auction`, `resume_auction` |
| `app/scripts/test-bugfixes.mjs` | Four-team fixture and 12 new scenarios (36 total) |
| `docs/supabase-migration-runbook.sql` | Appends migrations 019 and 020 for a single production run |
| `docs/auction-migration-runbook.md` | Documents the two new migration rows |
| `docs/auction-testing-report.md` | This report, refreshed with the current results |

### 3.5 Live project status

A read-only probe of the configured Supabase project on 2026-11-18 showed:

* the auction schema and event stream exist (`get_live_auction_state()` 200,
  40 historical events, settings include `timer_extension_seconds = 5`);
* **no** `session_started` / `session_ended` / `auction_paused` /
  `auction_resumed` events — migration **019 is not applied there yet**, and
  migration **020 is new**;
* therefore the fixes are verified locally against real PostgreSQL, but the
  production database must run `docs/supabase-migration-runbook.sql`
  (010→020) before the contest.

Runtime smoke tests against the live project (dev server, no data written):

* realtime channel subscription to `public.auction_events` → `SUBSCRIBED`
  (publication and read policy work);
* `GET /api/auction/state` → 200 with the authoritative settings;
* `/auction`, `/admin/auction`, `/projector/auction` → 200, no error overlay.

---

## 4. Specification coverage

| # | Scenario | Where it is proven |
|---|---|---|
| 1 | Valid bid | engine §3 |
| 2 | Invalid bid | engine §3 |
| 3 | Minimum bid | engine §3, unit |
| 4 | Minimum raise | engine §3, unit |
| 5 | Insufficient points | engine §3 |
| 6 | Eliminated team bid | engine §5 |
| 7 | Closed auction bid | engine §3 |
| 8 | Late bid | engine §3 |
| 9 | Concurrent bids | engine §3 (`FOR UPDATE` present + the highest bid cannot regress + the raise is re-evaluated against the locked row) |
| 10 | Outbid reservation release | n/a — Rule Book §5.1: losing bids are free, so there is nothing to release |
| 11 | Winning bid deduction | engine §6 |
| 12 | Duplicate finalisation | engine §6 |
| 13 | Duplicate bonus | engine §7 |
| 14 | Unauthorized bonus | engine §7 |
| 15 | Unauthorized timer adjustment | engine §4 |
| 16 | Unauthorized elimination | engine §5 |
| 17 | Question ownership conflict | engine §6 |
| 18 | Timer pause | engine §4 |
| 19 | Timer resume | engine §4 |
| 20 | Timer extension | engine §4 |
| 21 | Duplicate question assignment | engine §6 (a second item for a sold topic is rejected) |
| 22 | Team restoration authorisation | engine §5 (restore is admin-only; a participant cannot bid while eliminated) |
| — | Auction states | engine §1–2 |
| — | Loading state | `ParticipantAuctionRoom` renders a loader until the first read completes |
| — | Error state | error banner + **Retry** button in the arena, the admin arena and the projector |
| — | Bid validation | unit suite |
| — | Bid submission | engine §3 + the RPC-only service layer |
| — | Outbid notification | `highest_bid_changed` handling in the arena |
| — | Timer display | unit suite + engine §4 |
| — | Bonus notification | `bonus_time_granted` handling in the arena and the projector |
| — | Elimination screen | `EliminationNotice` block in the arena |
| — | Realtime updates | `useAuctionRealtime` + the event catalogue |
| — | Reconnect recovery | the client re-reads the state on every `SUBSCRIBED` |

---

## 5. Known gaps

These are **not** covered by an automated test yet and are listed honestly:

1. **True simultaneous requests.** PGlite is single-connection, so the engine
   suite proves the *mechanism* (row lock + re-evaluation of the minimum
   against the locked row + a monotonic `current_bid`) rather than firing two
   parallel HTTP requests. A production smoke test with two captains bidding
   at the same instant is still required before the event.
2. **Browser-level UI tests.** The unit suite covers the auction logic; there
   is no Playwright suite yet. The recommendation is to add one for the
   participant → admin → projector flow before the event.
3. **Multi-browser Realtime inserts.** The subscription handshake to
   `public.auction_events` succeeds against the live project, but a live INSERT
   was not observed because the production database has not had migrations
   019/020 applied and no admin action was performed. Event generation,
   payloads and RPC state are proven by the PGlite suites.
4. **Wallet deduction in the browser.** Debit amounts and exactly-once behaviour
   are proven in PostgreSQL; the visual balance refresh relies on the existing
   authoritative re-read and was not scripted in a browser.
5. **Migration 010** (`active_sessions`) is not applied to production; the
   login route now degrades gracefully when the single-device RPCs are absent,
   but the feature only works once the migration is applied.
6. **Automatic elimination sweeps** (the "no selection" / "no bid" rules) are
   recorded in the schema (`rule` column, `settings.elimination_enabled`) but
   the sweep itself is not automated — an admin triggers it. This is a
   deliberate, documented choice: the official contest rules for automatic
   elimination were not available, and guessing them would be unsafe.

---

## 6. Reproducing this report

```bash
cd app
npm install
npm run test:all      # 19 unit + migration validation + 53 engine + 36 bugfix scenarios
npx tsc --noEmit
npm run lint
npm run build
```

```bash
# Read-only live probes (uses the public anon key; writes nothing)
node scripts/probe-live-db.mjs
```
