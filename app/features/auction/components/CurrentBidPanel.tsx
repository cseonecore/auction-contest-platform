"use client"

import React from "react"
import { TrophyIcon, UserGroupIcon } from "./Icons"
import type { SlotWithDetails } from "@/types/auction"
import type { TeamRow } from "@/types/database"

interface CurrentBidPanelProps {
  slot: SlotWithDetails | null
  currentTeam: Pick<TeamRow, "id" | "name"> | null
}

export function CurrentBidPanel({ slot, currentTeam }: CurrentBidPanelProps) {
  const currentBid = slot?.current_bid ?? 0
  const leaderTeam = slot?.leader_team
  const isLeader = Boolean(currentTeam && leaderTeam && currentTeam.id === leaderTeam.id)
  const isSold = slot?.status === "sold"
  const isSkipped = slot?.status === "skipped"

  const minNextBid = currentBid === 0 ? 10 : currentBid + 10

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xl shadow-black/30">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-zinc-800">
        {/* Highest / Winning Bid */}
        <div className="pb-3 sm:pb-0 sm:pr-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              {isSold ? "Winning Bid" : "Highest Active Bid"}
            </span>
            {!isSold && !isSkipped && (
              <span className="text-[11px] text-zinc-400 font-mono">
                Min next: <strong className="text-zinc-200">{minNextBid} pts</strong>
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-4xl sm:text-5xl font-black text-white tracking-tight">
              {currentBid}
            </span>
            <span className="text-sm font-semibold text-zinc-400 font-mono">points</span>
          </div>
          <p className="text-[11px] text-zinc-400 mt-1.5">
            {currentBid === 0
              ? "No bids placed yet • Opening minimum is 10 pts"
              : `Minimum raise: +10 pts (next valid bid: ${minNextBid} pts)`}
          </p>
        </div>

        {/* Current Leader */}
        <div className="pt-3 sm:pt-0 sm:pl-4 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
              {isSold ? "Winner" : "Leading Team"}
            </span>

            {leaderTeam ? (
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                    isLeader
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  }`}
                >
                  <TrophyIcon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    {leaderTeam.name}
                  </h4>
                  {isLeader && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                      ★ Your Team is Leading
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 text-zinc-500">
                <div className="w-9 h-9 rounded-xl bg-zinc-800/80 flex items-center justify-center">
                  <UserGroupIcon className="w-5 h-5" />
                </div>
                <span className="text-sm font-medium">Awaiting opening bid</span>
              </div>
            )}
          </div>

          {/* Helper notice */}
          <div className="text-[11px] text-zinc-400 mt-3 pt-2 border-t border-zinc-800/60">
            {isLeader
              ? "You hold the highest bid. Your wallet is only deducted if you win."
              : "Losing bids cost 0 points. Deduction occurs only upon slot close."}
          </div>
        </div>
      </div>
    </div>
  )
}

