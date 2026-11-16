'use client';

/**
 * AuctionDashboardStats Component
 * Bid2Build (Auction Contest Platform) — Phase 4B.1
 *
 * Renders the top-level KPI overview metrics for the Admin Auction Dashboard:
 *  1. Total auction slots (with Round 1 & Round 2 distribution)
 *  2. Slot lifecycle breakdown (Pending, Open, Sold, Skipped)
 *  3. Auction points spent and total bids placed
 *  4. Team allocation quota completion progress
 *
 * Follows the existing Admin design system and responsive grid conventions.
 */

import React from 'react';
import type { AuctionOverviewStats } from '../../types/auctionAdmin';

interface AuctionDashboardStatsProps {
  stats: AuctionOverviewStats;
  isLoading?: boolean;
}

export function AuctionDashboardStats({
  stats,
  isLoading = false,
}: AuctionDashboardStatsProps) {
  const completedSlots = stats.sold_slots + stats.skipped_slots;
  const slotProgressPercent =
    stats.total_slots > 0
      ? Math.min(100, Math.round((completedSlots / stats.total_slots) * 100))
      : 0;

  const teamCompletionPercent =
    stats.teams_total > 0
      ? Math.min(
          100,
          Math.round(
            (stats.teams_with_completed_allocation / stats.teams_total) * 100
          )
        )
      : 0;

  const avgWinningBid =
    stats.sold_slots > 0
      ? Math.round(stats.total_points_spent / stats.sold_slots)
      : 0;

  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 transition-opacity duration-200 ${
        isLoading ? 'opacity-70' : 'opacity-100'
      }`}
    >
      {/* ─────────────────────────────────────────────────────────────
          Card 1: Slot Inventory & Rounds
      ────────────────────────────────────────────────────────────── */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-medium">
            <span>Total Auction Slots</span>
            <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80">
              Rounds 1 &amp; 2
            </span>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 font-mono tracking-tight">
              {stats.total_slots}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
              slots seeded
            </span>
          </div>

          {/* Round breakdown ratio bar */}
          <div className="mt-3">
            <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{
                  width: `${
                    stats.total_slots > 0
                      ? (stats.round1_slots_total / stats.total_slots) * 100
                      : 50
                  }%`,
                }}
                title={`Round 1: ${stats.round1_slots_total} slots`}
              />
              <div
                className="bg-purple-500 h-full transition-all duration-300"
                style={{
                  width: `${
                    stats.total_slots > 0
                      ? (stats.round2_slots_total / stats.total_slots) * 100
                      : 50
                  }%`,
                }}
                title={`Round 2: ${stats.round2_slots_total} slots`}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] font-mono">
              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                <span>R1 Easy: {stats.round1_slots_total}</span>
              </div>
              <div className="flex items-center gap-1.5 text-purple-700 dark:text-purple-400">
                <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                <span>R2 Hard: {stats.round2_slots_total}</span>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800/60 pt-2.5">
          20 topics per round across easy and hard contest challenges.
        </p>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          Card 2: Slot Lifecycle Statuses
      ────────────────────────────────────────────────────────────── */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-medium">
            <span>Lifecycle Statuses</span>
            {stats.open_slots > 0 ? (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {stats.open_slots} Open Now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                No Open Slot
              </span>
            )}
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 font-mono tracking-tight">
              {completedSlots}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
              / {stats.total_slots} Concluded ({slotProgressPercent}%)
            </span>
          </div>

          {/* Segmented status summary */}
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] font-mono">
            <div className="flex items-center justify-between px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800">
              <span className="text-zinc-500 dark:text-zinc-400">Pending:</span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                {stats.pending_slots}
              </span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 rounded bg-amber-50/70 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40">
              <span className="text-amber-700 dark:text-amber-400">Open:</span>
              <span className="font-semibold text-amber-800 dark:text-amber-300">
                {stats.open_slots}
              </span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 rounded bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40">
              <span className="text-emerald-700 dark:text-emerald-400">Sold:</span>
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                {stats.sold_slots}
              </span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800">
              <span className="text-zinc-500 dark:text-zinc-400">Skipped:</span>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                {stats.skipped_slots}
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800/60 pt-2.5">
          {stats.sold_slots} topics awarded to winning teams.
        </p>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          Card 3: Bidding & Economy
      ────────────────────────────────────────────────────────────── */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-medium">
            <span>Bidding Activity &amp; Points</span>
            <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80">
              Economy
            </span>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 font-mono tracking-tight">
              {stats.total_points_spent}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
              pts spent
            </span>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">
                Total Bids Placed:
              </span>
              <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                {stats.total_bids} bids
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">
                Avg. Winning Bid:
              </span>
              <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                {avgWinningBid} pts / slot
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800/60 pt-2.5">
          Points deducted on winning bids only. Losing bids cost nothing.
        </p>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          Card 4: Team Allocation Quotas
      ────────────────────────────────────────────────────────────── */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-medium">
            <span>Team Quota Completion</span>
            <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80">
              Rule Book §5.3
            </span>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
              {stats.teams_with_completed_allocation}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
              / {stats.teams_total} Teams Finished ({teamCompletionPercent}%)
            </span>
          </div>

          {/* Quota Progress Bar */}
          <div className="mt-3">
            <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${teamCompletionPercent}%` }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span>Both Won: {stats.teams_with_completed_allocation}</span>
              <span>1 Won: {stats.teams_with_partial_allocation}</span>
              <span>0 Won: {stats.teams_with_no_allocation}</span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800/60 pt-2.5">
          Each team may win exactly 1 slot in Round 1 and 1 slot in Round 2.
        </p>
      </div>
    </div>
  );
}
