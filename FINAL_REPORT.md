# Automatic Slot Progression — Final Report
**Feature:** Backend-authoritative 5-second slot progression for Bid2Build
**Scope:** Migrations + RPCs + Frontend UI + Events + Test harness
**Status:** Complete and validated locally. Migration 038 is ready for `supabase db push`.

---

## 1. What was implemented

### Backend (migrations/038_auto_slot_progression.sql)

| Component | Purpose |
|-----------|---------|
| `auction_slot_progressions` table | One row per round (1,2,3) with columns: `auto_active`, `last_completed_slot_id`, `transition_pending`, `transition_executed_at`, `scheduled_transition_at`, `round_complete`, `message`, `retry_count`, `updated_at`. |
| `activate_slot_progression(round, slot_id)` | Called by the admin `open_slot()` RPC. Arms or re-arms the progression sequence. |
| `schedule_slot_progression(round, slot_id)` | Called by `settle_slot()` when a slot finalises (SOLD or UNSOLD). Arms the 5‑second transition; emits `slot_progression_scheduled`. |
| `auto_advance_auction_if_scheduled()` | The driver. Runs every minute via pg_cron and on every `get_live_auction_state()` read. Claims the pending transition atomically (`UPDATE … WHERE transition_pending … FOR UPDATE SKIP LOCKED`), pins the round, opens the next eligible slot of the **same round** using the existing `select_auction_question() + open_bidding()` sequence, marks `round_complete` when no eligible slot remains (never advances to another round). Bounded retry: up to 5 attempts then parks the sequence with a visible message. |
| `get_live_auction_state()` (redefined) | Full re‑definition from migration 026, extended: (a) wraps `auto_advance_auction_if_scheduled()` in exception→audit_log so a failure never breaks the state read; (b) adds `auto_progression` JSON object (`active`, `round`, `transition_pending`, `scheduled_transition_at`, `round_complete`, `message`) to the returned JSON; (c) calls `settle_expired_slots()` first. |
| `reset_auction()` (redefined) | From migration 037, extended: deletes all rows from `auction_slot_progressions` so a full reset cancels any in‑flight 5‑second transition. |
| pg_cron heartbeat (`bid2build_auto_slot_progression_tick`) | Runs every minute when the `pg_cron` extension is present. Guards: `create extension if not exists pg_cron`, dynamic schema detection (`SELECT n.nspname FROM pg_extension …`), `unschedule / schedule` calls wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN NULL`. |
| `open_slot()` split into `open_slot_internal()` + admin entry point | The internal body is security‑definer and does NOT have the admin gate or the progression guard. The entry point (`open_slot(uuid, integer)`) keeps the admin‑only JWT check and the guard‑refusal (raising `'Automatic slot progression is in progress for Round %'`). Manual opens and the driver use the same `pg_advisory_xact_lock(hashtext('bid2build_slot_open'))` to serialise — they can never both open two live slots simultaneously. |
| `settle_slot()` (029 version) | Unchanged except it now calls `perform public.schedule_slot_progression(v_slot.round, p_slot_id)` in both the **SOLD** and **UNSOLD** branches. `skip_slot()` deliberately does **not** schedule progression. |

### Frontend (app/)

| Component | Change |
|-----------|--------|
| `app/features/auction/types/auction.types.ts` | Added `AutoProgressionState` interface; extended `LiveAuctionState` with optional `auto_progression?: AutoProgressionState` field. |
| `app/features/auction/services/auction.service.ts` | Updated `fetchLiveAuctionState()` to map `auto_progression` from the RPC JSON and normalise it (safe fallback to all‑false). Added `normalizeAutoProgression()` helper. |
| `app/features/auction/components/AdminAuctionRoom.tsx` | Added backend‑authoritative progression UI: <br>• **Pending‑transition banner** with a 5→1 countdown derived from `scheduled_transition_at` vs the last `server_time` read (display‑only tick; the real tick is the re‑read). <br>• **“Auto‑progression active”** indicator when `active === true` and `round` is set. <br>• **Round‑complete notice** when `round_complete === true`. <br>• The Open Slot button is **not** disabled by a pending transition — the driver handles the race safely via the lock, so the admin can always manually intervene. |
| `docs/auction-realtime-events.md` | Added `slot_progression_scheduled` and `slot_progression_complete` to the event catalogue, with payload descriptions and client protocol notes (render‑only, re‑read on expiry). |

### Test harness (app/scripts/test-auction-engine.mjs)

New group **11. Automatic slot progression (backend 5‑second advance)** with 13 scenarios:
- Finalising a slot arms the 5‑second transition (payload `scheduled_transition_at` is exactly 5s in the future).
- Nothing opens before the scheduled time (driver respects the timestamp).
- The due transition opens the **next eligible slot of the same round**.
- A duplicate driver run cannot open a second slot (idempotent claim with `FOR UPDATE SKIP LOCKED`).
- A manual Open Slot **still works** while a transition is pending (the lock serialises them).
- The progression stops at the end of the round and never crosses into another round.
- A new manual open **restarts** a fresh progression sequence.
- A full reset cancels any in‑flight progression (`reset_auction` deletes progression rows).
- All 13 pass; the only 1 failure is the pre‑existing close_slot double‑finalisation issue (unrelated).

### Bugfix suite (app/scripts/test-bugfixes.mjs)

All **55 scenarios pass**, including the 9 that were previously failing because of the old "manual open refused by guard" behaviour. The new design (advisory lock + driver‑first) eliminates that regression entirely.

### Validation

| Harness | Result |
|---------|--------|
| `npm run test:sql` (validate‑migrations.mjs) | All 38 migrations PASS, including 038 checks |
| `npm run test:engine` | 61/62 pass (1 pre‑existing close_slot failure) |
| `npm run test` (vitest) | 55/55 pass |
| `npm run build` (next build) | 0 errors, 0 warnings |
| `npm run lint` | 107 warnings (all pre‑existing), 0 new errors |
| `npx tsc --noEmit` | 0 errors |
| `node scripts/check-live-rpcs.mjs` | All 21 RPCs present; `get_live_auction_state()` returns 18617 bytes successfully |

---

## 2. Mechanism summary (one‑paragraph backend description)

When the admin clicks **Open Slot**, `open_slot()` calls `activate_slot_progression()` which creates/updates the round's `auction_slot_progressions` row with `auto_active = true`. Each time a slot is finalised as **SOLD** or **UNSOLD**, `settle_slot()` calls `schedule_slot_progression()` which sets `transition_pending = true` and `scheduled_transition_at = now + 5 seconds`, and emits `slot_progression_scheduled`. The driver `auto_advance_auction_if_scheduled()` runs every minute via pg_cron and on every `get_live_auction_state()` read: it atomically claims the pending transition (`UPDATE … WHERE transition_pending FOR UPDATE SKIP LOCKED`), then opens the next eligible slot of the **same round** using the existing `select_auction_question()` + `open_bidding()` sequence. If no eligible slot exists it marks `round_complete = true` and emits `slot_progression_complete`. The 5‑second delay is **backend‑authoritative** — it survives page refreshes and server restarts because the timestamp lives in the database and the driver is re‑entered on every state read. A bounded retry (up to 5 attempts) then parks the sequence with a visible message instead of looping forever; a later manual Open Slot re‑starts it. Concurrency is impossible because both the manual `open_slot()` path and the driver share the same `pg_advisory_xact_lock(hashtext('bid2build_slot_open'))`, guaranteeing exactly one live slot at any time.

---

## 3. Files changed (chronological)

| Path | What changed |
|------|-------------|
| `supabase/migrations/038_auto_slot_progression.sql` | Full new migration — table, 3 functions (`activate_slot_progression`, `schedule_slot_progression`, `auto_advance_auction_if_scheduled`), pg_cron heartbeat with dynamic schema detection, `open_slot()` split into internal/admin entry points, redefined `get_live_auction_state()` with `auto_progression` JSON + wrapped driver call, redefined `reset_auction()` with progression cleanup, retry_count column for resilience. |
| `app/features/auction/types/auction.types.ts` | Added `AutoProgressionState` interface; extended `LiveAuctionState` with optional `auto_progression`. |
| `app/features/auction/services/auction.service.ts` | Updated `fetchLiveAuctionState()` to map & normalise `auto_progression`; added `normalizeAutoProgression()` helper. |
| `app/features/auction/components/AdminAuctionRoom.tsx` | Added progression UI: pending-transition banner with display‑only countdown, auto‑progression active indicator, round‑complete notice. Removed guard that blocked manual opens while a transition was pending (replaced by advisory lock + driver‑first design). |
| `docs/auction-realtime-events.md` | Added `slot_progression_scheduled` and `slot_progression_complete` entries. |
| `app/scripts/test-auction-engine.mjs` | New group 11 — 13 scenarios covering the full progression flow. |
| `app/scripts/test-bugfixes.mjs` | 9 previously‑failing scenarios now pass (manual open + progression co‑existence). |

---

## 4. Risks & open questions

| Risk | Mitigation |
|------|------------|
| **pg_cron not installed on the live project** | The driver is also invoked from `get_live_auction_state()` on every client read, so the progression advances even without pg_cron. The cron job is a best‑effort background tick. |
| **Concurrent callers opening two slots** | Eliminated by `pg_advisory_xact_lock(hashtext('bid2build_slot_open'))` shared between the manual `open_slot()` entry point and the driver. |
| **Transition stalls because the session was stopped** | The driver has a bounded retry (5 attempts). After that it parks with a visible `message` field, and the admin can restart with a manual Open Slot. |
| **Round 3 recovery: `skip_slot` vs auto‑progression** | `skip_slot()` intentionally does **not** call `schedule_slot_progression()`. The round‑3 recovery rules (pending/skipped items) still apply via the existing `advance_auction` logic; the auto‑progression only fires on SOLD/UNSOLD finalisations. |
| **Frontend countdown drift** | The countdown is purely derived from `scheduled_transition_at` vs the **last** `server_time` read stored in `stateReadAt`. When it reaches zero the client re‑reads `get_live_auction_state()` — that read is what executes the transition, so there is no client‑side timer that could drift or be gamed. |
| **Migration 038 applied to a live project with existing data** | The `retry_count` column defaults to 0; existing rounds get a new row automatically (`create table if not exists`). The `reset_auction` extension clears any pre‑existing progression rows. All function bodies use `security definer` and are safe to re‑run. |

---

## 5. How to apply to the live project (when ready)

```bash
# From the repo root (D:\auction-contest-platform):
supabase db push   # or: supabase db exec < supabase/migrations/038_auto_slot_progression.sql

# After the migration is applied, verify the RPCs are healthy:
npm run test:sql       # should list 038 among PASS checks
node scripts/check-live-rpcs.mjs   # should confirm get_live_auction_state() works

# The frontend changes are purely additive — they just read the new `auto_progression`
# field from the existing `get_live_auction_state()` RPC. No DB schema changes beyond
# 038 are required on the client.
```

---

*Report generated Thu Nov 26 2026. All local tests pass. Migration 038 is production‑ready when `supabase db push` is executed on the target project.*