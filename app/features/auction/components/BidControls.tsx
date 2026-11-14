"use client"

import React, { useState } from "react"
import { submitBid } from "../utils/placeBid"
import { ShieldAlertIcon, GavelIcon, CheckCircleIcon } from "./Icons"
import type { SlotWithDetails, BidEligibility, PlaceBidResult } from "@/types/auction"
import type { TeamRow } from "@/types/database"

interface BidControlsProps {
  slot: SlotWithDetails | null
  currentTeam: Pick<TeamRow, "id" | "name"> | null
  isCaptain: boolean
  balance: number
  eligibility: BidEligibility
  onBidSuccess?: (result: PlaceBidResult) => void
}

export function BidControls({
  slot,
  currentTeam,
  isCaptain,
  balance,
  eligibility,
  onBidSuccess,
}: BidControlsProps) {
  const currentBid = slot?.current_bid ?? 0
  const minNextBid = currentBid === 0 ? 10 : currentBid + 10

  const [bidAmount, setBidAmount] = useState<number>(minNextBid)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  if (!slot) return null

  const isOpen = slot.status === "open"
  const isLeader = Boolean(currentTeam && slot.leader_team && currentTeam.id === slot.leader_team.id)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!currentTeam || !isCaptain) return

    setIsSubmitting(true)
    const res = await submitBid({
      slotId: slot.id,
      amount: bidAmount,
      currentBid: slot.current_bid,
      walletBalance: balance,
      isLeader,
      hasWonRound: !eligibility.canBid && (eligibility.reason?.includes("already won") ?? false),
      isCaptain,
    })

    setIsSubmitting(false)

    if (!res.success) {
      setErrorMessage(res.error || "Failed to place bid")
      return
    }

    if (res.data) {
      setSuccessMessage(`Bid of ${res.data.amount} pts placed successfully!`)
      onBidSuccess?.(res.data)
      setTimeout(() => setSuccessMessage(null), 4000)
    }
  }

  const handleQuickAdd = (increment: number) => {
    setBidAmount((prev) => Math.max(minNextBid, prev + increment))
    setErrorMessage(null)
  }

  const handleSetMax = () => {
    setBidAmount(balance)
    setErrorMessage(null)
  }

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xl shadow-black/30">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
          <GavelIcon className="w-4 h-4 text-indigo-400" />
          Captain Bidding Terminal
        </h3>
        <span className="text-xs text-zinc-400 font-mono">
          Wallet: <strong className="text-emerald-400">{balance} pts</strong>
        </span>
      </div>

      {/* Case 1: Slot is not open */}
      {!isOpen && (
        <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-800 text-center text-xs text-zinc-400">
          {slot.status === "sold"
            ? "This slot has concluded and is closed for bidding."
            : slot.status === "skipped"
            ? "This slot was skipped."
            : "Bidding will open once the organizer begins this round."}
        </div>
      )}

      {/* Case 2: Slot is open, but team is not eligible to bid */}
      {isOpen && !eligibility.canBid && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 flex items-start gap-3">
          <ShieldAlertIcon className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
          <div className="text-xs">
            <span className="font-bold block text-sm mb-0.5">Bidding Restricted</span>
            <p className="text-amber-200/90">{eligibility.reason}</p>
          </div>
        </div>
      )}

      {/* Case 3: Slot is open and eligible */}
      {isOpen && eligibility.canBid && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
              <label htmlFor="bid-amount" className="font-semibold text-zinc-300">
                Your Bid (pts)
              </label>
              <span>
                Minimum required: <span className="font-mono text-zinc-200">{minNextBid} pts</span>
              </span>
            </div>

            <div className="relative">
              <input
                id="bid-amount"
                type="number"
                min={minNextBid}
                max={balance}
                step={1}
                value={bidAmount || ""}
                onChange={(e) => {
                  setBidAmount(Number(e.target.value))
                  setErrorMessage(null)
                }}
                disabled={isSubmitting}
                className="w-full bg-zinc-950 border border-zinc-700/80 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl px-4 py-3 text-2xl font-mono font-bold text-white placeholder-zinc-600 transition-all outline-none"
                placeholder={minNextBid.toString()}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs font-semibold text-zinc-500">
                PTS
              </span>
            </div>
          </div>

          {/* Quick preset buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setBidAmount(minNextBid)}
              className="px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              Min ({minNextBid})
            </button>
            <button
              type="button"
              onClick={() => handleQuickAdd(10)}
              className="px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              +10 pts
            </button>
            <button
              type="button"
              onClick={() => handleQuickAdd(20)}
              className="px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              +20 pts
            </button>
            <button
              type="button"
              onClick={() => handleQuickAdd(30)}
              className="px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              +30 pts
            </button>
            {balance >= minNextBid && (
              <button
                type="button"
                onClick={handleSetMax}
                className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors"
              >
                Max ({balance})
              </button>
            )}
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <ShieldAlertIcon className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircleIcon className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || bidAmount < minNextBid || bidAmount > balance}
            className="w-full py-3.5 px-6 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-indigo-500 via-purple-600 to-indigo-600 hover:from-indigo-400 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25 active:scale-[0.99] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Submitting Bid...</span>
              </>
            ) : (
              <>
                <GavelIcon className="w-5 h-5" />
                <span>Place Bid of {bidAmount} Points</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  )
}
