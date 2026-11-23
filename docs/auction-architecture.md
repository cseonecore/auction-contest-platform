# Auction Architecture

Bid2Build auction module — how the pieces fit together.

---

## 1. Design principles

1. **PostgreSQL is the only authority.** The browser never decides the auction
   status, never computes a balance and never declares a winner. Every state
   change is a `SECURITY DEFINER` function that validates, authorises,
   calculates and records.
2. **One state, many readers.** The participant arena, the admin console and the
   projector all read the same function (`get_live_auction_state()`) and all
   observe the same event stream (`public.auction_events`). They cannot drift
   apart.
3. **Rules live in settings, not in code.** `min_bid`, `min_raise`,
   `opening_window_seconds`, `timer_extension_seconds`, `bonus_time_seconds`
   and `starting_wallet_balance` are read from `public.settings` at call time.
   The admin can retune the contest without a deploy.
4. **The clock belongs to the server.** The browser *displays* a countdown; it
   never decides that time is up. `slots.end_time` (bidding clock) and
   `auction_sessions.timer_ends_at` (solving clock) are absolute deadlines.
5. **Every point change is explainable.** `public.wallet_transactions` is an
   append-only ledger. A balance without a ledger row does not exist.

---

## 2. The state machines

### 2.1 Contest session — `public.auction_sessions.status`

```
draft ──► ready ──► question_selection ──► bidding_open ──► bidding_closed
                                                                   │
                                                                   ▼
completed ◄── solving ◄── question_assigned ◄── finalizing ◄──────┘
   │
   └──► cancelled
```

| State | Meaning | Who advances it |
|---|---|---|
| `draft` | Session row exists, nothing published | — |
| `ready` | Session created, settings snapshotted | `start_auction()` |
| `question_selection` | A problem statement has been chosen | `select_auction_question()` |
| `bidding_open` | Participants may bid | `open_bidding()` → `open_slot()` |
| `bidding_closed` | The window closed, no award yet | `close_bidding()` |
| `finalizing` | The result is being applied | internal to `close_slot()` |
| `question_assigned` | The question now belongs to a team | `close_slot()` |
| `solving` | Teams are working on their questions | `finalize_auction()` |
| `completed` | The contest is over | `end_auction_session()` |
| `cancelled` | The session was reset | `reset_auction()` |

A pause is **not** a state: `auction_sessions.is_paused` is a separate flag so
the state machine stays linear and auditable.

Only one non-terminal session may exist at a time — enforced by the partial
unique index `auction_sessions_single_active_idx`.

### 2.2 Auction item — `public.slots.status`

```
pending ──► open ──► sold
   │           │
   └───────────┴──► skipped
```

* `pending` — a problem statement waiting to be auctioned.
* `open` — live, accepting bids. `slots.end_time` is the deadline.
* `sold` — awarded to `winner_team_id`; the wallet has been debited exactly once.
* `skipped` — nobody bid, or the admin overrode it.

Invariants enforced by the database:

| Invariant | Mechanism |
|---|---|
| At most one open item in the whole contest | `slots_single_open_idx` (existing) |
| At most one **active** item per topic | `slots_one_active_per_topic_idx` + trigger |
| A topic can be **sold at most once** | `slots_topic_sold_once_idx` + trigger |
| A sold topic can never be re-auctioned | `enforce_single_active_slot_per_topic()` trigger |
| A team wins at most one item per round | `place_bid()` check |

---

## 3. Component map

```
                    ┌──────────────────────────────────────────┐
   Browser ────────►│ Next.js App Router                        │
                    │  /auction          participant arena      │
                    │  /admin/auction    admin console         │
                    │  /projector/auction auditorium display   │
                    │  /submit            submission portal     │
                    └───────────────┬──────────────────────────┘
                                    │  supabase-js (publishable key + session JWT)
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │ Supabase PostgREST                        │
                    │  RPC  → SECURITY DEFINER engine functions│
                    │  Realtime → postgres_changes on           │
                    │             public.auction_events         │
                    └───────────────┬──────────────────────────┘
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │ PostgreSQL                                │
                    │  auction_sessions · slots · bids ·        │
                    │  wallets · wallet_transactions ·          │
                    │  bonus_transactions · team_eliminations · │
                    │  auction_events · audit_log               │
                    └──────────────────────────────────────────┘
```

### 3.1 Frontend

