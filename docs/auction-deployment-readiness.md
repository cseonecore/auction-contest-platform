# Auction Deployment Readiness

Status of the Bid2Build auction module as of **2026-11-17**.

> **Nothing has been deployed and no production migration has been applied.**
> The application is prepared for deployment; the database still needs the
> migration runbook in `docs/auction-migration-runbook.md` to be executed.

---

## 1. Readiness summary

| Area | Status | Notes |
|---|---|---|
| Database schema | 🟡 **Ready to apply** | Migrations 010–018 validated against a real PostgreSQL engine; not yet applied to production |
| Seed data | 🟡 **Ready to apply** | 20 problem statements + exactly one auction item each; production currently has 0 rows |
| Bidding engine | 🟢 Ready | Row-locked, audited, settings-driven; 53 engine scenarios pass |
| Points accounting | 🟢 Ready | Append-only ledger, exactly-once deduction proven |
| Timer engine | 🟢 Ready | Two server-authoritative clocks, pause/resume/extend proven |
| Bonus time | 🟢 Ready | Idempotent award, proven |
| Elimination | 🟢 Ready | Enforced in the database, reversible, audited |
| Participant arena | 🟢 Ready | No placeholder data, live from the authoritative state |
| Admin console | 🟢 Ready | Session-authenticated, RPC-backed |
| Projector | 🟢 Ready | Read-only, public data only |
| Submission portal | 🟢 Ready | Bound to the assigned question |
| Realtime | 🟡 **Depends on the migration** | The publication is fixed by migration 018 — verify with the post-flight query |
| Login | 🔴 **Blocked on migration 010** | The single-device RPCs are missing in production; the route now degrades gracefully, but migration 010 must be applied |
| Registration | 🔴 **Needs `SUPABASE_SERVICE_ROLE_KEY`** | Required to create the Auth account and the team rows |
| Tests | 🟢 Ready | 15 unit + 53 engine scenarios + migration validation |
| Build | 🟢 Ready | `npm run build` succeeds; 26 routes |
| Documentation | 🟢 Ready | Seven documents in `docs/` |

---

## 2. Required environment variables

| Variable | Required | Used by | Status |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | everything | already configured |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | everything | already configured |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes for registration and submissions** | `api/register`, `api/submission` | **check on Vercel** |

### About the service-role key

* It **bypasses RLS**. It is used in exactly two places, both after the
  caller's ownership has been verified from their session:
  * `app/app/api/register/route.ts` — creating the Auth account and the
    team / member / wallet rows.
  * `app/app/api/submission/route.ts` — inserting the submission row.
* It is **never** used for auction state, bids, wallets, bonuses, eliminations
  or admin actions.
* It must **never** be exposed to the browser (`NEXT_PUBLIC_` prefix) and must
  never be committed. `.env.local` contains only the publishable key, and
  `.gitignore` excludes `.env*.local`.

---

## 3. Security status

| Control | Status |
|---|---|
| RLS enabled on every auction table | ✅ verified by the migration post-flight query and by the validation suite |
| `is_admin()` / `is_admin_or_judge()` enforced inside the functions | ✅ — 10 unauthorised-call scenarios pass |
| Participants cannot modify points | ✅ — write revoked on `wallets` and `wallet_transactions` |
| Participants cannot modify the auction status | ✅ — write revoked on `slots` and `bids` |
| Participants cannot award bonuses | ✅ — `grant_bonus_time()` rejects them |
| Participants cannot eliminate teams | ✅ — `eliminate_team()` rejects them |
| Team impersonation through the bid API | ✅ — the team is resolved from `auth.uid()` inside the function; the request body no longer carries a team id |
| Anonymous access to the admin API | ✅ — the route requires a session with `app_metadata.role ∈ {admin, judge}` |
| Hidden test cases readable by participants | ✅ — column-level `revoke select` on `challenge_problems.test_cases` |
| Service-role key used in a user-facing read path | ✅ — removed from `api/auction/*`, `api/login` and `api/team/profile` |
| Every state change audited | ✅ — 19 audited action types in `audit_log` |

### Residual risks

| Risk | Severity | Mitigation |
|---|---|---|
| The admin API trusts `app_metadata.role` from the JWT | low | `app_metadata` is server-controlled; only a Supabase admin can change it |
| The public auction state exposes every team's balance | low | by design — the leaderboard already shows it; it never exposes submissions, members' contact details or the audit trail |
| The service-role key is broad if leaked | high | rotate it, keep it server-only, and review the Vercel environment |
| `reset_auction()` clears the wallet ledger | medium | it is the only operation that does, it is admin-only, and it is recorded in `audit_log` |

