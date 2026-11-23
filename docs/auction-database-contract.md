# Auction Database Contract

Every table, column, constraint, index, function and trigger the auction
module owns. This is the reference for the API layer, the admin console and
the tests.

---

## 1. Identity

```
auth.users.id  ==  public.members.id  ==  public.teams.captain_id
```

The captain's `members` row **is** the Auth user. `current_team_id()` maps the
JWT subject to a team through `members`, and `place_bid()` resolves the bidder
through the captain chain and then the caller's team membership. Login is
captain-only (teammates have no Auth account), so only the captain can obtain
a session; the team lookup keeps bids bound to the caller's own team.

> Migration 011 ships `align_identities()`, which repairs a database that was
> created with the old (broken) registration flow, and logs the repair in
> `audit_log` under `identity_aligned`.

---

## 2. Tables

### 2.1 `public.auction_sessions` (new — migration 011)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `status` | text | `draft, ready, question_selection, bidding_open, bidding_closed, finalizing, question_assigned, solving, completed, cancelled` |
| `round` | int | 1 or 2 |
| `is_paused` | bool | pause flag (deliberately not a state) |
| `active_slot_id` | uuid | the item currently being auctioned |
| `timer_status` | text | `idle, running, paused, expired, completed` |
| `timer_started_at` | timestamptz | solving-clock start |
| `timer_ends_at` | timestamptz | **authoritative solving deadline** |
| `timer_paused_at` | timestamptz | |
| `paused_remaining_seconds` | int ≥ 0 | frozen remaining time |
| `total_bonus_seconds` | int ≥ 0 | lifetime bonus awarded |
| `total_manual_extension_seconds` | int ≥ 0 | lifetime manual extension |
| `settings_snapshot` | jsonb | the rules in force when the session started |
| `started_at` / `ended_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

**Index:** `auction_sessions_single_active_idx` — at most one session in a
non-terminal state.

### 2.2 `public.slots` (extended — migrations 001, 009, 011)

Existing columns: `id, topic_id, round, status, current_bid, min_bid,
leader_team_id, end_time, winner_team_id`.

Added in 011: `session_id`, `timer_status`, `timer_started_at`,
`timer_paused_at`, `paused_remaining_seconds`, `total_bonus_seconds`,
`total_manual_extension_seconds`, `question_number`, `sold_at`, `created_at`.

| Index | Purpose |
|---|---|
| `slots_single_open_idx` | at most one open item in the contest |
| `slots_topic_sold_once_idx` | a topic is sold **at most once** |
| `slots_one_active_per_topic_idx` | a topic has at most one pending/open item |
| `idx_slots_question_number` | display ordering |

**Trigger** `trg_single_active_slot_per_topic` → rejects an item whose topic is
already sold, and rejects a second active item for the same topic.

### 2.3 `public.wallets` (migration 006)

`team_id PK, balance int CHECK (balance ≥ 0), created_at`.
One wallet per team, starting balance from
`settings.starting_wallet_balance` (100).

### 2.4 `public.wallet_transactions` (new — migration 012)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid → teams | |
| `tx_type` | text | `win_deduction, manual_adjustment, reset, refund` |
| `amount` | int | **signed** delta |
| `balance_after` | int ≥ 0 | |
| `slot_id` | uuid → slots | |
| `bid_id` | uuid → bids | |
| `actor_id` | uuid | |
| `note` | text | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

**Index** `wallet_tx_win_deduction_once_idx` — `unique (slot_id) where
tx_type='win_deduction'` → a slot can be charged exactly once, ever.

Append-only: `revoke insert, update, delete … from authenticated, anon`.

### 2.5 `public.bonus_transactions` (new — migration 014)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid → teams | the team that earned the bonus |
| `slot_id` | uuid → slots | the question it solved |
| `topic_id` | uuid → topics | |
| `submission_id` | uuid **UNIQUE** → submissions | **idempotency key** |
| `approved_by` | uuid | judge/admin |
| `bonus_seconds` | int > 0 | |
| `reason` | text | |
| `created_at` | timestamptz | |

### 2.6 `public.team_eliminations` (new — migration 013)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid → teams | |
| `rule` | text | `no_selection, no_bid, manual, other` |
| `reason` | text | **mandatory** |
| `eliminated_at` | timestamptz | |
| `eliminated_by` | uuid | |
| `restored_at` / `restored_by` / `restore_note` | | |

**Index** `team_eliminations_active_unique_idx` — `unique (team_id) where
restored_at is null`.

### 2.7 `public.auction_events` (new — migration 016)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | the event id (de-duplication key) |
| `session_id` | uuid → auction_sessions | |
| `event_type` | text | see the event catalogue |
| `slot_id` / `team_id` | uuid | |
| `payload` | jsonb | **public-safe** |
| `timer_ends_at` | timestamptz | the deadline at the time of the event |
| `timer_status` | text | |
| `server_timestamp` | timestamptz | |

Append-only; `select` granted to `authenticated` and `anon` (the projector).

### 2.8 `public.submissions` (extended — migration 014)

Added: `live_url text`, `approved_by uuid`, `approved_at timestamptz`,
`judge_notes text`. The status check now also allows `approved` and
`rejected`.

**Index** `submissions_team_slot_unique_idx` — one submission per (team, item).

`slot_id` stays `NOT NULL`: a solution always belongs to an auction item.

### 2.9 `public.settings` (migration 011)

| Key | Default | Meaning |
|---|---|---|
| `min_bid` | 10 | minimum opening bid |
| `min_raise` | 10 | minimum raise above the current bid |
| `opening_window_seconds` | 10 | bidding window |
| `timer_extension_seconds` | 5 | clock extension per valid bid |
| `starting_wallet_balance` | 100 | wallet at registration / reset |
| `bonus_points_rate` | `{"points":1,"per_unspent":10}` | Rule Book §9.8 |
| `bonus_time_seconds` | 60 | bonus awarded per approved solution |
| `solving_timer_seconds` | 120 | solving clock length |
| `manual_timer_extension_seconds` | 15 | default admin extension |
| `elimination_enabled` | false | reserved for the automatic rule sweep |

---

## 3. Functions

### 3.1 Participant

| Function | Signature | Returns | Notes |
|---|---|---|---|
| `place_bid` | `(p_slot_id uuid, p_amount int)` | jsonb | The only participant write. Row-locks the item. |

`place_bid` validates, in order: authentication → team resolution (captain
chain, then caller membership) → elimination → amount → item state (open /
not paused / not expired) → minimum bid and raise (from settings) → not the
leader → one win per round → sufficient balance → records the bid → raises
`current_bid` and `end_time` → writes `audit_log`.

### 3.2 Session lifecycle (admin)

`start_auction(p_round int default 1)`, `select_auction_question(p_slot_id
uuid)`, `open_bidding(p_slot_id uuid default null)`, `close_bidding(p_slot_id
uuid default null)`, `finalize_auction(p_slot_id uuid default null)`,
`advance_auction()`, `pause_auction()`, `resume_auction()`,
`end_auction_session()`.

### 3.3 Item lifecycle (admin)

`open_slot(p_slot_id uuid, p_starting_bid int default null)`,
`close_slot(p_slot_id uuid)`, `skip_slot(p_slot_id uuid)`,
`reset_auction()`, `create_auction_topic(...)`.

### 3.4 Timers (admin)

`start_auction_timer(p_seconds int default null)`,
`pause_auction_timer()`, `resume_auction_timer()`,
`adjust_auction_timer(p_seconds int, p_reason text default null)` — the
solving clock — and `adjust_bidding_timer(p_seconds int, p_slot_id uuid
default null, p_reason text default null)` — the bidding clock.

### 3.5 Teams (admin)

`eliminate_team(p_team_id uuid, p_reason text, p_rule text default 'manual')`,
`restore_team(p_team_id uuid, p_note text default null)`,
`get_elimination_history()`.

### 3.6 Judging (judge/admin)

`approve_submission(p_submission_id uuid, p_score numeric default 0, p_notes
text default null, p_grant_bonus boolean default true)`,
`grant_bonus_time(p_submission_id uuid, p_reason text default null)`,
`get_bonus_history()`.

### 3.7 Reads

| Function | Who may call |
|---|---|
| `get_live_auction_state()` | everyone (incl. `anon`) |
| `get_current_auction_item()` | everyone |
| `get_auction_history(p_limit int default 100)` | everyone |
| `get_team_auction_state(p_team_id uuid)` | the team or an admin |
| `get_team_bid_history(p_team_id uuid)` | the team or an admin |
| `get_team_points_balance(p_team_id uuid)` | the team or an admin |
| `get_active_session()` | everyone |
| `get_setting_int(p_key text, p_default int)` | everyone |
| `team_is_eliminated(p_team_id uuid)` | everyone |
| `get_elimination_history()` / `get_bonus_history()` | admin |

### 3.8 Internal only

| Function | Granted to |
|---|---|
| `apply_wallet_transaction(...)` | `service_role` (called by `close_slot`) |
| `emit_auction_event(...)` | `service_role` (called by triggers) |
| `align_identities()` | `service_role` |

### 3.9 Authorisation helpers

| Function | Returns |
|---|---|
| `current_team_id()` | the team of `auth.uid()` |
| `is_team_captain()` | whether the caller captains their team |
| `is_admin()` | `app_metadata.role = 'admin'` |
| `is_judge()` | `app_metadata.role ∈ {judge, admin}` |
| `is_admin_or_judge()` | `app_metadata.role ∈ {admin, judge}` |

---

## 4. Invariants and the mechanism that enforces them

### Bidding

| Invariant | Mechanism |
|---|---|
| The highest bid never regresses | `place_bid` only ever increases `current_bid`; the item row is locked `FOR UPDATE` |
| A bid must be authorised | the caller must belong to the team they bid for (`teams.captain_id = auth.uid()` or a matching `members` row); login itself is captain-only |
| A bid must arrive before the deadline | `end_time > clock_timestamp()` |
| A bid must satisfy the minimum raise | `current_bid + settings.min_raise` |
| A team must be able to pay | wallet row locked `FOR UPDATE`, balance checked |
| An eliminated team cannot bid | `team_is_eliminated()` |
| A closed or paused item cannot be bid | `status <> 'open'`, `timer_status = 'paused'`, `auction_sessions.is_paused` |
| Simultaneous bids cannot corrupt state | row-level locking serialises them |

### Points

| Invariant | Mechanism |
|---|---|
| No negative balance | `CHECK (balance >= 0)` + `apply_wallet_transaction` |
| No duplicate deduction | `wallet_tx_win_deduction_once_idx` + `close_slot` rejects a non-open item |
| No duplicate reservation | there are no reservations (Rule Book §5.1) |
| No double charge on retry | `close_slot` raises `Only open slots can be closed` |
| Every change is explainable | `wallet_transactions` is append-only and mandatory for balance changes |
| Participants cannot move points | `revoke insert/update/delete` on `wallets` and `wallet_transactions` |

### Questions

| Invariant | Mechanism |
|---|---|
| A question cannot be sold twice | `slots_topic_sold_once_idx` + trigger |
| A topic cannot have two live items | `slots_one_active_per_topic_idx` + trigger |
| Assignment matches the winning auction | `slots.winner_team_id` is set in the same transaction as the debit |
| Hidden solutions stay private | column-level `revoke select` on `challenge_problems.test_cases` |

### Timer

| Invariant | Mechanism |
|---|---|
| The timer is authoritative | absolute deadlines in PostgreSQL |
| Extensions are authorised | `is_admin()` inside the function |
| Extensions are recorded | `audit_log` + `total_manual_extension_seconds` |
| The client cannot manipulate it | no client input reaches a deadline except through an RPC |
| A bonus cannot be granted twice | `bonus_transactions.submission_id` unique |
| Pause/resume is correct | remaining seconds captured and rebuilt |

### Bonus and elimination

| Invariant | Mechanism |
|---|---|
| A bonus needs a valid approval | `submissions.status = 'approved'` required |
| A bonus is linked to submission + team + question | columns + foreign keys + validation |
| A bonus is awarded once | unique index on `submission_id` |
| Elimination is recorded | `team_eliminations` + `audit_log` |
| An eliminated team cannot continue | checked in `place_bid` and `grant_bonus_time` |
| Only an admin may restore | `is_admin()` inside `restore_team` |

---

## 5. RLS summary

| Table | authenticated | anon | service_role |
|---|---|---|---|
| `auction_sessions` | select | select | all |
| `auction_events` | select | select | all |
| `slots` | select | select | all |
| `bids` | select | select | all |
| `teams` | select | select | all |
| `topics` | select | select | all |
| `settings` | select | select | all |
| `wallets` | select own / admin | — | all |
| `wallet_transactions` | select own / admin | — | all |
| `bonus_transactions` | select own / admin | — | all |
| `team_eliminations` | select own / admin | — | all |
| `submissions` | select own / admin | — | all |
| `evaluations` | select own / admin | — | all |
| `audit_log` | select admin | — | all |

Writes are limited to `service_role` and the `SECURITY DEFINER` functions,
except for the admin-managed `settings` and `teams.locked`, which keep their
admin-only policies for the admin console.

---

## 6. Audit trail

`public.audit_log` records, with the actor and a JSON detail payload:

`auction_started`, `question_selected`, `slot_opened`, `slot_sold`,
`slot_skipped`, `slot_reconciled`, `bid_placed`, `auction_paused`,
`auction_resumed`, `auction_completed`, `auction_reset`, `timer_started`,
`timer_paused`, `timer_resumed`, `timer_extended`, `team_eliminated`,
`team_restored`, `bonus_time_granted`, `solution_approved`, `topic_created`,
`identity_aligned`.
