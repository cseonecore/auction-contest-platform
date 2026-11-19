# Bid2Build — Auction Module Implementation Audit

**Repository:** `D:\auction-contest-platform` (`cseonecore/auction-contest-platform`)
**Deployment:** https://bid2build-cse.vercel.app/
**Audit date:** 2026-11-17
**Auditor:** Auction module implementation pass (Anush + shared backend/integration)
**Live Supabase project:** `qqbuauryvhgssmmxiiuh` (`bid2build`, org `lahebcfxwmubieuxjjmq`)

> This audit was produced by direct inspection of the repository **and by live, read-only
> probing of the deployed Supabase project** (PostgREST schema/function probes). No
> production data was modified during the audit.

---

## 1. Executive summary

The repository contains a **partially working** auction system. The SQL layer is in the
best shape (a correctly row-locked `place_bid` RPC exists), but **the application layer
bypasses it**, and several production-blocking defects exist in the API routes, the
frontend, and the deployed database state.

| Area | Status | Severity |
|---|---|---|
| SQL schema & RPCs (001–009) | Mostly sound, `place_bid` concurrency-safe | — |
| `/api/auction/admin` | **No authentication. Anonymous users can run the entire auction.** | **Critical** |
| `/api/auction/bid` | **Client-supplied `teamId` ⇒ team impersonation** | **Critical** |
| Participant bid path | Bypasses the safe RPC ⇒ **highest bid can regress** under concurrency | **Critical** |
| Login (`/api/login`) | **Returns 409 for every user** on the deployed project | **Critical** |
| Submissions (`/api/submission`) | **Always fails** (missing column + NOT NULL violation) | **Critical** |
| Timer | Single `end_time` column. No pause/resume, no bonus engine | High |
| Elimination | **Does not exist** | High |
| Points accounting | Balance mutated in place; no ledger ⇒ not explainable | High |
| Projector | **Does not exist** | High |
| Frontend module | Two parallel generations + two timer implementations | High |
| Settings | Admin UI edits them, **the engine ignores them** (hardcoded 10/10/5) | High |
| Tests | One manual SQL script; no test runner | Medium |
| Docs | `docs/` did not exist | Medium |
| Build | `npm run build` ✅ passes | — |

### Live database state (verified 2026-11-17)

```
Schema applied  : migrations 001–009                    ✅
Migration 010   : NOT applied (active_sessions + check_session_active/mark_session_active RPCs missing → PGRST202)
Migration 008   : seed not present
Row counts      : teams 0 · members 0 · topics 0 · slots 0 · bids 0 · wallets 0 · settings 0
RLS writes      : 42501 for anon on teams/bids/settings/wallets/submissions   ✅ (RLS enabled and effective)
```

Consequences: the live auction has **no topics and no auction items to sell**, and
**no team can log in** (see P0-5).

---

## 2. Existing functionality (reuse inventory)

### 2.1 Database — `supabase/migrations/`

| Migration | Object | Disposition |
|---|---|---|
| 001 | `settings, teams, members, topics, slots, wallets, bids` | **Reuse.** `slots.status ∈ (pending,open,sold,skipped)` is the auction-item state machine. |
| 002 | `challenge_problems, challenge_solves, submissions, evaluations, eval_updates, audit_log` | **Reuse.** `audit_log` is the audit sink. |
| 003 | `enable row level security` on all tables | **Reuse.** |
| 004 | `current_team_id()`, `is_team_captain()`, `is_admin()` + all RLS policies | **Reuse.** `is_admin()` reads `auth.jwt()->app_metadata->role`. |
| 005 | original `place_bid` | Superseded by 007/009. |
| 006 | unified 100-point `wallets` (per team, not per round) | **Reuse.** |
| 007 | `place_bid` (Rule Book model), `open_slot`, `close_slot`, `skip_slot` | **Reuse + extend.** `close_slot` is the only wallet deduction point. |
| 008 | seed: 20 topics, **2 slots per topic (40 items)**, 6 settings | **Reconcile** → 1 slot per topic (20 items), idempotently, without deleting sold/bid data. |
| 009 | `slots.min_bid`, `open_slot(uuid,int)`, settings-driven `place_bid` floor, `reset_auction()`, `create_auction_topic()`, `slots_single_open_idx` (≤1 open slot), `topics_title_lower_idx` | **Reuse.** |
| 009 (b) | public read policies for `settings, teams, topics, slots, bids` | **Reuse.** |
| 010 | `active_sessions` + session RPCs | **Not applied to production.** Must be applied (it gates login). |

