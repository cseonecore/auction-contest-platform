# Auction Realtime Events

One normalised event stream, shared by the participant arena, the admin console
and the projector.

---

## 1. The stream

| Property | Value |
|---|---|
| Table | `public.auction_events` |
| Channel | `auction-event-stream` (participant + admin) · `projector-auction` (projector) |
| Event | `INSERT` on `public.auction_events` |
| Writer | database triggers (never the application) |
| Retention | append-only; the table grows for the lifetime of the contest |
| Reader | `authenticated` and `anon` (read-only) |

### Event payload

```typescript
type AuctionEvent = {
  id: string;                        // event id — the de-duplication key
  event_type: string;
  slot_id: string | null;
  team_id: string | null;
  payload: Record<string, unknown>;  // public-safe
  timer_ends_at: string | null;      // the deadline at the time of the event
  timer_status: string | null;
  server_timestamp: string;          // the server clock, never the browser clock
};
```

**The payload never contains** member e-mails, repository URLs, judge notes,
scores, session tokens or any other private data. A test in the engine suite
asserts this by scanning every event payload for private markers.

---

## 2. Event catalogue

| `event_type` | Emitted by | `payload` contains |
|---|---|---|
| `auction_started` | `start_auction()` (via the audit log) | — (the session row is the source of truth) |
| `question_selected` | `select_auction_question()` | `slot_id, status, round, topic_title` |
| `bidding_opened` | `slots` trigger (status → `open`) | `slot_id, status, round, topic_title, current_bid, leader_name, end_time, timer_status` |
| `bid_placed` | `bids` trigger | `bid_id, slot_id, team_id, team_name, amount, current_bid, end_time, server_time` |
| `highest_bid_changed` | `slots` trigger (`current_bid` changed) | `slot_id, current_bid, previous_bid, leader_name, end_time` |
| `team_outbid` | derived by the client from `highest_bid_changed` | — |
| `bidding_closed` | `slots` trigger (status → `skipped`) | `slot_id, status, previous_status, round, topic_title` |
| `auction_finalized` | `slots` trigger (status → `sold`) **and** the ledger trigger | `slot_id, winner_name, winning_bid, team_name, balance_after` |
| `question_assigned` | implied by `auction_finalized` (`winner_team_id`) | — |
| `solution_submitted` | the application posts a submission | not published (the submission table is private) |
| `solution_approved` | `approve_submission()` (via the audit log) | not published — the score is private |
| `bonus_time_granted` | `bonus_transactions` trigger | `team_id, team_name, slot_id, bonus_seconds, reason` |
| `timer_extended` | `adjust_auction_timer()` / `adjust_bidding_timer()` (via the audit log) | the new deadline is in `timer_ends_at` |
| `timer_paused` | `slots` trigger (`timer_status` → `paused`) | `slot_id, timer_status, end_time, paused_remaining_seconds` |
| `timer_resumed` | `slots` trigger (`timer_status` → `running`) | `slot_id, timer_status, end_time` |
| `team_eliminated` | `team_eliminations` trigger | `team_id, team_name, rule, reason` |
| `team_restored` | `team_eliminations` trigger | `team_id, team_name` |
| `auction_completed` | `end_auction_session()` (via the audit log) | — (the session row is the source of truth) |
| `points_changed` | `wallet_transactions` trigger | `team_id, team_name, tx_type, amount, balance_after` |
| `slot_progression_scheduled` | `settle_slot()` → `schedule_slot_progression()` | `round, completed_slot_id, scheduled_transition_at` |
| `slot_progression_complete` | `auto_advance_auction_if_scheduled()` | `round, message` |

The `timer_ends_at` and `timer_status` columns on every event carry the
authoritative deadline at the moment of the event, so a client can update its
clock immediately and reconcile fully on the next state read.

### Automatic slot progression

Once the admin has opened the first slot of a round, the backend advances the
round on its own: each finalisation (SOLD or UNSOLD) arms a 5-second transition
and emits `slot_progression_scheduled`, whose payload carries the backend
timestamp the next slot is opened at. `slot_progression_complete` announces
that the round has no eligible slot left — progression stops there and never
crosses into another round.

Clients only *render* this schedule. The countdown in the admin room is derived
from `scheduled_transition_at` and the `server_time` of the last state read, and
when it reaches zero the client simply re-reads `get_live_auction_state()` —
that read (or the pg_cron tick) is what executes the transition, exactly once.

---

## 3. Client protocol

```
1.  SUBSCRIBE to INSERT on public.auction_events
2.  On SUBSCRIBED            → read the authoritative state
3.  On every event           → de-duplicate by id, then read the authoritative state
4.  On CHANNEL_ERROR/TIMED_OUT → mark "reconnecting"; the SDK retries
5.  On SUBSCRIBED again       → read the authoritative state again
```

The client **never** assumes it received every event, and it never patches
state from the event payload alone. The event is a signal to re-read
`get_live_auction_state()`. This makes the system self-healing: a dropped
socket, a sleeping laptop or a duplicated delivery can only ever cause an
extra read, never a wrong state.

### De-duplication

Each client keeps a bounded set of the event ids it has already processed
(500 entries). A repeated delivery is ignored.

### Debouncing

Events are debounced by 120 ms before the state is re-read, so a burst of
fifty bids produces one read rather than fifty.

### Failure behaviour

| Situation | Behaviour |
|---|---|
| Websocket drops | `connectionStatus` becomes `reconnecting`; the header shows it; the SDK reconnects and the state is re-read |
| The state read fails | the last known state stays on screen and an error banner with a **Retry** button appears |
| The browser sleeps | on wake, the state is re-read because the reconnect handler fires |

The projector additionally runs a 15-second heartbeat read, so the auditorium
display stays correct even if a websocket event is lost.

---

## 4. Publication

`postgres_changes` only fires for tables that are members of the
`supabase_realtime` publication. Migration 018 adds:

```
slots · bids · wallets · settings · teams
auction_sessions · auction_events
wallet_transactions · bonus_transactions · team_eliminations
```

Verify after the migration:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
```

---

## 5. Why one stream

Before this change the participant arena and the admin arena each subscribed
to `slots`, `bids` and `wallets` directly, used different channel names, and
polled every two seconds as a fallback. That produced three problems:

1. The surfaces could show different states at the same moment.
2. Every change to the auction produced several partial signals instead of one
   meaningful event.
3. The polling fallback masked a broken publication, so a silent realtime
   failure looked like "slow" rather than "broken".

The normalised stream fixes all three: one trigger set, one event shape, one
reconciliation path, and a publication that is verified by SQL.
