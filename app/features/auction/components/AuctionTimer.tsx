"use client"

import React from "react"
import { ClockIcon } from "./Icons"
import type { CountdownState, SlotStatus } from "@/types/auction"
import { formatTimeDisplay } from "../utils/countdown"

interface AuctionTimerProps {
  countdown: CountdownState
  status: SlotStatus | undefined
  endTime: string | null | undefined
}

export function AuctionTimer({ countdown, status, endTime }: AuctionTimerProps) {
  const isOpen = status === "open"
  const { secondsLeft, isUrgent, isCritical, isExpired } = countdown

  if (!isOpen || !endTime) {
    return (
      <div className="flex items-center gap-3 bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 sm:p-4 text-zinc-400">
        <div className="w-10 h-10 rounded-lg bg-zinc-800/80 flex items-center justify-center text-zinc-500">
          <ClockIcon className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Auction Clock</span>
          <p className="text-sm font-semibold text-zinc-300">
            {status === "sold" ? "Slot Concluded" : status === "skipped" ? "Slot Skipped" : "Waiting for Slot to Open"}
          </p>
        </div>
      </div>
    )
  }

  // Timer colors and glow based on urgency
  let containerBg = "bg-zinc-900/90 border-zinc-800 text-zinc-100"
  let badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
  let numberColor = "text-white"
  let progressColor = "bg-emerald-500"

  if (isCritical) {
    containerBg = "bg-rose-950/40 border-rose-500/50 text-rose-100 shadow-lg shadow-rose-950/50 animate-pulse"
    badgeColor = "bg-rose-500/20 text-rose-300 border-rose-500/40"
    numberColor = "text-rose-400"
    progressColor = "bg-rose-500"
  } else if (isUrgent) {
    containerBg = "bg-amber-950/30 border-amber-500/40 text-amber-100 shadow-md shadow-amber-950/30"
    badgeColor = "bg-amber-500/20 text-amber-300 border-amber-500/40"
    numberColor = "text-amber-400"
    progressColor = "bg-amber-500"
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 transition-all duration-300 ${containerBg}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
              isCritical
                ? "bg-rose-500/20 text-rose-400"
                : isUrgent
                ? "bg-amber-500/20 text-amber-400"
                : "bg-indigo-500/10 text-indigo-400"
            }`}
          >
            <ClockIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Time Remaining</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeColor}`}>
                {isCritical ? "CRITICAL • +5s ON BID" : isUrgent ? "FINAL SECONDS" : "BIDDING LIVE"}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {isExpired ? "Bidding closed — resolving slot..." : "Server-authoritative timer"}
            </p>
          </div>
        </div>

        {/* Big Digital Numbers */}
        <div className="text-right">
          <div className={`font-mono text-3xl sm:text-4xl font-extrabold tracking-tight ${numberColor}`}>
            {formatTimeDisplay(secondsLeft)}
          </div>
          <span className="text-[11px] text-zinc-400 font-mono">
            {secondsLeft}s left
          </span>
        </div>
      </div>

      {/* Visual pulse line */}
      <div className="w-full bg-zinc-800/80 h-1 rounded-full mt-4 overflow-hidden">
        <div
          className={`h-full transition-all duration-300 rounded-full ${progressColor}`}
          style={{ width: `${Math.min(100, Math.max(0, (secondsLeft / 15) * 100))}%` }}
        />
      </div>
    </div>
  )
}

