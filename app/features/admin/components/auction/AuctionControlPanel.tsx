"use client";

import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

interface AuctionControlPanelProps {
  sessionStatus: string | null;
  sessionPaused: boolean;
  activeSlotId: string | null;
  activeSlotTitle: string | null;
  pendingSlots: Array<{ id: string; title: string; round: number }>;
  pending: string | null;
  onStart: () => void;
  onSelect: (slotId: string) => void;
  onOpenBidding: () => void;
  onCloseBidding: () => void;
  onFinalize: () => void;
  onAdvance: () => void;
  onSkip: (slotId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onReset: () => void;
}

/**
 * Admin auction control.
 *
 * Every button maps to one engine function; the backend validates the
 * transition and rejects anything that is not legal from the current
 * state.
 */
export function AuctionControlPanel({
  sessionStatus,
  sessionPaused,
  activeSlotId,
  activeSlotTitle,
  pendingSlots,
  pending,
  onStart,
  onSelect,
  onOpenBidding,
  onCloseBidding,
  onFinalize,
  onAdvance,
  onSkip,
  onPause,
  onResume,
  onEnd,
  onReset,
}: AuctionControlPanelProps) {
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  const busy = (key: string) => pending === key;

  const selected = useMemo(
    () => pendingSlots.find((slot) => slot.id === selectedSlot) ?? null,
    [pendingSlots, selectedSlot]
  );

  const sessionLabel = sessionStatus
    ? sessionStatus.replace(/_/g, " ").toUpperCase()
    : "NOT STARTED";

  const btn =
    "px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white">Tournament Control</h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Session:{" "}
            <span className="font-mono text-zinc-200">
              {sessionLabel}
              {sessionPaused ? " · PAUSED" : ""}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!sessionStatus && (
            <button
              type="button"
              onClick={onStart}
              disabled={!!pending}
              className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
            >
              Start auction
            </button>
          )}

          {sessionStatus && !sessionPaused && (
            <button
              type="button"
              onClick={onPause}
              disabled={!!pending}
              className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`}
            >
              Pause
            </button>
          )}

          {sessionPaused && (
            <button
              type="button"
              onClick={onResume}
              disabled={!!pending}
              className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
            >
              Resume
            </button>
          )}

          <button
            type="button"
            onClick={onAdvance}
            disabled={!!pending}
            className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}
          >
            Advance to next item
          </button>

          <button
            type="button"
            onClick={onEnd}
            disabled={!!pending}
            className={`${btn} bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700`}
          >
            End session
          </button>

          <button
            type="button"
            onClick={onReset}
            disabled={!!pending}
            className={`${btn} bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-500/40`}
          >
            Reset auction
          </button>
        </div>
      </div>

      {/* ── Question selection ─────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-[#16171b] p-4 space-y-3">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          1 · Select the problem statement
        </h4>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedSlot}
            onChange={(e) => setSelectedSlot(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-xs rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-[#fe5102] min-w-[220px]"
          >
            <option value="">Choose a problem statement...</option>
            {pendingSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                Round {slot.round} — {slot.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => selected && onSelect(selected.id)}
            disabled={!selected || !!pending}
            className={`${btn} bg-[#fe5102] hover:bg-[#e64d00] text-white`}
          >
            {busy("select") ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Publish question"}
          </button>

          {selected && (
            <button
              type="button"
              onClick={() => onSkip(selected.id)}
              disabled={!!pending}
              className={`${btn} bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700`}
            >
              Skip this item
            </button>
          )}
        </div>
      </div>

      {/* ── Bidding ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-[#16171b] p-4 space-y-3">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          2 · Run the bidding
        </h4>

        <p className="text-[11px] text-zinc-500">
          {activeSlotTitle
            ? `Live item: ${activeSlotTitle}`
            : "No auction item is currently open."}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenBidding}
            disabled={!!pending || (!activeSlotId && pendingSlots.length === 0)}
            className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
          >
            Open bidding
          </button>

          <button
            type="button"
            onClick={onCloseBidding}
            disabled={!!pending || !activeSlotId}
            className={`${btn} bg-purple-600 hover:bg-purple-500 text-white`}
          >
            Close bidding
          </button>

          <button
            type="button"
            onClick={onFinalize}
            disabled={!!pending}
            className={`${btn} bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700`}
          >
            Finalise &amp; award
          </button>
        </div>
      </div>
    </div>
  );
}
