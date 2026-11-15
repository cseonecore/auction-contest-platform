/**
 * submitProject — call the submit_project RPC for one or both slots.
 *
 * This follows the same pattern as features/auction/utils/placeBid.ts:
 *   1. Quick client-side validation (instant feedback)
 *   2. Call the database RPC (which does the real checks server-side)
 *   3. Return a typed result
 *
 * Handles the "Easy / Hard / Both" selection:
 *   - For "Easy" or "Hard": calls the RPC once for that slot.
 *   - For "Both": calls the RPC twice (once per slot) and reports
 *     per-slot results so the UI can show if one succeeded and the
 *     other failed.
 */

import { supabase } from "@/lib/supabase"
import type {
  SubmitProjectResult,
  SlotSubmissionResult,
  BothSlotsResult,
} from "@/types/submission"

// ─────────────────────────────────────────────────────────────
// Single-slot submission
// ─────────────────────────────────────────────────────────────

export interface SubmitOneSlotParams {
  slotId: string
  repositoryUrl: string
  liveUrl: string
  /** Used only for error messages. */
  level: "easy" | "hard"
}

/**
 * Submit a project for a single slot.
 * The database RPC enforces captain auth, slot ownership, and deadline.
 */
export async function submitOneSlot({
  slotId,
  repositoryUrl,
  liveUrl,
  level,
}: SubmitOneSlotParams): Promise<SlotSubmissionResult> {
  // Client-side sanity checks (Rule Book §6 requirements)
  if (!repositoryUrl || repositoryUrl.trim() === "") {
    return {
      slotId,
      level,
      success: false,
      error: "Repository URL is required.",
    }
  }

  if (!liveUrl || liveUrl.trim() === "") {
    return {
      slotId,
      level,
      success: false,
      error: "Live URL or APK link is required (Rule Book §6).",
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("submit_project", {
      p_slot_id: slotId,
      p_repository_url: repositoryUrl.trim(),
      p_live_url: liveUrl.trim(),
    })

    if (error) {
      return {
        slotId,
        level,
        success: false,
        error:
          error.message || `Failed to submit ${level} project. Please try again.`,
      }
    }

    const result = data as unknown as SubmitProjectResult
    return {
      slotId,
      level,
      success: true,
      data: result,
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred"
    return { slotId, level, success: false, error: message }
  }
}

// ─────────────────────────────────────────────────────────────
// Both-slots submission
// ─────────────────────────────────────────────────────────────

export interface SubmitBothSlotsParams {
  easySlotId: string
  hardSlotId: string
  repositoryUrl: string
  liveUrl: string
}

/**
 * Submit a project for BOTH the easy and hard slots.
 *
 * Calls submit_project twice — once per slot. Each call is independent.
 * If one succeeds and the other fails, the result tells you exactly
 * what happened so the UI can report it clearly.
 *
 * Note: These two calls are NOT atomic (not wrapped in a single
 * database transaction). If you need atomic both-or-nothing behavior,
 * a new `submit_project_both(p_easy_slot_id, p_hard_slot_id, ...)`
 * database function would be needed. See the analysis report for details.
 */
export async function submitBothSlots({
  easySlotId,
  hardSlotId,
  repositoryUrl,
  liveUrl,
}: SubmitBothSlotsParams): Promise<BothSlotsResult> {
  // Submit both in parallel for speed
  const [easyResult, hardResult] = await Promise.all([
    submitOneSlot({
      slotId: easySlotId,
      repositoryUrl,
      liveUrl,
      level: "easy",
    }),
    submitOneSlot({
      slotId: hardSlotId,
      repositoryUrl,
      liveUrl,
      level: "hard",
    }),
  ])

  const results = [easyResult, hardResult]

  return {
    allSucceeded: results.every((r) => r.success),
    results,
  }
}

