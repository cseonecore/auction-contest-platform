"use client"

import React from "react"
import type { BidWithTeam } from "@/types/auction"
import { TrophyIcon } from "./Icons"

interface BidHistoryProps {
  bids: BidWithTeam[]
  loading: boolean
}

export function BidHistory({ bids, loading }: BidHistoryProps) {
  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl shadow-black/30 flex flex-col h-full max-h-[460px]">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
          Live Bid Feed
        </h3>
        <span className="text-[11px] font-mono text-zinc-400">
          {bids.length} {bids.length === 1 ? "bid" : "bids"}
        </span>
      </div>

      <div className="overflow-y-auto space-y-2 flex-1 pr-1 custom-scrollbar">
        {loading && bids.length === 0 && (
          <div className="space-y-2 py-4 animate-pulse">
            <div className="h-10 bg-zinc-800/60 rounded-xl" />
            <div className="h-10 bg-zinc-800/40 rounded-xl" />
            <div className="h-10 bg-zinc-800/20 rounded-xl" />
          </div>
        )}

        {!loading && bids.length === 0 && (
          <div className="py-12 text-center text-xs text-zinc-400">
            <p className="font-medium text-zinc-400">No bids placed yet</p>
            <p className="text-[11px] text-zinc-400 mt-1">Bids placed by captains will appear here live</p>
          </div>
        )}

        {bids.map((bid, index) => {
          const isHighest = index === 0
          const timeFormatted = formatTimeAgo(bid.server_time)

          return (
            <div
              key={bid.id}
              className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                isHighest
                  ? "bg-amber-500/10 border-amber-500/30 text-white shadow-sm"
                  : "bg-zinc-950/60 border-zinc-800/80 text-zinc-300"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                    isHighest
                      ? "bg-amber-500 text-zinc-950"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {isHighest ? <TrophyIcon className="w-3.5 h-3.5" /> : `#${bids.length - index}`}
                </div>
                <div className="min-w-0 truncate">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-bold text-xs truncate">
                      {bid.team?.name || "Unknown Team"}
                    </span>
                    {isHighest && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        LEADER
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-400 block font-mono">
                    {timeFormatted}
                  </span>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span
                  className={`font-mono text-base font-bold ${
                    isHighest ? "text-amber-400" : "text-zinc-200"
                  }`}
                >
                  {bid.amount}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono ml-1">pts</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return "Just now"
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

