/**
 * Team development timer state, as returned by the public.get_team_dev_status()
 * RPC (migration 028). Shared by the participant profile route, the submit
 * portal gate, and the admin dashboards.
 */
export type TeamDevTimerStatus = 'not_started' | 'running' | 'finished';

export interface TeamDevStatus {
  team_id: string;
  /** Epoch millis when the central timer started; null while not started. */
  dev_timer_started_at_ms: number | null;
  /** Effective add-on seconds: teams.dev_addon_seconds ?? admin_dev_addon_seconds. */
  dev_addon_seconds: number | null;
  /** Per-team duration in seconds: base + effective add-on + earned bonus. */
  dev_timer_total_seconds: number;
  /** Remaining seconds until the personal deadline (never negative). */
  dev_timer_remaining_seconds: number;
  dev_timer_status: TeamDevTimerStatus;
  /** Personal deadline = dev_timer_started_at + duration. */
  dev_deadline: string | null;
  /** Final 20-minute submission window opens here (= deadline − 1200s). */
  submission_opens_at: string | null;
  /** Set once by apply_dq_statuses(); idempotent. */
  dq_at: string | null;
  /** True when the deadline passed without a valid submission. */
  dq_pending: boolean;
  /** True when the team has at least one recorded submission. */
  has_submission: boolean;
  /** True while now >= submission_opens_at && now <= dev_deadline. */
  submission_window_open: boolean;
  /** Server clock used by all window math. */
  server_time: string | null;
}
