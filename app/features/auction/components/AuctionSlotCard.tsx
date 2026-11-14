"use client"

import React from "react"
import { SparklesIcon, TrophyIcon } from "./Icons"
import type { SlotWithDetails } from "@/types/auction"

interface AuctionSlotCardProps {
  slot: SlotWithDetails | null
  loading: boolean
}

export function AuctionSlotCard({ slot, loading }: AuctionSlotCardProps) {
  if (loading) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 animate-pulse">
        <div className="h-4 w-28 bg-zinc-800 rounded mb-3" />
        <div className="h-8 w-3/4 bg-zinc-800 rounded mb-4" />
        <div className="h-4 w-full bg-zinc-800/60 rounded mb-2" />
        <div className="h-4 w-2/3 bg-zinc-800/60 rounded" />
      </div>
    )
  }

  if (!slot || !slot.topic) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center text-zinc-400">
        <div className="w-12 h-12 rounded-xl bg-zinc-800/80 flex items-center justify-center mx-auto mb-3 text-zinc-500">
          <TrophyIcon className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-zinc-200">No Active Slot Selected</h3>
        <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
          Waiting for the organizer to open the next topic slot in the auction queue.
        </p>
      </div>
    )
  }

  const { topic, round, status, winner_team } = slot
  const isEasy = topic.level === "easy"

  // Extract focus from criterion jsonb
  let criterionFocus = ""
  if (topic.criterion && typeof topic.criterion === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    criterionFocus = (topic.criterion as any).focus || ""
  }

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-7 relative overflow-hidden shadow-xl shadow-black/40">
      {/* Decorative gradient blur */}
      <div
        className={`absolute -top-24 -right-24 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-20 ${
          isEasy ? "bg-emerald-500" : "bg-purple-500"
        }`}
      />

      {/* Top Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          {/* Level pill */}
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
              isEasy
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-purple-500/10 text-purple-400 border-purple-500/20"
            }`}
          >
            {isEasy ? "Round 1 • Easy Track" : "Round 2 • Hard Track"}
          </span>

          {/* Slot status pill */}
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
              status === "open"
                ? "bg-amber-500/10 text-amber-300 border border-amber-500/30 animate-pulse"
                : status === "sold"
                ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/30"
                : status === "skipped"
                ? "bg-zinc-800 text-zinc-400"
                : "bg-zinc-800/60 text-zinc-400"
            }`}
          >
            {status === "open"
              ? "● LIVE ON THE BLOCK"
              : status === "sold"
              ? "✓ SOLD"
              : status === "skipped"
              ? "SKIPPED"
              : "UPCOMING"}
          </span>
        </div>

        <span className="text-xs text-zinc-400 font-mono">
          Round {round}
        </span>
      </div>

      {/* Topic Title */}
      <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug">
        {topic.title}
      </h2>

      {/* Topic Description */}
      {topic.description && (
        <p className="text-sm text-zinc-300 mt-3 leading-relaxed">
          {topic.description}
        </p>
      )}

      {/* AI Evaluation Focus (Rule Book §9.3) */}
      {criterionFocus && (
        <div className="mt-4 pt-4 border-t border-zinc-800/80 flex items-start gap-2.5 bg-zinc-950/40 rounded-xl p-3 border">
          <SparklesIcon className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-semibold text-indigo-300 uppercase tracking-wider text-[10px] block">
              AI Evaluation Metric (Rule Book §9.3)
            </span>
            <span className="text-zinc-300">{criterionFocus}</span>
          </div>
        </div>
      )}

      {/* Winner Announcement Banner (if sold) */}
      {status === "sold" && winner_team && (
        <div className="mt-4 p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold">
              <TrophyIcon className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 block">
                Topic Won By
              </span>
              <span className="text-sm font-bold text-white">{winner_team.name}</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 block">Winning Bid</span>
            <span className="text-sm font-mono font-bold text-emerald-400">{slot.current_bid} pts</span>
          </div>
        </div>
      )}
    </div>
  )
}

