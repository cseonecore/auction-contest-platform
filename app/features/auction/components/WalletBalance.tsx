"use client"

import React from "react"
import { WalletIcon, SparklesIcon } from "./Icons"
import type { TeamRow } from "@/types/database"

interface WalletBalanceProps {
  team: Pick<TeamRow, "id" | "name"> | null
  balance: number
  projectedBonusPoints: number
  loading: boolean
}

export function WalletBalance({
  team,
  balance,
  projectedBonusPoints,
  loading,
}: WalletBalanceProps) {
  if (!team) return null

  const spentPoints = Math.max(0, 100 - balance)
  const percentRemaining = Math.max(0, Math.min(100, balance))

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl shadow-black/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <WalletIcon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              Team Points Wallet
            </h3>
            <span className="text-[11px] text-zinc-400">{team.name}</span>
          </div>
        </div>
        <div className="text-right">
          <span className="font-mono text-2xl font-black text-emerald-400">
            {loading ? "..." : balance}
          </span>
          <span className="text-xs text-zinc-400 font-mono ml-1">/ 100 pts</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-zinc-950 h-2 rounded-full overflow-hidden border border-zinc-800">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
          style={{ width: `${percentRemaining}%` }}
        />
      </div>

      <div className="flex justify-between items-center text-[11px] text-zinc-400 mt-2 font-mono">
        <span>{spentPoints} pts committed</span>
        <span>{balance} pts remaining</span>
      </div>

      {/* Bonus Points Calculator (Rule Book §9.8) */}
      <div className="mt-4 pt-3 border-t border-zinc-800/80 bg-zinc-950/50 rounded-xl p-3 flex items-start gap-2.5">
        <SparklesIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-amber-300 text-[11px]">
              Contest Bonus Score: +{projectedBonusPoints} pts
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 mt-0.5 leading-tight">
            Rule Book §9.8: +1 evaluation point for every 3 unspent auction points at contest end.
          </p>
        </div>
      </div>
    </div>
  )
}

