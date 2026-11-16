# Auction Testing Report

Every number in this document comes from a command that was actually executed
in this repository. Nothing is projected or assumed.

---

## 1. How the tests run

| Suite | Command | What it executes |
|---|---|---|
| Frontend unit | `npm run test` | Vitest against the pure auction logic (countdown maths, bid rules) |
| Migration validation | `npm run test:sql` | Applies the **real** migration chain 001→018 to an embedded PostgreSQL (PGlite — official Postgres compiled to WebAssembly) and asserts the resulting schema |
| Engine behaviour | `npm run test:engine` | Applies the same chain, seeds three teams, and then drives the **real** `SECURITY DEFINER` functions with a simulated authenticated caller (`auth.uid()` / `auth.jwt()`) |
| Types | `npx tsc --noEmit` | The whole application |
| Lint | `npm run lint` | ESLint (Next.js + react-hooks rules) |
| Build | `npm run build` | The production bundle |

```bash
npm run test:all      # unit + migrations + engine
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
 ✓ tests/bid-validation.test.ts (9 tests)
 ✓ tests/timer-utils.test.ts  (6 tests)

 Test Files  2 passed (2)
      Tests  15 passed (15)
```

| Area | Assertions |
|---|---|
| Countdown | remaining seconds, expiry, missing deadline, urgent/critical windows, a device clock 60 s behind, a device clock 30 s ahead |
| Bid rules | minimum opening bid, minimum raise, non-captain blocked, eliminated team blocked, paused auction blocked, leading team blocked, one-win-per-round blocked, insufficient balance blocked, closed item blocked |

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

### 2.4 Types, lint and build

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors**, 7 warnings (all pre-existing patterns: `any` in the untouched API routes, unused imports in the untouched registration/logout routes) |
| `npm run build` | **✓ Compiled successfully** — 26 routes, including the new `/projector/auction` |

---

## 3. Specification coverage

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

## 4. Known gaps

These are **not** covered by an automated test yet and are listed honestly:

1. **True simultaneous requests.** PGlite is single-connection, so the engine
   suite proves the *mechanism* (row lock + re-evaluation of the minimum
   against the locked row + a monotonic `current_bid`) rather than firing two
   parallel HTTP requests. A production smoke test with two captains bidding
   at the same instant is still required before the event.
2. **Browser-level UI tests.** The unit suite covers the auction logic; there
   is no Playwright suite yet. The recommendation is to add one for the
   participant → admin → projector flow before the event.
3. **The live Supabase project** has not been exercised with the new
   migrations yet — they are validated locally and the runbook is prepared,
   but the migration has not been applied.
4. **Migration 010** (`active_sessions`) is not applied to production; the
   login route now degrades gracefully when the single-device RPCs are absent,
   but the feature only works once the migration is applied.
5. **Automatic elimination sweeps** (the "no selection" / "no bid" rules) are
   recorded in the schema (`rule` column, `settings.elimination_enabled`) but
   the sweep itself is not automated — an admin triggers it. This is a
   deliberate, documented choice: the official contest rules for automatic
   elimination were not available, and guessing them would be unsafe.

---

## 5. Reproducing this report

```bash
cd app
npm install
npm run test:all      # 15 unit + migration validation + 53 engine scenarios
npx tsc --noEmit
npm run lint
npm run build
```