### 2.2 Backend functions (live)

`place_bid(uuid,int)`, `open_slot(uuid,int)`, `close_slot(uuid)`, `skip_slot(uuid)`,
`reset_auction()`, `create_auction_topic(...)`, `current_team_id()`, `is_team_captain()`,
`is_admin()`.

**`place_bid` (009) is the strongest asset in the repository.** It already:
locks the slot row (`SELECT … FOR UPDATE`), locks the wallet row, resolves the caller
from `auth.uid()` → `teams.captain_id`, enforces min-bid / min-raise, one-win-per-round,
sufficient balance, slot-open and `end_time > clock_timestamp()`, and extends `end_time`
by the per-bid timer increment. **This is the concurrency guarantee the specification
demands and it must be preserved and used.**

### 2.3 Frontend

| Path | Role | Disposition |
|---|---|---|
| `app/app/auction/page.tsx` → `ParticipantAuctionRoom` | Participant arena | **Consolidate** into one auction module. |
| `app/app/admin/auction/page.tsx` → `AdminAuctionRoom` (Figma arena) + `?view=console` (tabbed console) | Two admin surfaces | **Consolidate** onto one RPC-backed control panel. |
| `app/features/admin/{hooks,services,types}` | `useAdminAuction`, `auctionAdminService`, `settingsService` | **Reuse** — correctly calls RPCs through the authenticated browser client. |
| `app/features/auction/components/{AuctionRoom,BidControls,WalletBalance,SlotQueue}` + `hooks/{useSlot,useBids,useWallet,useAuctionState,useAuctionLeaderboard,useAuctionResults}` | Older parallel generation | **Remove** (unreferenced by routes; `index.ts` re-exports them). |
| `app/lib/auctionStore.ts` | Full in-memory fake auction (20 teams, 40 slots) | **Remove.** Currently unreferenced but is a landmine. |
| `app/features/auction/utils/placeBid.ts` | Correct RPC-based bid client | **Adopt** (currently unused by the participant room). |
| `app/features/auction/utils/countdown.ts` | Server-anchored countdown math | **Reuse.** |
| `app/features/admin/components/auction/*` | Queue table, bid feed, allocations, modals | **Reuse.** |

### 2.4 Brand system

`Branding-Visual design/` contains the authoritative Participant/Admin auction mockups.
Tokens are already defined in `app/app/globals.css`:

```
--background #0d0d0d   --foreground #ededed
--b2b-orange #fe5102   --b2b-orange-hover #e54700   --b2b-peach #fbcfb5
```

Surface palette in use: page `#111215`, panel `#1a1b1f`/`#1c1d22`, control `#33353b`,
amber timer card `#fef3c7`/`#78350f`, mascot capsule ring colours for the leaderboard.
Assets: `public/logos/*`, `public/characters/Character-01..10.png`.
**These are the tokens the projector and the consolidated auction UI will use — no new
palette is introduced.**

---

## 3. Missing functionality (specification vs repository)