```
app/features/auction/
├── components/
│   ├── ParticipantAuctionRoom.tsx    participant arena
│   ├── ParticipantAuctionHeader.tsx
│   ├── ParticipantBiddingPanel.tsx    bid controls (mirrors the DB rules)
│   ├── LiveLeaderboardGrid.tsx / LeaderboardCapsule.tsx
│   ├── AuctionSoldModal.tsx / BidConfirmationModal.tsx / ContestRulesModal.tsx
│   └── AdminAuctionRoom.tsx           admin arena
├── hooks/
│   ├── useAuction.ts                  state + identity + team state
│   ├── useAuctionRealtime.ts          event stream subscription
│   └── useAuctionTimer.ts             server-anchored countdown
├── services/
│   └── auction.service.ts             RPC-only data access
├── types/auction.types.ts             the live-state contract
└── utils/
    ├── bid-validation.ts              the bid rules (UX pre-filter)
    ├── countdown.ts                   formatting
    └── mascot.ts                      team avatars

app/features/admin/
├── components/auction/
│   ├── AuctionControlPanel.tsx        session + item lifecycle
│   ├── AuctionTimerControl.tsx        both clocks
│   ├── TeamEliminationControl.tsx     elimination / restoration
│   └── BonusApproval.tsx              judging + bonus time
├── hooks/useAdminAuctionActions.ts    admin action dispatch
└── services/adminAuctionService.ts    admin RPC wrappers

app/features/projector/auction/
├── components/…                       read-only auditorium display
└── hooks/useProjectorAuction.ts       public state + event stream

app/features/scoring/
├── services/scoring.service.ts        competition score (separate from budget)
└── hooks/useScoringRealtime.ts
```

### 3.2 Server routes

| Route | Method | Auth | Backend |
|---|---|---|---|
| `/api/auction/state` | GET | public | `get_live_auction_state()` |
| `/api/auction/teams` | GET | public | `get_live_auction_state()` |
| `/api/auction/history` | GET | public | `get_auction_history()` |
| `/api/auction/bid` | POST | session | `place_bid()` |
| `/api/auction/admin` | POST | admin/judge | the engine functions |
| `/api/submission` | GET/POST | session | submissions table (ownership verified) |
| `/api/team/profile` | GET | session | RLS-scoped reads |
| `/api/login` | POST | — | Supabase Auth |

The service-role client (`app/lib/serverDb.ts`) is used **only** by
registration (creating the Auth account and the team rows) and by the
submission insert, both after the caller's ownership has been verified from the
session. It is never used for auction state, bids, wallets, bonuses,
eliminations or admin actions.

---

## 4. The bidding write path

```
participant clicks "Place Bid"
        │
        ▼
ParticipantBiddingPanel.validateBid()      ← UX pre-filter only
        │
        ▼
POST /api/auction/bid
        │  session-bound client (JWT = the captain)
        ▼
place_bid(p_slot_id, p_amount)            ← SECURITY DEFINER
        │
        ├─ 1. auth.uid() must exist
        ├─ 2. resolve teams.captain_id = auth.uid()   (no client-supplied team)
        ├─ 3. reject eliminated teams
        ├─ 4. SELECT … FROM slots WHERE id = … FOR UPDATE   ← serialises bids
        ├─ 5. reject unless status='open', not paused, not expired
        ├─ 6. min bid / min raise from public.settings
        ├─ 7. reject leading team, one-win-per-round, insufficient balance
        ├─ 8. INSERT INTO bids
        ├─ 9. UPDATE slots SET current_bid = p_amount      ← only ever increases
        │                    end_time = greatest(end_time, now()) + extension
        ├─ 10. INSERT INTO audit_log
        └─ 11. return the authoritative snapshot
        │
        ▼
triggers → public.auction_events → every client reconciles
```

**Concurrency.** Step 4 holds the item row lock for the rest of the
transaction. Two simultaneous bids are therefore serialised: the second one
reads the *updated* `current_bid` and is rejected if it is lower than the new
minimum. The highest bid can never regress, and no points are duplicated or
lost because a losing bid costs nothing (Rule Book §5.1).

---

## 5. Points accounting (Rule Book §5.1)

```
Initial budget            100
Bid 200                   → the wallet is UNCHANGED (losing bids are free)
Bid 350                   → the wallet is UNCHANGED
Team wins at 350          → balance 100 → 650, one ledger row of −350
```

The ledger is the explanation:

| Column | Meaning |
|---|---|
| `tx_type` | `win_deduction`, `manual_adjustment`, `reset`, `refund` |
| `amount` | signed delta applied to the balance |
| `balance_after` | the resulting balance |
| `slot_id` / `bid_id` | the auction item and bid that caused it |
| `actor_id` | who triggered it |
| `metadata` | round, topic, anything else useful |

Guarantees:

