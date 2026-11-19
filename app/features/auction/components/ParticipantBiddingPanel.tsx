"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { BidConfirmationModal } from "./BidConfirmationModal";
import { validateBid } from "../utils/bid-validation";

interface ParticipantBiddingPanelProps {
  slotId: string | null;
  slotStatus: string;
  currentBid: number;
  leadingTeamName: string | null;
  isLeader: boolean;
  walletBalance: number;
  hasWonRound?: boolean;
  wonCount?: number;
  currentRound?: number;
  minBid?: number;
  minRaise?: number;
  isCaptain?: boolean;
  eliminated?: boolean;
  paused?: boolean;
  /** The client countdown reached zero (advisory — never blocks an open item). */
  timerExpired?: boolean;
  /** No active auction session exists (advisory — never blocks an open item). */
  sessionActive?: boolean;
  onBidSubmit: (amount: number) => Promise<{ success: boolean; error?: string }>;
}

export function ParticipantBiddingPanel({
  slotId: _slotId,
  slotStatus,
  currentBid,
  leadingTeamName: _leadingTeamName,
  isLeader,
  walletBalance,
  hasWonRound = false,
  wonCount = 0,
  currentRound = 1,
  minBid = 10,
  minRaise = 5,
  isCaptain = true,
  eliminated = false,
  paused = false,
  timerExpired = false,
  sessionActive,
  onBidSubmit,
}: ParticipantBiddingPanelProps) {
  // Base required bid according to backend rules
  const baseNextBid = currentBid === 0 ? minBid : currentBid + minRaise;

  // Selected increment preset or custom total bid
  const [selectedIncrement, setSelectedIncrement] = useState<number>(0);
  const [customBidInput, setCustomBidInput] = useState<string>("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Proposed bid calculation
  const parsedCustom = customBidInput.trim() !== "" ? parseInt(customBidInput.trim(), 10) : NaN;
  const isCustom = !isNaN(parsedCustom) && parsedCustom > 0;
  const proposedBid = isCustom ? parsedCustom : baseNextBid + selectedIncrement;

  // Wallet check
  const walletCapExceeded = proposedBid > walletBalance;

  // Validation — mirrors the rules enforced by place_bid() in PostgreSQL.
  const validation = validateBid({
    currentBid,
    minBid,
    minRaise,
    walletBalance,
    isLeader,
    hasWonRound,
    wonCount,
    currentRound,
    isCaptain,
    slotStatus,
    eliminated,
    paused,
    timerExpired,
    sessionActive,
  });

  const isValidBid =
    validation.canBid &&
    proposedBid >= validation.minNextBid &&
    !walletCapExceeded;

  const getDisabledReason = (): string | null => {
    if (!validation.canBid) return validation.reason ?? null;
    if (proposedBid < validation.minNextBid) {
      return `The minimum bid is ${validation.minNextBid} points.`;
    }
    if (walletCapExceeded) {
      return `Insufficient balance — your wallet has ${walletBalance} coins.`;
    }
    return null;
  };

  const disabledReason = getDisabledReason();

  const handleIncrementClick = (inc: number) => {
    setFeedbackError(null);
    setCustomBidInput(""); // Clear custom input when using presets
    if (selectedIncrement === inc) {
      // Toggle off
      setSelectedIncrement(0);
    } else {
      setSelectedIncrement(inc);
    }
  };

  const handleCustomBidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFeedbackError(null);
    setSelectedIncrement(0); // Clear preset when typing custom bid
    setCustomBidInput(e.target.value);
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
        setCustomBidInput("");
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
      {/* 2x2 Large Rounded Square Buttons: +20, +15, +10, +5 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5">
        {[
          { label: "+20", value: 20 },
          { label: "+15", value: 15 },
          { label: "+10", value: 10 },
          { label: "+5", value: 5 },
        ].map(({ label, value }) => {
          const isSelected = !isCustom && selectedIncrement === value;
          return (
            <button
              key={label}
              type="button"
              disabled={!validation.canBid || baseNextBid + value > walletBalance}
              onClick={() => handleIncrementClick(value)}
              className={`h-20 sm:h-24 rounded-2xl flex items-center justify-center font-black text-2xl sm:text-3xl transition-all duration-150 cursor-pointer shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${
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

      {/* Custom Total Bid Input */}
      <div className="mt-3">
        <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
          Or Enter Custom Total Bid
        </label>
        <div className="relative">
          <input
            type="number"
            min={baseNextBid}
            max={walletBalance}
            step={1}
            value={customBidInput}
            onChange={handleCustomBidChange}
            disabled={!validation.canBid}
            placeholder={`Minimum ${baseNextBid} coins`}
            className="w-full px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-900/90 text-white font-mono font-bold text-sm focus:outline-none focus:ring-2 focus:ring-[#fe5102] placeholder:text-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-zinc-500">
            COINS
          </span>
        </div>
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
            {isCustom ? "Custom" : selectedIncrement > 0 ? `+${selectedIncrement}` : "Standard (+5)"}
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
