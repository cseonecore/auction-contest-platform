"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { BidConfirmationModal } from "./BidConfirmationModal";

interface ParticipantBiddingPanelProps {
  slotId: string | null;
  slotStatus: string;
  currentBid: number;
  leadingTeamName: string | null;
  isLeader: boolean;
  walletBalance: number;
  hasWonRound: boolean;
  minBid?: number;
  minRaise?: number;
  onBidSubmit: (amount: number) => Promise<{ success: boolean; error?: string }>;
}

export function ParticipantBiddingPanel({
  slotId,
  slotStatus,
  currentBid,
  leadingTeamName,
  isLeader,
  walletBalance,
  hasWonRound,
  minBid = 10,
  minRaise = 10,
  onBidSubmit,
}: ParticipantBiddingPanelProps) {
  // Base required bid according to backend rules
  const baseNextBid = currentBid === 0 ? minBid : currentBid + minRaise;

  // Selected increment (default: 0 or +10)
  const [selectedIncrement, setSelectedIncrement] = useState<number>(0);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Proposed bid calculation
  const proposedBid = baseNextBid + selectedIncrement;

  // Validation
  const isOpen = slotStatus === "open";
  const canAfford = walletBalance >= proposedBid;
  const isValidBid = isOpen && !isLeader && !hasWonRound && canAfford && proposedBid >= baseNextBid;

  const getDisabledReason = (): string | null => {
    if (!isOpen) return "Auction slot is currently closed.";
    if (isLeader) return "Your team is already leading this slot.";
    if (hasWonRound) return "Your team has already won a slot in this round.";
    if (!canAfford) return `Insufficient coins (${walletBalance} available, ${proposedBid} required).`;
    return null;
  };

  const disabledReason = getDisabledReason();

  const handleIncrementClick = (inc: number) => {
    setFeedbackError(null);
    if (selectedIncrement === inc) {
      // Toggle off
      setSelectedIncrement(0);
    } else {
      setSelectedIncrement(inc);
    }
  };

  const handleOpenConfirm = () => {
    if (!isValidBid) return;
    setFeedbackError(null);
    setIsConfirmOpen(true);
  };

  const handleExecuteBid = async () => {
    setIsSubmitting(true);
    setFeedbackError(null);
    try {
      const res = await onBidSubmit(proposedBid);
      if (res.success) {
        setIsConfirmOpen(false);
        setSelectedIncrement(0);
      } else {
        setFeedbackError(res.error || "Failed to place bid. Please try again.");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setFeedbackError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full select-none">
      {/* 2x2 Large Rounded Square Buttons matching Figma Screenshot 3 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5">
        {[
          { label: "+10", value: 10 },
          { label: "+5", value: 5 },
          { label: "+3", value: 3 },
          { label: "+1", value: 1 },
        ].map(({ label, value }) => {
          const isSelected = selectedIncrement === value;
          return (
            <button
              key={label}
              type="button"
              disabled={!isOpen || isLeader || hasWonRound}
              onClick={() => handleIncrementClick(value)}
              className={`h-24 sm:h-28 rounded-2xl flex items-center justify-center font-black text-3xl sm:text-4xl transition-all duration-150 cursor-pointer shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                isSelected
                  ? "bg-[#fe5102] text-white ring-4 ring-[#fe5102]/30 scale-[0.98]"
                  : "bg-[#33353b] hover:bg-[#3d3f47] text-white active:scale-95 border border-zinc-700/60"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Bid Calculation Summary Bar */}
      <div className="mt-3.5 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs flex items-center justify-between text-zinc-300">
        <div>
          <span className="text-zinc-500 block text-[10px] uppercase font-bold tracking-wider">
            Minimum Next Bid
          </span>
          <span className="font-bold text-white font-mono">{baseNextBid} coins</span>
        </div>

        <div className="text-center">
          <span className="text-zinc-500 block text-[10px] uppercase font-bold tracking-wider">
            Selected Raise
          </span>
          <span className="font-bold text-[#fe5102] font-mono">
            {selectedIncrement > 0 ? `+${selectedIncrement}` : "Standard"}
          </span>
        </div>

        <div className="text-right">
          <span className="text-zinc-500 block text-[10px] uppercase font-bold tracking-wider">
            Proposed Bid
          </span>
          <span className="font-black text-emerald-400 text-sm sm:text-base font-mono">
            {proposedBid} coins
          </span>
        </div>
      </div>

      {/* Feedback error alert if any */}
      {feedbackError && (
        <div className="mt-2.5 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs text-center font-medium">
          {feedbackError}
        </div>
      )}

      {/* Place Bid Action Button */}
      <div className="mt-3">
        <button
          type="button"
          disabled={!isValidBid || isSubmitting}
          onClick={handleOpenConfirm}
          className={`w-full py-3.5 px-4 rounded-xl font-black text-sm tracking-wide shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed ${
            isValidBid
              ? "bg-[#fe5102] hover:bg-[#d94502] active:scale-[0.99] text-white shadow-orange-500/25"
              : "bg-zinc-800 text-zinc-500 border border-zinc-700/40"
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Placing Bid...</span>
            </>
          ) : (
            <span>
              {disabledReason ? disabledReason : `Place Bid • ${proposedBid} Coins`}
            </span>
          )}
        </button>
      </div>

      {/* Confirmation Dialog */}
      <BidConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleExecuteBid}
        currentHighestBid={currentBid}
        proposedBid={proposedBid}
        currentBalance={walletBalance}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
