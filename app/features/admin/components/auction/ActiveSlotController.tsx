'use client';

/**
 * ActiveSlotController Component
 * Bid2Build (Auction Contest Platform) — Phase 4B.3
 *
 * Dedicated control console for supervising the currently active auction slot:
 *  - Displays live highest bid, leading team, bid count, and topic specs
 *  - Realtime countdown based on end_time
 *  - Direct controls: Close Slot (finalizes winner) & Skip Slot
 *  - In-slot live bid activity feed
 *  - Graceful fallback console when no slot is active, allowing admin
 *    to choose and launch the next pending slot from queue
 */

import React, { useState, useEffect } from 'react';
import type {
  AdminSlotWithDetails,
  AdminBidWithTeam,
} from '../../types/auctionAdmin';
import type { AuctionActionType } from './AuctionActionModal';

interface ActiveSlotControllerProps {
  activeSlot: AdminSlotWithDetails | null;
  pendingSlots: AdminSlotWithDetails[];
  recentBids: AdminBidWithTeam[];
  onRequestAction: (slot: AdminSlotWithDetails, action: AuctionActionType) => void;
  isActionInProgress: boolean;
  onRequestReset?: () => void;
}

function formatCriterion(criterion: unknown): string {
  if (!criterion) return 'No specific criterion set.';
  if (typeof criterion === 'string') return criterion;
  try {
    return JSON.stringify(criterion, null, 2);
  } catch {
    return String(criterion);
  }
}

