"use client";

/**
 * Admin auction service.
 *
 * Every administrative action is a call to a SECURITY DEFINER engine
 * function that performs its own authorisation check inside
 * PostgreSQL. There is deliberately no direct table write anywhere in
 * this file — the admin UI can never set the auction status or move
 * a wallet by itself.
 */

import { supabase } from "@/lib/supabase";

export interface AdminActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function toMessage(error: { message?: string } | null): string {
  if (!error) return "Unknown error";
  return (error.message || "Unknown error").trim();
}

async function call<T>(
  fn: string,
  args: Record<string, unknown> = {}
): Promise<AdminActionResult<T>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)(fn, args);

    if (error) {
      return { success: false, error: toMessage(error) };
    }

    return { success: true, data: data as T };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "The action could not be completed",
    };
  }
}

// ── Session lifecycle ────────────────────────────────────────────
export const startAuction = (round: 1 | 2 = 1) =>
  call("start_auction", { p_round: round });

export const selectAuctionQuestion = (slotId: string) =>
  call("select_auction_question", { p_slot_id: slotId });

export const openBidding = (slotId?: string | null) =>
  call("open_bidding", { p_slot_id: slotId ?? null });

export const closeBidding = (slotId?: string | null) =>
  call("close_bidding", { p_slot_id: slotId ?? null });

export const finalizeAuction = (slotId?: string | null) =>
  call("finalize_auction", { p_slot_id: slotId ?? null });

export const advanceAuction = () => call("advance_auction");

export const skipSlot = (slotId: string) =>
  call("skip_slot", { p_slot_id: slotId });

export const pauseAuction = () => call("pause_auction");

export const resumeAuction = () => call("resume_auction");

export const endAuctionSession = () => call("end_auction_session");

export const resetAuction = () => call("reset_auction");

// ── Timers ───────────────────────────────────────────────────────
export const startAuctionTimer = (seconds?: number) =>
  call("start_auction_timer", { p_seconds: seconds ?? null });

export const pauseAuctionTimer = () => call("pause_auction_timer");

export const resumeAuctionTimer = () => call("resume_auction_timer");

/** Extends the bidding clock of the live auction item. */
export const adjustBiddingTimer = (seconds: number, slotId?: string | null, reason?: string) =>
  call("adjust_bidding_timer", {
    p_seconds: Math.floor(seconds),
    p_slot_id: slotId ?? null,
    p_reason: reason ?? "admin",
  });

/** Extends the solving clock that bonus time also extends. */
export const adjustSolvingTimer = (seconds: number, reason?: string) =>
  call("adjust_auction_timer", {
    p_seconds: Math.floor(seconds),
    p_reason: reason ?? "admin",
  });

// ── Teams ────────────────────────────────────────────────────────
export const eliminateTeam = (teamId: string, reason: string, rule = "manual") =>
  call("eliminate_team", {
    p_team_id: teamId,
    p_reason: reason,
    p_rule: rule,
  });

export const restoreTeam = (teamId: string, note?: string) =>
  call("restore_team", { p_team_id: teamId, p_note: note ?? null });

export const fetchEliminationHistory = () => call("get_elimination_history");

// ── Judging & bonus ──────────────────────────────────────────────
export const approveSubmission = (
  submissionId: string,
  score: number,
  notes?: string,
  grantBonus = true
) =>
  call("approve_submission", {
    p_submission_id: submissionId,
    p_score: score,
    p_notes: notes ?? null,
    p_grant_bonus: grantBonus,
  });

export const grantBonusTime = (submissionId: string, reason?: string) =>
  call("grant_bonus_time", {
    p_submission_id: submissionId,
    p_reason: reason ?? null,
  });

export const fetchBonusHistory = () => call("get_bonus_history");

// ── Topics ───────────────────────────────────────────────────────
export const createAuctionTopic = (values: {
  title: string;
  description?: string;
  level: "easy" | "hard";
  startingBid?: number;
  criterion?: unknown;
}) =>
  call("create_auction_topic", {
    p_title: values.title,
    p_description: values.description ?? null,
    p_level: values.level,
    p_starting_bid: values.startingBid ?? null,
    p_criterion: (values.criterion ?? null) as never,
    p_slots_count: 1,
  });
