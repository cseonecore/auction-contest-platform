"use client";

import React from "react";
import { X, BookOpen, CheckCircle, ShieldAlert } from "lucide-react";

interface ContestRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ContestRulesModal({ isOpen, onClose }: ContestRulesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in select-none">
      <div className="relative w-full max-w-xl rounded-3xl bg-[#1c1d22] border border-zinc-700/80 p-6 sm:p-8 text-left shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 text-[#ff5500] flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">
                Contest Rules &amp; Bidding Protocol
              </h3>
              <p className="text-xs text-zinc-400">
                Official Bid2Build Rule Book v1.0 • Section 5
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Rules Content */}
        <div className="space-y-4 text-xs sm:text-sm text-zinc-300">
          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold mb-0.5">
                Unified 100-Coin Wallet (§5.1)
              </strong>
              Each team starts with 100 virtual coins for the entire auction. Bids placed do not freeze or deduct your wallet during active bidding. Wallet deduction happens ONLY when your team wins a problem slot. Losing bids cost nothing.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold mb-0.5">
                Opening Window &amp; Dynamic Timer Extension (§5.2)
              </strong>
              When an auction slot opens, a 10-second opening window begins. Each valid bid extends the countdown clock by 5 seconds. If the timer reaches 0 without a bid, the slot is marked UNSOLD.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold mb-0.5">
                Minimum Bid &amp; Raise Increment (§5.3)
              </strong>
              The opening minimum bid is 10 coins. Every subsequent raise must be at least 10 coins higher than the current leading bid.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold mb-0.5">
                One Slot Per Round Quota (§5.3)
              </strong>
              Each team is restricted to winning exactly ONE problem statement per round (Round 1: Easy, Round 2: Hard). Once your team wins a slot in a round, your bidding is automatically locked for that round.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold mb-0.5">
                No Self-Outbidding (§5.3)
              </strong>
              Teams cannot bid against their own leading bid. The signed-in team account places bids on behalf of its team.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold mb-0.5">
                Unspent Coin Bonus Evaluation (§9.8)
              </strong>
              Coins remaining unspent in your wallet after both rounds earn bonus contest points (1 bonus point per 3 unspent coins). Spend strategically!
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-full bg-[#ff5500] hover:bg-[#e64d00] text-white font-bold text-sm shadow-md transition-all cursor-pointer"
          >
            I Understand the Rules
          </button>
        </div>
      </div>
    </div>
  );
}
