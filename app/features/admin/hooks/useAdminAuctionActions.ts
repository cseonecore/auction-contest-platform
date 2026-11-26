"use client";

import { useCallback, useMemo, useState } from "react";
import {
  adjustBiddingTimer,
  adjustSolvingTimer,
  advanceAuction,
  approveSubmission,
  clearTeamDQ,
  closeBidding,
  completeNextAuctionTransition,
  createAuctionTopic,
  eliminateTeam,
  endAuctionSession,
  finalizeAuction,
  grantBonusTime,
  openBidding,
  pauseAuction,
  pauseAuctionTimer,
  rejectSubmission,
  reopenSubmission,
  resetAuction,
  resumeAuction,
  resumeAuctionTimer,
  restoreTeam,
  selectAuctionQuestion,
  skipSlot,
  startAuction,
  setAuctionRound,
  finalizeRound3Eliminations,
  startAuctionTimer,
} from "@/features/admin/services/adminAuctionService";

export interface AdminAuctionActionState {
  pending: string | null;
  feedback: { type: "success" | "error"; message: string } | null;
}

export interface UseAdminAuctionActionsOptions {
  /** Re-read the authoritative state after a successful action. */
  onRefresh: () => void;
  /** The item that is currently live, if any. */
  activeSlotId?: string | null;
}

export function useAdminAuctionActions({
  onRefresh,
  activeSlotId,
}: UseAdminAuctionActionsOptions) {
  const [actionState, setActionState] = useState<AdminAuctionActionState>({
    pending: null,
    feedback: null,
  });

  const run = useCallback(
    async (key: string, fn: () => Promise<{ success: boolean; error?: string }>, successMessage: string) => {
      if (actionState.pending) return false;

      setActionState({ pending: key, feedback: null });

      try {
        const result = await fn();
        if (!result.success) {
          setActionState({
            pending: null,
            feedback: { type: "error", message: result.error ?? "The action failed." },
          });
          return false;
        }

        setActionState({ pending: null, feedback: { type: "success", message: successMessage } });
        onRefresh();
        return true;
      } catch (err: unknown) {
        setActionState({
          pending: null,
          feedback: {
            type: "error",
            message: err instanceof Error ? err.message : "The action failed.",
          },
        });
        return false;
      }
    },
    [actionState.pending, onRefresh]
  );

  const actions = useMemo(
    () => ({
      start: () =>
        run("start", () => startAuction(1), "Auction session started."),

      selectQuestion: (slotId: string) =>
        run(
          "select",
          () => selectAuctionQuestion(slotId),
          "Problem statement selected and published."
        ),

      openBidding: (slotId?: string | null) =>
        run(
          "open",
          () => openBidding(slotId ?? activeSlotId ?? null),
          "Bidding is open."
        ),

      closeBidding: (slotId?: string | null) =>
        run(
          "close",
          () => closeBidding(slotId ?? activeSlotId ?? null),
          "Bidding closed and the result recorded."
        ),

      finalize: (slotId?: string | null) =>
        run(
          "finalize",
          () => finalizeAuction(slotId ?? activeSlotId ?? null),
          "Auction finalised."
        ),

      advance: () =>
        run("advance", () => advanceAuction(), "Advanced to the next auction item."),

      completeNextTransition: () =>
        run(
          "complete-next",
          () => completeNextAuctionTransition(),
          "Next auction slot opened after delay."
        ),

      skip: (slotId: string) =>
        run("skip", () => skipSlot(slotId), "Item skipped."),

      pause: () => run("pause", () => pauseAuction(), "Auction paused."),

      resume: () => run("resume", () => resumeAuction(), "Auction resumed."),

      end: () =>
        run("end", () => endAuctionSession(), "Auction session completed."),

      reset: () =>
        run("reset", () => resetAuction(), "Auction reset — bids, ledger and wallets restored."),

      setRound: (round: 1 | 2 | 3) =>
        run("round", () => setAuctionRound(round), `Auction transitioned to Round ${round}.`),

      finalizeEliminations: () =>
        run(
          "finalize-eliminations",
          () => finalizeRound3Eliminations(),
          "Contest qualifications and eliminations finalized after Round 3."
        ),

      startTimer: (seconds?: number) =>
        run("timer-start", () => startAuctionTimer(seconds), "Solving timer started."),

      pauseTimer: () => run("timer-pause", () => pauseAuctionTimer(), "Solving timer paused."),

      resumeTimer: () => run("timer-resume", () => resumeAuctionTimer(), "Solving timer resumed."),

      extendBidding: (seconds: number) =>
        run(
          "timer-extend",
          () => adjustBiddingTimer(seconds, activeSlotId ?? null, "admin"),
          `Bidding clock extended by ${seconds}s.`
        ),

      extendSolving: (seconds: number) =>
        run(
          "solving-extend",
          () => adjustSolvingTimer(seconds, "admin"),
          `Solving clock extended by ${seconds}s.`
        ),

      eliminate: (teamId: string, reason: string) =>
        run(
          "eliminate",
          () => eliminateTeam(teamId, reason, "manual"),
          "Team eliminated."
        ),

      restore: (teamId: string) =>
        run("restore", () => restoreTeam(teamId), "Team restored."),

      clearDQ: (teamId: string) =>
        run("clear-dq", () => clearTeamDQ(teamId), "Team disqualification cleared."),

      grantBonus: (submissionId: string, reason?: string) =>
        run(
          "bonus",
          () => grantBonusTime(submissionId, reason),
          "Bonus time granted and the clock extended."
        ),

      approve: (
        submissionId: string,
        score: number,
        notes: string,
        grantBonus: boolean
      ) =>
        run(
          "approve",
          () => approveSubmission(submissionId, score, notes, grantBonus),
          "Solution approved and scored."
        ),

      reject: (submissionId: string, reason?: string) =>
        run(
          "reject",
          () => rejectSubmission(submissionId, reason),
          "Submission marked rejected."
        ),

      reopen: (submissionId: string, notes?: string) =>
        run(
          "reopen",
          () => reopenSubmission(submissionId, notes),
          "Submission reopened for participant edits."
        ),

      createTopic: (values: {
        title: string;
        description?: string;
        level: "easy" | "hard";
        startingBid?: number;
      }) => run("topic", () => createAuctionTopic(values), "Problem statement created."),
    }),
    [run, activeSlotId]
  );

  return {
    ...actions,
    pending: actionState.pending,
    feedback: actionState.feedback,
    clearFeedback: () => setActionState((prev) => ({ ...prev, feedback: null })),
  };
}
