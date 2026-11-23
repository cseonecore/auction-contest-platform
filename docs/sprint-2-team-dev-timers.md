# Sprint 2 Report — Team Development Timers, Submission Windows & DQ

**Contest:** Bid2Build — Auction Contest Platform
**Sprint:** 2
**Date:** 2026-11-22
**Status:** Complete (migration 028 + frontend + tests)

---

## Objective

Upgrade the global timer/submission system into team-specific development and
submission deadlines with automatic DQ (Sprint 1). Per team:
`dev_timer_total = base(4500s) + effective_addon + earned bonus` where
`effective_addon = COALESCE(teams.dev_addon_seconds, admin_dev_addon_seconds)`
and deadline = `dev_timer_started_at + duration`. Per-team submission window
opens at `deadline − 20 min`; early submissions are rejected unless the portal
was manually enabled, post-deadline submissions are rejected, and DQ is marked
idempotently when there is no valid submission before the deadline.

## Completed

### Backend (migration 028 — `supabase/migrations/028_team_dev_timers.sql`)
- Columns: `teams.dev_addon_seconds integer`, `teams.dq_at timestamptz`.
- RPCs: `get_team_dev_duration_seconds`, `get_team_dev_deadline`,
  `apply_dq_statuses` (idempotent), `set_team_dev_addon_seconds`
  (safe rule: no shortening when the team has a submission),
  `get_team_dev_status` (auto-applies DQ: `dq_pending` flag included).
- Fixed double-count bug in `get_bidding_results()` (026 redefinition):
  `total_base = v_base`, `total_addon = duration − base` (add-on + bonus),
  `total_dev = duration`.
- Smoke 028: duration 75/90/105/120 (base + addon + bonus), timer running,
  window open/closed transitions, DQ idempotent, add-on sync — all PASS.
  `tmp-smoke-028.mjs` is the smoke script.

### Backend enforcement
- `POST /app/api/submission`: after auth, calls `get_team_dev_status` —
  rejects when `dq_at` set (403), rejects when server-time > `dev_deadline`
  (403, "late submissions are rejected"), rejects new submissions when the
  final 20-minute window is closed, unless the global manual override is
  active (`submissions_manually_enabled`). `submitted_at` uses the server
  time from the contest flow state when present. Existing submissions remain
  editable while valid (not DQ'd).
- `GET /app/api/team/profile`: returns per-team timer fields —
  `dev_timer_status/total_seconds/remaining_seconds/started_at_ms`,
  `dev_deadline`, `submission_opens_at`, `dq_at`, `dq_pending`,
  `dev_timer_window_open` (derived from `get_team_dev_status`).

### Frontend — `/profile` (participants)
- New "Development Timer" card: live remaining countdown (5s tick), total,
  deadline, submission window status, and a DQ notice when `dq_at` is set.
- CSV export for submissions on `/submit` ("Download Submissions CSV").

### Frontend — `/submit` (participants)
- Client gate mirrors the server: disables submit + shows notice when DQ'd,
  when the window is closed early (and not manually overridden), or when the
  deadline passed; server route rejects the same cases.

### Frontend — Admin `/admin/submissions`
- New **"Team Dev Timers" panel** (`features/admin/components/TeamDevTimersPanel.tsx`):
  roster from `get_bidding_results()` + live `get_team_dev_status()` per team;
  columns: Team, Duration, Add-on, Timer status, Remaining, Submission Window
  status, Deadline, Submission status, DQ status; poll every 30s. Polls via
  `contestFlowService.getTeamDevStatus()` / `getTeamDevStatuses()`.
- New **"Export CSV"** button on the dashboard — uses the shared
  `buildSubmissionCsvRows` / `downloadSubmissionCsv` (8 fields).
- Status panel shows per-team duration, addon, timer status, remaining,
  window status, deadline, submission status, DQ and manual/auto source.

### Shared types & utils
- `app/types/database.ts`: `teams` Row/Insert/Update now include
  `dev_addon_seconds`, `dq_at`; Functions map extended with the 028 RPC
  signatures used by supabase-js.
- `app/types/teamDev.ts`: shared `TeamDevStatus` interface.
- `app/features/submission/utils/submissionCsv.ts`: 8-field CSV row model,
  `buildSubmissionCsvRow(s)`, `submissionCsvText`, `downloadSubmissionCsv`.
- `app/features/admin/services/contestFlowService.ts`:
  `getTeamDevStatus(teamId)`, `getTeamDevStatuses(teamIds)`.
- `app/features/admin/services/registrationService.ts`: selects + passes
  through the new teams columns.

### Tests
- `app/tests/submissionCsv.test.ts` — 7 vitest scenarios (8-field contract,
  row mapping, CSV header/columns, quoting rules, empty list).
- Verification: smoke 028 PASS, `test:sql` PASS, `vitest` 55/55 PASS,
  `test:engine` 53/53 PASS, `test:bugfixes` 45/45 PASS, `tsc --noEmit` OK,
  `next build` OK, `lint` 0 errors (109 pre-existing warnings).

## Active

- None (Sprint 2 complete).

## Blocked

- None.

## Next Move

- Watch live DQ behavior in contest time (smoke uses time offsets).
- Consider per-team manual submission enable when needed.

## Relevant Files

- `supabase/migrations/028_team_dev_timers.sql` (columns, helpers, RPCs)
- `supabase/migrations/027_contest_flow.sql`, `supabase/migrations/026_admin_dev_addon_and_top25_locks.sql`
- `app/app/api/submission/route.ts` (POST gate, `submitted_at` server-time)
- `app/app/api/team/profile/route.ts` (timer fields)
- `app/app/profile/page.tsx` (timer card + DQ)
- `app/app/submit/page.tsx` (gate + CSV export)
- `app/app/admin/submissions/page.tsx` (export button + panel)
- `app/features/admin/components/TeamDevTimersPanel.tsx` (new)
- `app/features/admin/services/contestFlowService.ts`
- `app/features/submission/utils/submissionCsv.ts` (new)
- `app/types/teamDev.ts` (new), `app/types/database.ts`,
  `app/features/admin/services/registrationService.ts`
- `app/tests/submissionCsv.test.ts` (new)
- `app/scripts/tmp-smoke-028.mjs` (smoke)
- `docs/sprint-2-team-dev-timers.md` (this report)

## Deployment note (admin controls fix)

The live project (`qqbuauryvhgssmmxiiuh`) is missing migrations 026–028, so the
contest-flow RPCs (`get_contest_flow_state`, `start_dev_timer`,
`reset_dev_timer`, `enable_submissions`, `get_team_dev_status`,
`get_admin_dev_time_config`) return `PGRST202`. Apply, in order:

1. `supabase/migrations/026_admin_dev_addon_and_top25_locks.sql`
2. `supabase/migrations/027_contest_flow.sql`
3. `supabase/migrations/028_team_dev_timers.sql`

Until then the admin panel falls back to direct `settings` reads and writes
(admin RLS still enforced) and shows a warning banner. The participant
submission gate (`app/app/api/submission/route.ts`) calls
`get_team_dev_status()` and fails closed, so submissions stay blocked until 028
is applied.