* `available ≥ 0` — enforced by the `wallets.balance` check constraint and by
  `apply_wallet_transaction()`.
* **Exactly one** `win_deduction` per slot — enforced by the partial unique
  index `wallet_tx_win_deduction_once_idx`, so even a concurrent or retried
  finalisation cannot double-charge.
* Participants cannot write the ledger (`revoke insert/update/delete`) and
  cannot change a balance directly.

Competition score, bonus time and penalties are **separate** concepts:

* *Competition score* — `public.evaluations.score`, written when a judge
  approves a solution.
* *Bonus time* — `public.bonus_transactions`, extends the solving clock.
* *Projected bonus points* — unspent budget ÷ 10 (Rule Book §9.8), derived, never
  stored.

---

## 6. The timer engine

There are two clocks, and they are deliberately separate.

| Clock | Stored in | Extended by | Displayed to |
|---|---|---|---|
| **Bidding clock** | `slots.end_time`, `slots.timer_status` | a valid bid (`timer_extension_seconds`), `adjust_bidding_timer()` | everyone |
| **Solving clock** | `auction_sessions.timer_ends_at`, `timer_status` | bonus time, `adjust_auction_timer()` | everyone |

Both are absolute deadlines. The client computes:

```
remaining_seconds = max(0, ends_at − server_now)
```

`server_now` is derived from the `server_time` the API returns, so a device
with a wrong clock still shows the correct remaining time.

**Pause** captures the remaining seconds (`paused_remaining_seconds`), freezes
the countdown and makes `place_bid()` reject bids. **Resume** rebuilds the
deadline from the preserved value. Expiry is decided by the backend: the client
only asks it to refresh.

---

## 7. Bonus-time workflow

```
question assigned (close_slot)
      │
      ▼
team submits (POST /api/submission → submissions.slot_id)
      │
      ▼
judge approves (approve_submission)
      │   ├─ writes evaluations.score            (competition score)
      │   ├─ sets submissions.status = 'approved'
      │   └─ calls grant_bonus_time()
      │        ├─ checks the team owns the slot
      │        ├─ checks the team is not eliminated
      │        ├─ returns early if a bonus already exists for this submission
      │        ├─ inserts public.bonus_transactions (unique on submission_id)
      │        └─ extends auction_sessions.timer_ends_at  (same transaction)
      ▼
trigger → auction_events ('bonus_time_granted')
      │
      ▼
every client re-reads the state → the new deadline is displayed everywhere
```

The award is idempotent because `bonus_transactions.submission_id` is unique:
a second attempt returns the existing award instead of extending the clock
again.

---

## 8. Elimination

`public.team_eliminations` is a separate, additive log — the registration
status of a team is never overwritten.

* A team is eliminated with a **mandatory reason** and a rule
  (`no_selection`, `no_bid`, `manual`, `other`).
* Only one active elimination per team (partial unique index).
* `place_bid()` rejects eliminated teams.
* `grant_bonus_time()` rejects eliminated teams.
* An admin can restore a team; the record keeps both the elimination and the
  restoration with their timestamps and actors.
* The elimination is published to the event stream so the arena and the
  projector can announce it.

---

## 9. Realtime

One table, one contract:

```typescript
type AuctionEvent = {
  id: string;
  event_type: string;
  slot_id: string | null;
  team_id: string | null;
  payload: Record<string, unknown>;
  timer_ends_at: string | null;
  timer_status: string | null;
  server_timestamp: string;
};
```

Clients subscribe to `INSERT` on `public.auction_events` and re-read the
authoritative state when an event arrives (debounced by 120 ms). On every
(re)connect the state is re-read — a client never assumes it saw every event.

See `docs/auction-realtime-events.md` for the full event catalogue.

---

## 10. Security model

| Role | Can |
|---|---|
| **Participant** | read the public auction state, read their own team/wallet/ledger/history, bid as their own team (captain only), submit for a question they own |
| **Judge** | everything an admin can do, plus approve solutions and award bonus time |
| **Admin** | control the session, the items, both clocks, eliminations, judging and the full audit trail |
| **Projector** | read the public state and the public event stream — nothing else |

Enforcement is layered:

1. **PostgreSQL** — `is_admin()`, `is_admin_or_judge()`, `current_team_id()`,
   `team_is_eliminated()` are checked inside every function. Table write
   privileges are revoked from `authenticated`/`anon` for every sensitive table.
2. **RLS** — enabled on every table, with explicit policies.
3. **API routes** — verify the session, then delegate to the RPC.
4. **Client** — hides controls, but is never the enforcement point.