---

## 4. Deployment steps

### Step 1 — back up

Supabase → *Database* → *Backups* → take a restore point before the migration.
Record it in `docs/auction-migration-runbook.md` §7.

### Step 2 — apply the migrations

Follow `docs/auction-migration-runbook.md`:

1. Run the **pre-flight** block and send the output back.
2. Run `docs/supabase-migration-runbook.sql` once, in the SQL Editor.
3. Run the **post-flight** block and check every expected value.
4. Run the **smoke test** block.

### Step 3 — configure the environment

Confirm `SUPABASE_SERVICE_ROLE_KEY` is set on Vercel (server-side only).

### Step 4 — deploy

```bash
cd app
npm run test:all
npm run build
```

Deploy through the normal Vercel flow. **Do not deploy before steps 1–3 have
been completed and verified.**

### Step 5 — post-deploy verification

```sql
-- the event stream is alive
select count(*) from public.auction_events;

-- the engine is callable by an admin
select public.get_live_auction_state();
```

Then, in the browser:

| Check | Expected |
|---|---|
| `/auction` | the arena loads, the header shows **Realtime Synced**, the leaderboard lists the registered teams |
| `/admin/auction` | the control panel loads, the session shows `NOT STARTED`, **Start auction** works |
| `/projector/auction` | the auditorium display shows the question panel and the team board |
| Two captains bid in the same second | one bid is accepted, the other is rejected with "Bid too low", the highest bid never decreases |
| A judge approves a solution | the solving clock grows by `bonus_time_seconds` on the arena and the projector |

---

## 5. Known issues and follow-ups

| # | Issue | Severity | Owner |
|---|---|---|---|
| 1 | Production has migration 010 missing — the single-device session guard is inactive until it is applied | **high** | shared (runbook step 2) |
| 2 | Production has no seed data — 0 topics, 0 auction items, 0 settings until the migration runs | **high** | shared (runbook step 2) |
| 3 | The automatic elimination sweep ("no selection" / "no bid" rules) is not automated; an admin triggers it | medium | product decision — the official rules were not available |
| 4 | No browser-level (Playwright) UI test yet | medium | shared, before the event |
| 5 | True multi-connection concurrency is not exercised in CI | medium | shared — do a two-captain smoke test before the event |
| 6 | The tabbed admin console (`/admin/auction?view=console`) still uses the older service layer | low | Darshan R — the RPCs are unchanged, so it still works |
| 7 | The registration flow needs `SUPABASE_SERVICE_ROLE_KEY` on Vercel | low | shared |

---

## 6. Team handoff

| Owner | What to do |
|---|---|
| **Abhiram** (Registration) | No change required. **Do not** reintroduce a random `members.id` for the captain — it must equal the Auth user id, otherwise no captain can bid. `align_identities()` repairs old rows, but new rows must be created correctly. |
| **Akash N** (Submission) | Keep posting to `/api/submission` without a `teamId` (the team is resolved from the session). Send `slotId` when the team owns more than one question. **Never award bonus time directly** — call `approve_submission()` so the award is recorded and idempotent. |
| **Darshan R** (Admin) | Use the new control panel. The raw `/api/auction/admin` actions now map 1:1 onto the engine functions (`open_bidding`, `close_bidding`, `advance_auction`, `adjust_bidding_timer`, `adjust_auction_timer`, …). The old `extend_timer` now means the **bidding** clock; use `extend_solving_timer` for the solving clock. |
| **Anush** (Auction) | The auction module is consolidated: one module, one timer, one event stream. The parallel generation of components and the in-memory `auctionStore` were removed. |

---

## 7. Documentation index

| Document | Purpose |
|---|---|
| `docs/auction-implementation-audit.md` | what was there, what was broken, what was decided |
| `docs/auction-architecture.md` | how the module is built |
| `docs/auction-database-contract.md` | tables, functions, invariants |
| `docs/auction-realtime-events.md` | the event stream |
| `docs/auction-integration-guide.md` | how the modules fit together |
| `docs/auction-testing-report.md` | what was tested and what was not |
| `docs/auction-deployment-readiness.md` | this document |
| `docs/auction-migration-runbook.md` | how to apply the migrations |
| `docs/supabase-migration-runbook.sql` | the consolidated SQL |