| Spec requirement | Repository state | Action |
|---|---|---|
| Auction session entity + explicit state machine | Only `slots.status` (4 states) | Add `auction_sessions` with the 10-state machine |
| Server-authoritative timer with pause/resume | Only `slots.end_time` | Add timer columns + `pause/resume/adjust` RPCs |
| Bonus-time engine (judge approval → timer extension) | **Absent** | Add `bonus_transactions` + `grant_bonus_time()` |
| Elimination system (no-bid / no-selection / manual) | **Absent** | Add `team_eliminations` + `eliminate_team()` / `restore_team()` |
| Points ledger (every change explainable) | **Absent** — `wallets.balance` mutated in place | Add append-only `wallet_transactions` |
| Projector route `/projector/auction` | **Absent** | Build |
| Normalized realtime event contract | Ad-hoc `postgres_changes` on 4 tables + 2 s polling | Add `auction_events` + triggers |
| Settings-driven engine | `min_bid`/`min_raise`/`timer_extension`/`opening_window` **hardcoded in SQL** | Read from `settings` |
| Judge role | Only `admin` / `captain` | Add `is_judge()` |
| Automated tests | Manual SQL script only | Vitest + extended SQL suite + Playwright |
| Documentation | `docs/` absent | 7 documents |

---

## 4. Broken functionality (defects)

### P0-1 · `/api/auction/admin` performs no authentication or authorization
`app/app/api/auction/admin/route.ts` accepts an unauthenticated `POST` and executes
`open_slot`, `close_slot`, `skip_slot`, `next_slot`, `pause_auction`, `resume_auction`,
`extend_timer`, `reset_auction`. The handler uses the service-role client
(`lib/serverDb.ts`), which **bypasses RLS entirely**, and never calls `is_admin()`.
An anonymous internet request can therefore reset the auction, mutate wallets and award
questions.

### P0-2 · The service-role client makes every admin RPC fail, so the *unsafe* fallback always runs
`is_admin()` is `coalesce((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)`.
A service-role request carries no user JWT, so `auth.jwt()` is `NULL` and
`is_admin()` is always `false`. Every `db.rpc('open_slot'|'close_slot'|…)` in the admin
route therefore raises *"Admin access required"*, and the handler falls through to its
raw-update branches. One of those branches is:

```ts
await db.from("wallets").update({ balance: db.rpc("greatest", { a: 0, b: db.rpc("coalesce", …) }) })
//  ^ writes a JS object into an integer column
```

followed by an unlocked read-modify-write on the wallet — a corruption and
double-deduction path.

### P0-3 · Team impersonation through `/api/auction/bid`
The handler reads `teamId` from the request body and writes the bid under that team.
No session, no membership check, service-role client ⇒ any caller may bid as any team
and drain another team's allowance.

### P0-4 · The participant UI bypasses the row-locked RPC
`ParticipantAuctionRoom.handlePlaceBid` posts to `/api/auction/bid`, which performs a
bare `INSERT` into `bids` and an unlocked `UPDATE slots SET current_bid = …`. Two
concurrent bids can both pass the "minimum next bid" check, and the later `UPDATE`
can **lower** `current_bid` — the specification explicitly forbids a regressing highest
bid. The safe `place_bid` RPC (`utils/placeBid.ts`) is never called.

### P0-5 · Login is broken on the deployed project
`api/login/route.ts` calls `supabase.rpc("check_session_active")`. Migration 010 is not
applied to production, so PostgREST answers `PGRST202` (function not found).
`supabase.rpc()` **resolves** with `{ data: null, error }` and does not throw, so the
`try/catch` never fires, `sessionCheckBoolean` becomes `false`, and **every login returns
HTTP 409 "This account is already logged in on another device."** Verified against the
live project.

### P0-6 · Login fetched the team without a filter
`api/login/route.ts` ran `.from("teams").select(…).maybeSingle()` with **no
filter**, so as soon as a second team was registered the query returned
multiple rows and `maybeSingle()` raised — every login failed with a 500.
(The `members` query *was* correctly filtered by `team_id`; the team query was
not.)

### P0-7 · Submissions can never be recorded
`POST /api/submission` inserts `live_url`, but `submissions` has no `live_url` column
(`42703` confirmed live), and `submissions.slot_id` is `NOT NULL` with no default and is
never supplied ⇒ every insert fails even with service-role privileges.

