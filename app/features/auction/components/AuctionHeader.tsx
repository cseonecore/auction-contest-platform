"use client"

import React from "react"
import Link from "next/link"
import { GavelIcon, WalletIcon } from "./Icons"
import type { AuctionRound } from "@/types/auction"
import type { TeamRow } from "@/types/database"

interface AuctionHeaderProps {
  currentRound: AuctionRound
  team: Pick<TeamRow, "id" | "name"> | null
  isCaptain: boolean
  isAdmin: boolean
  balance: number
  projectedBonusPoints: number
  onToggleQueue?: () => void
  queueOpen?: boolean
}

export function AuctionHeader({
  currentRound,
  team,
  isCaptain,
  isAdmin,
  balance,
  projectedBonusPoints,
  onToggleQueue,
  queueOpen,
}: AuctionHeaderProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand & Live status */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <GavelIcon className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-white flex items-center gap-1.5">
                Bid2Build
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                  Live
                </span>
              </span>
              <p className="text-[11px] text-zinc-400 hidden sm:block">App Dev Auction Contest</p>
            </div>
          </Link>

          {/* Round Indicator */}
          <div className="hidden md:flex items-center gap-2 ml-4 pl-4 border-l border-zinc-800">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                currentRound === 1
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  currentRound === 1 ? "bg-emerald-400" : "bg-purple-400"
                }`}
              />
              Round {currentRound}: {currentRound === 1 ? "Easy Topics" : "Hard Topics"}
            </span>
          </div>
        </div>

        {/* User / Team & Wallet Pill */}
        <div className="flex items-center gap-3">
          {team ? (
            <div className="flex items-center gap-2.5 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 shadow-sm">
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="font-semibold text-xs text-zinc-200">{team.name}</span>
                  {isCaptain && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      CAPTAIN
                    </span>
                  )}
                  {isAdmin && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      ADMIN
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1 text-emerald-400 font-medium font-mono">
                    <WalletIcon className="w-3 h-3" />
                    {balance} pts
                  </span>
                  <span>•</span>
                  <span className="text-zinc-400" title="1 evaluation bonus pt per 3 unspent auction pts (Rule Book §9.8)">
                    +{projectedBonusPoints} bonus
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900/60 border border-zinc-800/80 rounded-lg px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-zinc-600" />
              <span>Spectator Mode</span>
            </div>
          )}

          {/* Toggle Slot Queue button */}
          {onToggleQueue && (
            <button
              onClick={onToggleQueue}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                queueOpen
                  ? "bg-indigo-600 text-white border-indigo-500"
                  : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-800"
              }`}
            >
              <span>Topic Queue</span>
              <span className="w-4 h-4 rounded-full bg-zinc-800 text-[10px] flex items-center justify-center font-mono">
                {currentRound === 1 ? "20" : "20"}
              </span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

