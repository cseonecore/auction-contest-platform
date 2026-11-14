"use client"

import React, { useState } from "react"
import { useAuctionSession } from "../hooks/useAuctionSession"
import { useSlot } from "../hooks/useSlot"
import { useBids } from "../hooks/useBids"
import { AuctionHeader } from "./AuctionHeader"
import { AuctionTimer } from "./AuctionTimer"
import { AuctionSlotCard } from "./AuctionSlotCard"
import { CurrentBidPanel } from "./CurrentBidPanel"
import { BidControls } from "./BidControls"
import { BidHistory } from "./BidHistory"
import { WalletBalance } from "./WalletBalance"
import { SlotQueue } from "./SlotQueue"
import { AdminAuctionControls } from "./AdminAuctionControls"
import { TrophyIcon, RefreshIcon } from "./Icons"

export function AuctionRoom() {
  const [queueOpen, setQueueOpen] = useState<boolean>(false)

  // 1. Master session state
  const {
    team,
    isCaptain,
    isAdmin,
    balance,
    projectedBonusPoints,
    walletLoading,
    allSlots,
    activeSlotId,
    setActiveSlotId,
    currentRound,
    wonRounds,
    loading: sessionLoading,
    error: sessionError,
    checkBidEligibility,
    refetchState,
  } = useAuctionSession()

  // 2. Active slot details & real-time clock
  const {
    slot,
    loading: slotLoading,
    error: slotError,
    countdown,
    refetch: refetchSlot,
  } = useSlot(activeSlotId)

  // 3. Live bid history for the active slot
  const {
    bids,
    loading: bidsLoading,
    refetch: refetchBids,
  } = useBids(activeSlotId)

  const handleManualRefresh = () => {
    refetchState()
    refetchSlot()
    refetchBids()
  }

  // Determine bidding eligibility for current captain
  const activeSlotRound = (slot?.round || currentRound) as 1 | 2
  const eligibility = checkBidEligibility(activeSlotRound, slot?.leader_team_id ?? null)
  const hasWonThisRound = wonRounds.has(activeSlotRound)

  if (sessionLoading && !slot) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-zinc-400">
        <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold text-zinc-200">Connecting to Auction Arena...</p>
        <p className="text-xs text-zinc-500 mt-1">Establishing real-time channel to Supabase</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation */}
      <AuctionHeader
        currentRound={currentRound}
        team={team}
        isCaptain={isCaptain}
        isAdmin={isAdmin}
        balance={balance}
        projectedBonusPoints={projectedBonusPoints}
        onToggleQueue={() => setQueueOpen(!queueOpen)}
        queueOpen={queueOpen}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Session Error Alert if any */}
        {(sessionError || slotError) && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between gap-3">
            <span>{sessionError || slotError}</span>
            <button
              onClick={handleManualRefresh}
              className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium transition-colors flex items-center gap-1"
            >
              <RefreshIcon className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        )}

        {/* Round Won Lockout Banner (Rule Book §5.3: 1 slot per round) */}
        {hasWonThisRound && team && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-teal-950/30 to-zinc-900 border border-emerald-500/30 text-emerald-200 flex items-center justify-between gap-4 shadow-lg shadow-emerald-950/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <TrophyIcon className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  Round {activeSlotRound} Topic Won!
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Quota Complete
                  </span>
                </h4>
                <p className="text-xs text-emerald-300/80 mt-0.5">
                  Your team has fulfilled its allocation for Round {activeSlotRound}. Per Rule Book §5.3, you are locked from further bidding in this round.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono text-emerald-400 font-semibold hidden md:block">
              1 Slot / Round Limit
            </span>
          </div>
        )}

        {/* Admin Controls (visible only to organizers) */}
        {isAdmin && (
          <AdminAuctionControls
            slot={slot}
            isAdmin={isAdmin}
            onActionComplete={handleManualRefresh}
          />
        )}

        {/* Primary Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main Stage (Left / Center) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Live Countdown Timer */}
            <AuctionTimer
              countdown={countdown}
              status={slot?.status}
              endTime={slot?.end_time}
            />

            {/* Topic Problem Statement Showcase */}
            <AuctionSlotCard
              slot={slot}
              loading={slotLoading}
            />

            {/* Current Highest Bid & Leader Highlights */}
            <CurrentBidPanel
              slot={slot}
              currentTeam={team}
            />

            {/* Captain's Bidding Form keyed by slot.id for clean form state resets */}
            <BidControls
              key={slot?.id ?? "no-slot"}
              slot={slot}
              currentTeam={team}
              isCaptain={isCaptain}
              balance={balance}
              eligibility={eligibility}
              onBidSuccess={handleManualRefresh}
            />
          </div>

          {/* Right Rail: Wallet, Live Feed & Queue Drawer */}
          <div className="lg:col-span-4 space-y-6">
            {/* Team Wallet Breakdown */}
            <WalletBalance
              team={team}
              balance={balance}
              projectedBonusPoints={projectedBonusPoints}
              loading={walletLoading}
            />

            {/* Live Bid History Feed */}
            <BidHistory
              bids={bids}
              loading={bidsLoading}
            />

            {/* Collapsible Topic Queue for Desktop / Mobile */}
            {queueOpen && (
              <div className="fixed inset-0 z-50 lg:relative lg:inset-auto bg-black/60 lg:bg-transparent backdrop-blur-sm lg:backdrop-blur-none p-4 lg:p-0 flex items-center justify-center">
                <div className="w-full max-w-lg lg:max-w-none">
                  <SlotQueue
                    slots={allSlots}
                    activeSlotId={activeSlotId}
                    currentRound={currentRound}
                    onSelectSlot={(id) => {
                      setActiveSlotId(id)
                      setQueueOpen(false)
                    }}
                    onClose={() => setQueueOpen(false)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