### P0-8 · Pause/resume are no-ops
`pause_auction` writes `settings.auction_status = 'PAUSED'`. Nothing reads that key:
`/api/auction/state` derives status purely from slot statuses, and `place_bid` never
checks it. The UI shows "PAUSED" while bidding continues normally.

### P0-9 · Placeholder/fake data in the production participant UI
`ParticipantAuctionRoom.tsx` contains a hardcoded preview team
(`"Team Alpha (Preview)"`, id `32254098-4572-472d-b75e-1dc51ebcb273`) used whenever
`localStorage` is empty or the profile fetch fails; `totalSlots = 40`;
`activeSlotIndex = 3`; `secondsLeft = 84`; `hasWonRound={false}` is passed to the
bidding panel. `app/lib/auctionStore.ts` is a complete in-memory fake auction.

### P0-10 · No timer engine and settings are ignored by the engine
The timer is a single `slots.end_time`. The per-bid increment is the literal `5`
(migration 009 line 167) and the opening window the literal `10` (line 77), so edits
made in the Admin Settings screen have **no effect** on the auction.

### P0-11 · No elimination system
No column, table, RPC or UI. `teams.locked` is the unrelated "admin team lock" feature.

### P0-12 · No projector
`/projector/auction` does not exist.

### P0-13 · Two auction implementations and two timer systems
`features/auction` contains both the current room (`ParticipantAuctionRoom`,
`ParticipantBiddingPanel`, `LiveLeaderboardGrid`) and an older generation
(`AuctionRoom`, `BidControls`, `WalletBalance`, `SlotQueue`, `useSlot`, `useBids`,
`useWallet`, `useAuctionState`, `useAuctionLeaderboard`, `useAuctionResults`).
`ParticipantAuctionRoom` and `AdminAuctionRoom` each embed their own `setInterval`
countdown while `useAuctionTimer` exists separately.

### P0-14 · No test runner
`package.json` has no `test` script and no test framework dependency. The only suite is
`supabase/test_auction_flow.sql`, executed by hand in the SQL Editor.

### P1-15 · Realtime may never fire; channels are ad-hoc
`postgres_changes` requires the table to be in the `supabase_realtime` publication —
unverifiable without SQL access, and silently inert if absent. The two-second polling
loops mask the failure while hammering the database. Five different channel names are
used across surfaces with no shared event contract.

### P1-16 · Service-role key silently changes behaviour
`api/team/profile/route.ts` and `api/login/route.ts` prefer `SUPABASE_SERVICE_ROLE_KEY`
over the publishable key. When it is present, RLS is bypassed and the only remaining
guard is an ad-hoc JavaScript membership check.

### P1-17 · No points ledger
Every balance mutation is an in-place `UPDATE wallets`. "Every points change must be
explainable" is unsatisfiable; there is no way to distinguish a win deduction from a
manual correction, and no idempotency key.

### P1-18 · Hidden test cases are readable by every authenticated user
`challenge_problems.test_cases` holds the hidden evaluation data, and the policy
*"Authenticated view problems"* grants `SELECT` on the whole row to every authenticated
participant.

### P0-19 · The identity chain was broken — no captain could ever bid
Registration inserted the captain's `members` row with a **random uuid** and
then pointed `teams.captain_id` at that row, so the chain the database relies
on was never established:

```
auth.users.id   !=   members.id   ==   teams.captain_id
```

Every identity-resolving function looks the caller up through `auth.uid()`:

* `current_team_id()` → `members.id = auth.uid()` → never matched → RLS could
  never resolve "my own team" (wallets, ledger, bids, submissions).
* `is_team_captain()` → never matched.
* `place_bid()` → `teams.captain_id = auth.uid()` → never matched → **every
  bid was rejected with "Only the team captain can place bids"**.

The `place_bid` RPC was therefore unreachable for every real user, and the
audit could not see it because the live database contains no teams yet.

---

## 5. Existing database contract

