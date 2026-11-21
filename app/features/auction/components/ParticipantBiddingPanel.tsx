"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { validateBid } from "../utils/bid-validation";
import { BID_PRESET_INCREMENTS, calculatePresetBid } from "../utils/bid-presets";

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
  eliminated?: boolean;
  paused?: boolean;
  /** The client countdown reached zero (advisory — never blocks an open item). */
  timerExpired?: boolean;
  /** No active auction session exists (advisory — never blocks an open item). */
  sessionActive?: boolean;
  onBidSubmit: (amount: number) => Promise<{ success: boolean; error?: string }>;
}

type Feedback = { tone: "success" | "error"; text: string };

const SUCCESS_VISIBLE_MS = 3500;

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
  eliminated = false,
  paused = false,
  timerExpired = false,
  sessionActive,
  onBidSubmit,
}: ParticipantBiddingPanelProps) {
  // Validation — mirrors the rules enforced by place_bid() in PostgreSQL.
  // The database remains the final authority; this only prevents avoidable
  // round-trips and explains why a click cannot be accepted.
  const validation = validateBid({
    currentBid,
    minBid,
    minRaise,
    walletBalance,
    isLeader,
    hasWonRound,
    wonCount,
    currentRound,
    slotStatus,
    eliminated,
    paused,
    timerExpired,
    sessionActive,
  });

  const minNextBid = validation.minNextBid;

  const [customValue, setCustomValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Which preset is currently in flight (null = custom/empty). */
  const [pendingPreset, setPendingPreset] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // A ref is the synchronous duplicate-submission guard: two clicks can
  // land before React re-renders the disabled button state.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (feedback?.tone !== "success") return;
    const timer = setTimeout(() => setFeedback(null), SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const parsedCustom = customValue.trim() === "" ? NaN : Number(customValue);
  const customBid = Number.isFinite(parsedCustom) ? Math.floor(parsedCustom) : NaN;
  const customHint =
    customValue.trim() === ""
      ? null
      : !Number.isFinite(customBid) || customBid <= 0
        ? "Enter a positive whole bid amount."
        : customBid < minNextBid
          ? `The minimum bid is ${minNextBid} points.`
          : customBid > walletBalance
            ? `Insufficient balance — your wallet has ${walletBalance} coins.`
            : null;

  /**
   * One click / one submit. The amount goes straight to the existing
   * `place_bid()` RPC; there is no confirmation step.
   */
  const submitBid = async (rawAmount: number, preset: number | null) => {
    if (submittingRef.current) return;

    if (!validation.canBid) {
      setFeedback({
        tone: "error",
        text: validation.reason ?? "Bidding is not available right now.",
      });
      return;
    }

    const amount = Number.isFinite(rawAmount) ? Math.floor(rawAmount) : NaN;

    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback({ tone: "error", text: "Enter a positive whole bid amount." });
      return;
    }
    if (amount < minNextBid) {
      setFeedback({
        tone: "error",
        text: `Bid too low — the minimum next bid is ${minNextBid} points.`,
      });
      return;
    }
    if (amount > walletBalance) {
      setFeedback({
        tone: "error",
        text: `Insufficient balance — your wallet has ${walletBalance} coins.`,
      });
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setPendingPreset(preset);
    setFeedback(null);

    try {
      const result = await onBidSubmit(amount);
      if (result.success) {
        setFeedback({
          tone: "success",
          text: `Bid of ${amount} points accepted.`,
        });
        setCustomValue("");
      } else {
        setFeedback({
          tone: "error",
          text: result.error || "Failed to place bid. Please try again.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        tone: "error",
        text: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      setPendingPreset(null);
    }
  };

  const handlePresetClick = (increment: number) => {
    void submitBid(calculatePresetBid(minNextBid, increment), increment);
  };

  const handleCustomSubmit = () => {
    void submitBid(customBid, null);
  };

  const actionsDisabled = !validation.canBid || isSubmitting;

  return (
    <div className="w-full select-none">
      {/* 2x2 preset buttons — one click places the bid immediately */}
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5">
        {BID_PRESET_INCREMENTS.map((increment) => {
          const amount = calculatePresetBid(minNextBid, increment);
          const pending = pendingPreset === increment;
          const affordable = amount <= walletBalance;
          const blockedReason = !validation.canBid
            ? validation.reason
            : !affordable
              ? `Insufficient balance — this bid needs ${amount} points.`
              : null;
          return (
            <button
              key={increment}
              type="button"
              disabled={actionsDisabled || !affordable}
              onClick={() => handlePresetClick(increment)}
              title={blockedReason ?? `Place a bid of ${amount} points`}
              className="h-24 sm:h-28 rounded-2xl flex flex-col items-center justify-center font-black transition-all duration-150 cursor-pointer shadow-lg disabled:opacity-40 disabled:cursor-not-allowed bg-[#33353b] hover:bg-[#3d3f47] text-white active:scale-95 border border-zinc-700/60"
            >
              {pending ? (
                <Loader2 className="w-8 h-8 animate-spin" />
              ) : (
                <span className="text-3xl sm:text-4xl leading-none">+{increment}</span>
              )}
              <span className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-white/55">
                Bid {amount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Compact bid context (wallet is used for affordance only; the
          live leaderboards never show balances) */}
      <div className="mt-3.5 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs flex items-center justify-between text-zinc-300">
        <div>
          <span className="text-zinc-500 block text-[10px] uppercase font-bold tracking-wider">
            Current Highest
          </span>
          <span className="font-bold text-white font-mono">{currentBid} pts</span>
        </div>

        <div className="text-center">
          <span className="text-zinc-500 block text-[10px] uppercase font-bold tracking-wider">
            Minimum Next
          </span>
          <span className="font-bold text-[#fe5102] font-mono">{minNextBid} pts</span>
        </div>

        <div className="text-right">
          <span className="text-zinc-500 block text-[10px] uppercase font-bold tracking-wider">
            Your Balance
          </span>
          <span className="font-black text-emerald-400 text-sm sm:text-base font-mono">
            {walletBalance} pts
          </span>
        </div>
      </div>

      {/* Custom total bid — immediately submitted via the small button */}
      <div className="mt-3 flex items-stretch gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={minNextBid}
          step={1}
          value={customValue}
          onChange={(event) => {
            setCustomValue(event.target.value);
            if (feedback?.tone === "error") setFeedback(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleCustomSubmit();
            }
          }}
          disabled={actionsDisabled}
          placeholder={`Custom total (min ${minNextBid})`}
          aria-label="Custom bid amount"
          className="min-w-0 flex-1 rounded-xl border border-zinc-700/70 bg-zinc-900/90 px-3.5 py-3 text-sm font-bold text-white placeholder:text-zinc-500 font-mono focus:outline-none focus:ring-2 focus:ring-[#fe5102]/60 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleCustomSubmit}
          disabled={actionsDisabled}
          className="shrink-0 px-4 py-3 rounded-xl bg-[#fe5102] hover:bg-[#d94502] active:scale-[0.99] text-white font-black text-xs sm:text-sm tracking-wide shadow-lg shadow-orange-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
        >
          {isSubmitting && pendingPreset === null ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Placing...</span>
            </>
          ) : (
            <span>Place Bid</span>
          )}
        </button>
      </div>

      {customHint && !feedback && (
        <p className="mt-2 text-[11px] font-semibold text-amber-300">{customHint}</p>
      )}

      {/* Concise success / error notification */}
      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={`mt-2.5 p-2.5 rounded-xl border text-xs text-center font-semibold ${
            feedback.tone === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-red-500/10 border-red-500/30 text-red-300"
          }`}
        >
          {feedback.text}
        </div>
      ) : !validation.canBid && validation.reason ? (
        <div className="mt-2.5 p-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-200 text-xs text-center font-medium">
          {validation.reason}
        </div>
      ) : null}
    </div>
  );
}
