"use client";

import React from "react";
import { Loader2, Coins, ArrowRight, X } from "lucide-react";

interface BidConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentHighestBid: number;
  proposedBid: number;
  currentBalance: number;
  isSubmitting: boolean;
}

export function BidConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  currentHighestBid,
  proposedBid,
  currentBalance,
  isSubmitting,
}: BidConfirmationModalProps) {
  if (!isOpen) return null;

  const remainingBalance = Math.max(0, currentBalance - proposedBid);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in select-none">
      <div className="relative w-full max-w-md rounded-3xl bg-[#1c1d22] border border-zinc-700/80 p-6 sm:p-7 text-center shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon & Title */}
        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-orange-500/20 text-[#ff5500] flex items-center justify-center font-bold">
          <Coins className="w-6 h-6" />
        </div>
        <h3 className="text-xl font-black text-white tracking-tight">
          Confirm Your Bid
        </h3>
        <p className="text-xs text-zinc-400 mt-1">
          Review your proposed bid amount before dispatching to the auction network.
        </p>

        {/* Breakdown Card */}
        <div className="mt-5 space-y-2.5 p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 text-left text-xs sm:text-sm">
          <div className="flex items-center justify-between text-zinc-400">
            <span>Current Highest Bid</span>
            <span className="font-bold text-white font-mono">{currentHighestBid} coins</span>
          </div>

          <div className="flex items-center justify-between text-zinc-400">
            <span>Your Proposed Bid</span>
            <span className="font-black text-[#ff5500] text-base font-mono">
              {proposedBid} coins
            </span>
          </div>

          <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-zinc-400">
            <span>Your Current Wallet</span>
            <span className="font-bold text-zinc-200 font-mono">{currentBalance} coins</span>
          </div>

          <div className="flex items-center justify-between text-zinc-400">
            <span>Balance If Won</span>
            <span
              className={`font-black font-mono ${
                remainingBalance < 10 ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {remainingBalance} coins
            </span>
          </div>
        </div>

        <p className="text-[11px] text-zinc-400 mt-3 text-left">
          Note: Coins are deducted only if your team closes as the final winning bidder on this slot.
        </p>

        {/* Action Buttons */}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-xl bg-[#ff5500] hover:bg-[#e64d00] text-white font-black text-sm shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Placing Bid...</span>
              </>
            ) : (
              <>
                <span>Confirm Bid</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
