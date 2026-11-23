# Auction Integration Guide

How the auction module plugs into the other Bid2Build modules, and what each
team needs to know.

---

## 1. Module map

```
  Registration ──►  Teams + Members + Wallets
        │                 │
        │                 ▼
        │           Auction (teams bid with their points)
        │                 │
        │                 ▼
        │           Question assignment (slots.winner_team_id)
        │                 │
        │                 ▼
        └─────────►  Submission (one solution per assigned question)
                          │
                          ▼
                     Judging ──► Score  +  Bonus time
                          │                 │
                          ▼                 ▼
                     Scoring      Auction solving clock
```

---

## 2. Registration → Auction

**Contract:** a registered team is an auction participant.

| Auction needs | Registration provides | Where |
|---|---|---|
| Team id | `teams.id` | already shared |
| Team name | `teams.name` | already shared |
| Team members | `members.*` | already shared |
| Captain identity | `teams.captain_id = members.id = auth.users.id` | **fixed** — see below |
| Starting budget | `wallets.balance` (100) | already shared |
| Eligibility | the existence of a wallet + no active elimination | new |
| Participation status | `team_eliminations` | new |

### What changed for Registration

1. **The captain's `members.id` is now the Auth user id.** Previously the row
   was created with a random uuid and `teams.captain_id` pointed at that row,
   which broke `current_team_id()`, `is_team_captain()` and `place_bid()` — in
   other words **no captain could ever bid**. `app/app/api/register/route.ts`
   now inserts the captain with `id: authUserId`.
2. Migration 011 ships `align_identities()` which repairs databases created
   with the old flow.

**Action for Abhiram:** none required — but please do not reintroduce the
random `members.id` for the captain. If you add new registration flows, the
captain's `members.id` must equal their `auth.users.id`.

### What the auction expects from Registration

* A wallet row must exist for every team (created at registration, restored by
  `reset_auction()`).
* The team must not be locked by the admin team-lock feature — the lock is an
  administrative freeze, not an elimination, and it does not remove the team
  from the auction.

---

## 3. Auction → Submission

**Contract:** a solution belongs to a question the team won.

| Auction provides | Submission consumes |
|---|---|
| `slots.winner_team_id` | "is this team allowed to submit for this item?" |
| `slots.topic_id` | the problem statement |
| `slots.current_bid` | how much the team paid |
| `slots.round` | which round the question belongs to |

### What changed for Submission

* `submissions.slot_id` is now mandatory and must point at the auction item the
  team won. The API resolves it server-side: the team's team is read from the
  session, the won items are read from the database, and the submitted item is
  validated against them. **A client can no longer submit for a question it
  does not own.**
* `submissions.live_url` was added (the column did not exist, so every insert
  failed).
* `/submit` now lets the team choose which assigned question it is answering
  and shows the status of each submission (`submitted` / `approved`).
* A unique index `(team_id, slot_id)` guarantees one solution per question.

**Action for Akash N:**

1. Keep writing solutions through `POST /api/submission` — it resolves the
   team from the session, so do not send a `teamId`.
2. Pass `slotId` (the auction item id) when your team owns more than one
   question.
3. **Do not award bonus time yourself.** Call `approve_submission()` (judge /
   admin only) and let the server decide whether a bonus applies. A bonus that
   is not recorded in `public.bonus_transactions` is invisible to the auction,
   the projector and the audit trail.

---

## 4. Submission → Judging → Bonus time

```
judge approves
   ├─ evaluations.score        (competition score — separate from the budget)
   ├─ submissions.status       ('approved')
   └─ grant_bonus_time()
        ├─ bonus_transactions row (unique on submission_id)
        └─ auction_sessions.timer_ends_at extended
```

**Contract for the judge:**

| Rule | Enforcement |
|---|---|
| Only a judge or admin may approve | `is_admin_or_judge()` inside `approve_submission()` |
| The solution must belong to the owning team | validated against `slots.winner_team_id` |
| A bonus is awarded at most once per solution | unique index on `bonus_transactions.submission_id` |
| An eliminated team earns no bonus | `team_is_eliminated()` check |
| The bonus duration comes from the settings | `settings.bonus_time_seconds` (60 s) |
| The extension is atomic with the ledger | one transaction |

---

## 5. Scoring integration

The competition score is **not** the auction budget.

| Concept | Stored in | Updated by |
|---|---|---|
| Auction budget | `wallets.balance` | `close_slot()` (one debit per win) |
| Spent points | `wallet_transactions` (`tx_type='win_deduction'`) | `close_slot()` |
| Competition score | `evaluations.score` | `approve_submission()` |
| Bonus time | `bonus_transactions.bonus_seconds` | `approve_submission()` |
| Projected bonus points | derived: unspent ÷ 10 | never stored |

`app/features/scoring/services/scoring.service.ts` assembles the two views
side by side; `useScoringRealtime` refreshes them when a solution is approved.

---

## 6. Admin integration

**Action for Darshan R:**

The raw `/api/auction/admin` actions are now thin, session-authenticated
wrappers around the engine functions. The admin console should use:

| Old action | New call |
|---|---|
| `open_slot` | `open_bidding(slotId)` |
| `close_slot` | `close_bidding(slotId)` / `finalize_auction(slotId)` |
| `next_slot` | `advance_auction()` |
| `pause_auction` / `resume_auction` | unchanged names, new semantics (they now really pause) |
| `extend_timer` | `adjust_bidding_timer(seconds)` for the bidding clock, `adjust_auction_timer(seconds)` for the solving clock |
| `reset_auction` | unchanged |

The admin arena (`/admin/auction`) already renders the new control panel,
timer control, elimination control and bonus approval. The tabbed
management console (`/admin/auction?view=console`) still calls the older
service functions; they remain valid because the underlying RPCs keep their
signatures.

---

## 7. Identity and roles

| Role | How it is set | What it may do |
|---|---|---|
| `captain` | `app_metadata.role = 'captain'` (set at registration) | bid, submit |
| `admin` | `app_metadata.role = 'admin'` | everything |
| `judge` | `app_metadata.role = 'judge'` | approve solutions, award bonus, everything an admin may do except reset |

`app_metadata` is server-controlled, so a participant cannot promote
themselves by editing their user metadata.

```sql
-- promote an organiser to admin (run once in the SQL Editor)
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
where email = 'you@example.com';
```

---

## 8. End-to-end flow

```
1. Registration        team + captain Auth user + wallet (100 pts)
2. Admin               start_auction(1)
3. Admin               select_auction_question(slot)   → published to everyone
4. Admin               open_bidding(slot)              → 10 s window
5. Teams               place_bid(slot, amount)         → row-locked, audited
6. Admin               close_bidding(slot)             → winner charged once
7. Team                POST /api/submission {slotId}   → solution recorded
8. Judge               approve_submission(...)         → score + bonus time
9. Everyone            timer extended, event published
10. Admin               eliminate_team / restore_team   → enforced everywhere
11. Admin               advance_auction()               → next item
12. Admin               end_auction_session()           → results frozen
```

---

## 9. Environment variables

| Variable | Used by | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | everything | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | registration, submission insert | **recommended** — server only |

The service-role key bypasses RLS. It is used in exactly two places, both
after the caller's ownership has been verified from the session:

* `app/app/api/register/route.ts` — creating the Auth account and the team,
  member and wallet rows.
* `app/app/api/submission/route.ts` — inserting the submission row.

Never expose it to the browser, never commit it, and never use it for auction
state, bids, wallets, bonuses, eliminations or admin actions.