```
settings(key PK, value jsonb)
teams(id PK, name unique, captain_id → members.id, locked bool, created_at)
members(id PK, team_id → teams, name, email unique, college, created_at)
topics(id PK, level ∈ (easy,hard), title, description, criterion jsonb)
slots(id PK, topic_id → topics, round ∈ (1,2), status ∈ (pending,open,sold,skipped),
      current_bid int, min_bid int, leader_team_id → teams, end_time, winner_team_id → teams)
wallets(team_id PK → teams, balance int CHECK balance ≥ 0, created_at)
bids(id PK, slot_id → slots, team_id → teams, amount int, server_time)
challenge_problems(id, topic_id, title, description, difficulty, test_cases jsonb, points)
challenge_solves(id, team_id, problem_id, solved_at) UNIQUE(team_id,problem_id)
submissions(id, team_id, slot_id NOT NULL, repository_url, submitted_by, submitted_at,
            status ∈ (submitted,evaluating,evaluated,review))
evaluations(id, submission_id UNIQUE, score, report, evaluator_version, evaluated_at, status)
eval_updates(id, evaluation_id, message, details, created_at)
audit_log(id, actor_id, actor_team_id, action, entity_type, entity_id, details jsonb, created_at)
```

Identity model: `auth.users.id == members.id == teams.captain_id`. `current_team_id()`
maps the JWT subject to a team. Authorization: `app_metadata.role ∈ {admin, captain}`,
`is_admin()` requires `app_metadata.role = 'admin'`.

---

## 6. Frontend architecture (as found)

```
app/app/auction/page.tsx
└── features/auction/components/ParticipantAuctionRoom.tsx   ← participant arena
    ├── localStorage "b2b_logged_in_team" → /api/team/profile   (identity from localStorage, not the session)
    ├── /api/auction/state   (2 s heartbeat + postgres_changes)
    ├── /api/auction/teams   (leaderboard)
    ├── /api/auction/bid     (POST — client-supplied teamId)
    ├── inline setInterval countdown (250 ms)
    └── ParticipantBiddingPanel → BidConfirmationModal

app/app/admin/auction/page.tsx
├── AdminAuctionRoom        (Figma live arena; /api/auction/admin; inline countdown; 2 s poll)
└── ?view=console → AdminAuctionInner (tabs: overview/queue/controller/feed/allocations)
    └── useAdminAuction → auctionAdminService → supabase.rpc(open_slot|close_slot|skip_slot|reset_auction|create_auction_topic)
```

Service-layer boundary is inconsistent: the admin console calls RPCs directly from the
browser (correct, RLS applies), while the participant arena and the admin arena call
Next.js API routes that use the service-role client (incorrect).

---

## 7. Integration requirements

| Module | Owner | Required change |
|---|---|---|
| Registration | Abhiram | **None.** `captain_id` already equals `members.id`; wallets are still created at 100 points. |
| Submission | Akash N | `submissions.slot_id` must be resolved from the team's won slots; `live_url` column added; **must not** award bonus directly — call `grant_bonus_time()`. |
| Admin | Darshan R | Stop using raw `/api/auction/admin` actions; use the RPC-backed control panel. |
| Projector | Shared | New read-only route on the shared event stream. |
| Scoring | Shared | Auction budget stays separate from competition score; bonus-time is an auction-side award. |

---

## 8. Security concerns (ranked)

1. **Unauthenticated auction control** (P0-1) — total compromise of the contest.
2. **Team impersonation** (P0-3).
3. **Bid race / state corruption** (P0-4) — financial integrity of the auction.
4. **Privilege escalation via service-role RPC failure fallbacks** (P0-2).
5. **Hidden test-case disclosure** (P1-18) — participants can read the answers.
6. **Wallet corruption via the `greatest()` write** (P0-2).
7. **Service-role credential preference in user-facing routes** (P1-16).
8. **Audit trail gaps** — bids are not logged; admin raw updates bypass `audit_log` entirely.

---

## 9. Implementation plan (approved)

