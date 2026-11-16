"use client";

import React, { useState } from "react";
import { Clock } from "lucide-react";

interface AuctionTimerControlProps {
  /** Remaining seconds on the bidding clock (derived from the server deadline). */
  biddingSecondsLeft: number;
  /** Remaining seconds on the solving clock. */
  solvingSecondsLeft: number;
  biddingTimerStatus: string;
  solvingTimerStatus: string;
  pausedRemainingSeconds: number;
  pending: string | null;
  onExtendBidding: (seconds: number) => void;
  onExtendSolving: (seconds: number) => void;
  onStartTimer: () => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
}

function format(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Timer control.
 *
 * The clocks themselves are authoritative in PostgreSQL; these buttons
 * only ask the backend to extend, pause or resume them.
 */
export function AuctionTimerControl({
  biddingSecondsLeft,
  solvingSecondsLeft,
  biddingTimerStatus,
  solvingTimerStatus,
  pausedRemainingSeconds,
  pending,
  onExtendBidding,
  onExtendSolving,
  onStartTimer,
  onPauseTimer,
  onResumeTimer,
}: AuctionTimerControlProps) {
  const [biddingExtension, setBiddingExtension] = useState(15);
  const [solvingExtension, setSolvingExtension] = useState(60);

  const btn =
    "px-3 py-2 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 shadow-xl space-y-4">
      <h3 className="text-base font-bold text-white flex items-center gap-2">
        <Clock className="w-5 h-5 text-[#fe5102]" /> Timer control
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Bidding clock */}
        <div className="rounded-xl border border-zinc-800 bg-[#16171b] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Bidding clock
            </span>
            <span className="text-[10px] uppercase font-bold text-zinc-500">
              {biddingTimerStatus}
            </span>
          </div>

          <div className="text-3xl font-black font-mono text-[#fef08a]">
            {biddingTimerStatus === "paused"
              ? format(pausedRemainingSeconds)
              : format(biddingSecondsLeft)}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={600}
              value={biddingExtension}
              onChange={(e) => setBiddingExtension(Number(e.target.value) || 0)}
              className="w-20 bg-zinc-800 border border-zinc-700 text-xs rounded-lg px-2 py-1.5 text-zinc-200"
              aria-label="Bidding extension seconds"
            />
            <button
              type="button"
              onClick={() => onExtendBidding(biddingExtension)}
              disabled={!!pending || biddingExtension <= 0}
              className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`}
            >
              +{biddingExtension}s bidding
            </button>
          </div>
        </div>

        {/* Solving clock */}
        <div className="rounded-xl border border-zinc-800 bg-[#16171b] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Solving clock
            </span>
            <span className="text-[10px] uppercase font-bold text-zinc-500">
              {solvingTimerStatus}
            </span>
          </div>

          <div className="text-3xl font-black font-mono text-emerald-300">
            {format(solvingSecondsLeft)}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={1800}
              value={solvingExtension}
              onChange={(e) => setSolvingExtension(Number(e.target.value) || 0)}
              className="w-20 bg-zinc-800 border border-zinc-700 text-xs rounded-lg px-2 py-1.5 text-zinc-200"
              aria-label="Solving extension seconds"
            />
            <button
              type="button"
              onClick={() => onExtendSolving(solvingExtension)}
              disabled={!!pending || solvingExtension <= 0}
              className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
            >
              +{solvingExtension}s solving
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={onStartTimer}
              disabled={!!pending}
              className={`${btn} bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700`}
            >
              Start
            </button>
            <button
              type="button"
              onClick={onPauseTimer}
              disabled={!!pending}
              className={`${btn} bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700`}
            >
              Pause
            </button>
            <button
              type="button"
              onClick={onResumeTimer}
              disabled={!!pending}
              className={`${btn} bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700`}
            >
              Resume
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
