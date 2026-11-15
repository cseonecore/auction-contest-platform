/**
 * Submission-specific TypeScript types.
 *
 * These augment the raw database row types with joined/derived shapes
 * used by the submission hooks and (eventually) the submission UI.
 *
 * Follows the same pattern as @/types/auction.ts.
 */

import type {
  SubmissionRow,
  EvaluationRow,
  EvalUpdateRow,
  SlotRow,
  TopicRow,
  ChallengeProblemRow,
} from "./database"

// ─────────────────────────────────────────────────────────────
// Won slot: a slot this team won in the auction, with its topic
// ─────────────────────────────────────────────────────────────

/** A slot that the team won, enriched with its topic info. */
export type WonSlot = Pick<
  SlotRow,
  "id" | "topic_id" | "round" | "status" | "winner_team_id"
> & {
  topic: Pick<TopicRow, "id" | "level" | "title" | "description">
}

// ─────────────────────────────────────────────────────────────
// Submission with related data
// ─────────────────────────────────────────────────────────────

/** Submission joined with its slot and topic. */
export type SubmissionWithSlot = SubmissionRow & {
  slot: Pick<SlotRow, "id" | "topic_id" | "round"> & {
    topic: Pick<TopicRow, "id" | "level" | "title">
  }
}

// ─────────────────────────────────────────────────────────────
// RPC return types
// ─────────────────────────────────────────────────────────────

/** Returned by submit_project() RPC. */
export interface SubmitProjectResult {
  success: boolean
  submission_id: string
  slot_id: string
  team_id: string
  status: "queued"
  deadline: string
}

/** Result for a single slot when the user selects "Easy", "Hard", or "Both". */
export interface SlotSubmissionResult {
  slotId: string
  level: "easy" | "hard"
  success: boolean
  data?: SubmitProjectResult
  error?: string
}

/** Combined result when submitting for both slots. */
export interface BothSlotsResult {
  /** Did ALL attempted slot submissions succeed? */
  allSucceeded: boolean
  results: SlotSubmissionResult[]
}

/** Returned by record_solve() (service-role only). */
export interface RecordSolveResult {
  success: boolean
  reason?: string
  solve_id?: string
  solve_number?: number
  bonus_minutes?: number
  new_deadline?: string
  solve_count?: number
}

// ─────────────────────────────────────────────────────────────
// Challenge problems — browser-safe (no test_cases)
// ─────────────────────────────────────────────────────────────

/**
 * A challenge problem as seen from the browser.
 * The test_cases column is hidden by column-level security.
 */
export type SafeChallengeProblem = Omit<ChallengeProblemRow, "test_cases">

/** A problem with its solved status for the current team. */
export type ProblemWithStatus = SafeChallengeProblem & {
  solved: boolean
  solved_at: string | null
}

// ─────────────────────────────────────────────────────────────
// Evaluation status
// ─────────────────────────────────────────────────────────────

/** Evaluation joined with its progress updates. */
export type EvaluationWithUpdates = EvaluationRow & {
  updates: EvalUpdateRow[]
}

/** Full evaluation state for a single submission. */
export type SubmissionEvaluation = {
  submission: SubmissionRow
  evaluation: EvaluationWithUpdates | null
}

// ─────────────────────────────────────────────────────────────
// Deadline
// ─────────────────────────────────────────────────────────────

export interface TeamDeadlineState {
  /** The computed deadline (base + bonus). ISO string. */
  deadline: string | null
  /** Milliseconds remaining until the deadline. Negative = expired. */
  msRemaining: number
  /** True if the deadline has passed. */
  isExpired: boolean
  /** Number of challenge solves contributing to bonus time. */
  solveCount: number
  /**
   * Total bonus minutes earned.
   * null = cannot be computed on the client (settings table is admin-only).
   * The `deadline` from the RPC is always authoritative regardless.
   */
  bonusMinutes: number | null
  loading: boolean
  error: string | null
}

// ─────────────────────────────────────────────────────────────
// Judge API types (for the /api/challenge/judge route)
// ─────────────────────────────────────────────────────────────

/** Request body sent to POST /api/challenge/judge */
export interface JudgeRequest {
  problem_id: string
  solution_code: string
  language: string
}

/** Response from POST /api/challenge/judge */
export interface JudgeResponse {
  success: boolean
  /** Human-readable status message */
  message: string
  /** If solved, the solve details */
  solve?: {
    solve_number: number
    bonus_minutes: number
    new_deadline: string
  }
  /** If failed, which test cases failed (indices only, no answers) */
  failed_tests?: number[]
}