Governing decisions:
* **Rule Book §5.1 preserved** — losing bids cost nothing; the winning amount is deducted
  exactly once during transactional finalisation. An append-only `wallet_transactions`
  ledger records every balance change. No reserved/spend split, no participant-visible
  holds.
* **One slot per topic** — 20 auction items; sold-once enforced per topic in the database.
* **Migrations are incremental and idempotent**; the 40-slot seed is reconciled without
  deleting or overwriting historical auction data.
* **Authorization is enforced inside PostgreSQL functions**, not only in API routes.

| Phase | Deliverable |
|---|---|
| A | This audit + existing-schema verification script |
| B | Architecture & contract documents |
| C | Migrations `011`–`018` |
| D | API hardening (remove service-role fallbacks, fix impersonation, fix login, fix submissions) |
| E | Consolidated auction frontend (one module, one timer, RPC-only services) |
| F | Admin auction control + settings + bonus + elimination |
| G | Submission & bonus integration |
| H | Projector `/projector/auction` |
| I | Tests (Vitest, SQL suite, Playwright) + docs + build |

**Safety rules honoured:** no reset of the Supabase project, no destructive SQL in the
migration set, no historical migration rewritten, no service-role credential in the
repository, no production execution or deployment without explicit approval.

---

## 10. Resolution status

The implementation pass that followed this audit resolved every defect above.
The table records what was done; the verification lives in
`docs/auction-testing-report.md`.

| Finding | Resolution |
|---|---|
| P0-1 · unauthenticated admin API | `api/auction/admin` now requires a session with `app_metadata.role ∈ {admin, judge}` and delegates every action to an engine function; **all raw-update fallbacks were deleted** |
| P0-2 · service-role fallbacks always ran | the fallbacks are gone; the route only ever calls RPCs |
| P0-3 · team impersonation | `api/auction/bid` no longer accepts a team id; `place_bid()` resolves the team from `auth.uid()` |
| P0-4 · bid race | the participant arena calls the row-locked `place_bid()` RPC; the unlocked direct insert/update path was deleted |
| P0-5 · login broken (409 for everyone) | the single-device check now degrades gracefully when migration 010 is missing; **migration 010 is included in the runbook** |
| P0-6 · unfiltered team lookup | the team is now fetched with `.eq("captain_id", authUserId)` |
| P0-7 · submissions always failed | `live_url` added, `slot_id` is resolved from the team's won items and validated server-side, the team comes from the session |
| P0-8 · pause was a no-op | `pause_auction()` / `resume_auction()` now freeze and rebuild the deadline, and `place_bid()` rejects bids while paused |
| P0-9 · fake data in the UI | the preview team, the `40`/`3` placeholders, the `84`-second fallback and `hasWonRound={false}` are gone; `app/lib/auctionStore.ts` was deleted |
| P0-10 · no timer engine | two authoritative clocks with pause/resume/extend, all driven by the settings table |
| P0-11 · no elimination | `team_eliminations` + `eliminate_team()` / `restore_team()`, enforced in `place_bid()` and `grant_bonus_time()` |
| P0-12 · no projector | `/projector/auction` — read-only, public data only |
| P0-13 · two implementations | the parallel generation was deleted; one module, one timer, one event stream |
| P0-14 · no test runner | `npm run test` (Vitest), `npm run test:sql` (migrations against a real engine), `npm run test:engine` (53 scenarios) |
| P0-15 · realtime maybe inert | the publication is fixed by migration 018 and verified by SQL |
| P0-16 · service-role in user-facing routes | removed from every auction, login and profile route |
| P0-17 · no points ledger | `wallet_transactions` — append-only, exactly-once deduction enforced by a partial unique index |
| P0-18 · question sold twice | one item per topic and a sold-once index, both enforced by the database |
| P1-18 · hidden test cases readable | column-level `revoke select` on `challenge_problems.test_cases` |
| P0-19 · broken identity chain | registration now inserts the captain with `id = authUserId`; `align_identities()` repairs existing rows and logs the repair |