export function ActiveSlotController({
  activeSlot,
  pendingSlots,
  recentBids,
  onRequestAction,
  isActionInProgress,
  onRequestReset,
}: ActiveSlotControllerProps) {
  const [selectedPendingId, setSelectedPendingId] = useState<string>('');
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number | null>(null);

  // Filter recent bids to only those submitted for the currently active slot
  const activeSlotBids = React.useMemo(() => {
    if (!activeSlot) return [];
    return recentBids.filter((b) => b.slot_id === activeSlot.id);
  }, [activeSlot, recentBids]);

  // Live countdown timer based on end_time
  useEffect(() => {
    if (!activeSlot || !activeSlot.end_time) {
      return;
    }

    const updateTimer = () => {
      const endMs = new Date(activeSlot.end_time!).getTime();
      const nowMs = Date.now();
      const diffSec = Math.max(0, Math.ceil((endMs - nowMs) / 1000));
      setTimeRemainingSeconds(diffSec);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [activeSlot]);

  // Derive effective pending slot ID (fallback to first available)
  const effectivePendingId =
    selectedPendingId || (pendingSlots.length > 0 ? pendingSlots[0].id : '');

  const selectedPendingSlot = React.useMemo(() => {
    return pendingSlots.find((s) => s.id === effectivePendingId) ?? null;
  }, [pendingSlots, effectivePendingId]);

  return (
    <div className="space-y-6">
      {/* ─────────────────────────────────────────────────────────────
          Case A: An Auction Slot is ACTIVELY OPEN
      ────────────────────────────────────────────────────────────── */}
      {activeSlot ? (
        <div className="space-y-6">
          {/* Main Active Banner Card */}
          <div className="rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-linear-to-b from-amber-50/80 to-white dark:from-amber-950/30 dark:to-zinc-900 p-6 shadow-md relative overflow-hidden">
            {/* Top Bar with Live Indicator & Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-amber-200 dark:border-amber-900/60">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 font-mono">
                      ACTIVE BIDDING CONTROLLER — Slot #{activeSlot.id.slice(0, 8)}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                      Round {activeSlot.round} ({activeSlot.round === 1 ? 'Easy' : 'Hard'})
                    </span>
                  </div>
                  <h2 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50 mt-1">
                    {activeSlot.topic?.title ?? 'Auction Topic'}
                  </h2>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 self-start sm:self-auto">
                {onRequestReset && (
                  <button
                    type="button"
                    disabled={isActionInProgress}
                    onClick={onRequestReset}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-rose-300 dark:border-rose-900/80 text-rose-700 dark:text-rose-300 bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors disabled:opacity-50"
                    title="Reset all auction slots, bids, and team wallets"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Reset All</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={() => onRequestAction(activeSlot, 'skip')}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-rose-300 dark:border-rose-900/80 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
                  title="Manually skip this slot without awarding it"
                >
                  Skip Slot
                </button>
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={() => onRequestAction(activeSlot, 'close')}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-xs disabled:opacity-50"
                  title="Close bidding, deduct points, and award slot to leader"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Close &amp; Finalize Slot</span>
                </button>
              </div>
            </div>

            {/* Live Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-5">
              {/* Current Bid */}
              <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block font-sans">
                  Current Highest Bid
                </span>
                <span className="text-2xl font-black font-mono text-amber-600 dark:text-amber-400 mt-1 block">
                  {activeSlot.current_bid} pts
                </span>
                <span className="text-[10px] text-zinc-400 mt-1 block">
                  Starting base: 10 pts
                </span>
              </div>

              {/* Leading Team */}
              <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block font-sans">
                  Leading Team
                </span>
                <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 mt-1 block truncate">
                  {activeSlot.leader_team ? activeSlot.leader_team.name : 'No bids placed yet'}
                </span>
                <span className="text-[10px] text-zinc-400 mt-1 block">
                  {activeSlot.leader_team ? `ID: #${activeSlot.leader_team.id.slice(0, 8)}` : 'Awaiting first bid'}
                </span>
              </div>

              {/* Bid Counter */}
              <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block font-sans">
                  Total Bid Count
                </span>
                <span className="text-2xl font-black font-mono text-zinc-800 dark:text-zinc-200 mt-1 block">
                  {activeSlot.bid_count}
                </span>
                <span className="text-[10px] text-zinc-400 mt-1 block">
                  Across all teams
                </span>
              </div>

              {/* Countdown or Window Status */}
              <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block font-sans">
                  Bidding Window
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  {timeRemainingSeconds !== null ? (
                    <>
                      <span className={`text-2xl font-black font-mono ${timeRemainingSeconds <= 3 ? 'text-rose-600 animate-pulse' : 'text-zinc-800 dark:text-zinc-200'}`}>
                        {timeRemainingSeconds}s
                      </span>
                      <span className="text-xs text-zinc-500 font-medium">remaining</span>
                    </>
                  ) : (
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                      Live Window
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-400 mt-1 block font-mono">
                  {activeSlot.end_time ? new Date(activeSlot.end_time).toLocaleTimeString() : 'Dynamic timer'}
                </span>
              </div>
            </div>

            {/* Topic Specifications & Criterion */}
            <div className="pt-4 border-t border-amber-200 dark:border-amber-900/60 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Topic Description
                </span>
                <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed bg-white/60 dark:bg-zinc-900/60 p-3 rounded-lg border border-amber-100 dark:border-amber-950/60">
                  {activeSlot.topic?.description || 'No description provided.'}
                </p>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Evaluation Criterion &amp; Deliverables
                </span>
                <div className="text-[11px] text-zinc-700 dark:text-zinc-300 bg-white/60 dark:bg-zinc-900/60 p-3 rounded-lg border border-amber-100 dark:border-amber-950/60 font-mono whitespace-pre-wrap">
                  {formatCriterion(activeSlot.topic?.criterion)}
                </div>
              </div>
            </div>
          </div>

          {/* Realtime In-Slot Bid Stream */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Live Slot Bid Activity
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono">
                  {activeSlotBids.length} bids recorded
                </span>
              </div>
              <span className="text-[11px] text-zinc-400 font-mono">
                Realtime Synchronized
              </span>
            </div>

            {activeSlotBids.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">
                No bids placed yet for this slot. Teams may bid at any moment.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {activeSlotBids.map((bid, index) => {
                  const isLeading = index === 0;
                  return (
                    <div
                      key={bid.id}
                      className={`py-2.5 px-3 flex items-center justify-between rounded-lg transition-colors ${
                        isLeading ? 'bg-amber-50/60 dark:bg-amber-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono ${
                          isLeading
                            ? 'bg-amber-500 text-white'
                            : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}>
                          {activeSlotBids.length - index}
                        </span>
                        <div>
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs">
                            {bid.team.name}
                          </span>
                          <span className="text-[10px] text-zinc-400 ml-2 font-mono">
                            {new Date(bid.server_time).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 font-mono">
                        <span className="font-bold text-amber-600 dark:text-amber-400 text-sm">
                          {bid.amount} pts
                        </span>
                        {isLeading && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 uppercase tracking-wider">
                            Leader
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ─────────────────────────────────────────────────────────────
            Case B: No Slot is Currently Open (Queue Launcher Console)
        ────────────────────────────────────────────────────────────── */
        <div className="space-y-6">
          <div className="p-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>

            <div className="max-w-md mx-auto">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                No Slot Currently Open for Bidding
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                Per Rule Book §5.1, only one slot may be open for bidding at any given time. Select a pending slot below to launch the next 10-second opening bidding window.
              </p>
            </div>

            {onRequestReset && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={onRequestReset}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors disabled:opacity-50"
                  title="Reset all auction slots to pending, clear bids, and restore team wallets"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Reset All Topics</span>
                </button>
              </div>
            )}

            {/* Pending Slot Launcher Interface */}
            {pendingSlots.length > 0 ? (
              <div className="max-w-xl mx-auto pt-4 space-y-4 text-left">
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 space-y-3">
                  <label htmlFor="pendingSlotSelect" className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block">
                    Choose Next Pending Slot ({pendingSlots.length} in queue):
                  </label>

                  <select
                    id="pendingSlotSelect"
                    value={effectivePendingId}
                    onChange={(e) => setSelectedPendingId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {pendingSlots.map((s) => (
                      <option key={s.id} value={s.id}>
                        [R{s.round} - {s.topic?.level?.toUpperCase()}] #{s.id.slice(0, 8)} — {s.topic?.title}
                      </option>
                    ))}
                  </select>

                  {selectedPendingSlot && (
                    <div className="pt-2 text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                          {selectedPendingSlot.topic?.title}
                        </span>
                        <span className="text-[10px] px-2 py-0.2 rounded-full font-bold uppercase bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                          {selectedPendingSlot.topic?.level}
                        </span>
                      </div>
                      <p className="text-[11px] line-clamp-2">
                        {selectedPendingSlot.topic?.description}
                      </p>
                    </div>
                  )}

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={isActionInProgress || !selectedPendingSlot}
                      onClick={() => {
                        if (selectedPendingSlot) {
                          onRequestAction(selectedPendingSlot, 'open');
                        }
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors disabled:opacity-50"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Open Selected Slot for Bidding</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 max-w-md mx-auto">
                All 40 auction slots have either concluded (sold) or been skipped. No pending slots remain in the contest queue.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
