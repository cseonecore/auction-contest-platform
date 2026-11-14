"use client"

import React, { useState } from "react"
import type { SlotWithTopic, AuctionRound } from "@/types/auction"
import { TrophyIcon, ChevronRightIcon } from "./Icons"

interface SlotQueueProps {
  slots: SlotWithTopic[]
  activeSlotId: string | null
  currentRound: AuctionRound
  onSelectSlot: (slotId: string) => void
  onClose?: () => void
}

export function SlotQueue({
  slots,
  activeSlotId,
  currentRound,
  onSelectSlot,
  onClose,
}: SlotQueueProps) {
  const [selectedRoundTab, setSelectedRoundTab] = useState<AuctionRound>(currentRound)

  const filteredSlots = slots.filter((s) => s.round === selectedRoundTab)
  const totalInRound = filteredSlots.length
  const soldCount = filteredSlots.filter((s) => s.status === "sold").length

  return (
    <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-5 shadow-2xl flex flex-col h-full max-h-[620px]">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
            Tournament Topic Queue
          </h3>
          <p className="text-[11px] text-zinc-400">
            {soldCount} of {totalInRound} slots concluded in this round
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg text-xs"
          >
            ✕ Close
          </button>
        )}
      </div>

      {/* Round tabs */}
      <div className="grid grid-cols-2 gap-2 mb-3 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
        <button
          onClick={() => setSelectedRoundTab(1)}
          className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-colors ${
            selectedRoundTab === 1
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Round 1: Easy (20)
        </button>
        <button
          onClick={() => setSelectedRoundTab(2)}
          className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-colors ${
            selectedRoundTab === 2
              ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Round 2: Hard (20)
        </button>
      </div>

      {/* Slots List */}
      <div className="overflow-y-auto space-y-2 flex-1 pr-1 custom-scrollbar">
        {filteredSlots.map((slot, index) => {
          const isSelected = slot.id === activeSlotId
          const isLive = slot.status === "open"
          const isSold = slot.status === "sold"
          const isSkipped = slot.status === "skipped"

          return (
            <button
              key={slot.id}
              onClick={() => onSelectSlot(slot.id)}
              className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                isSelected
                  ? "bg-indigo-950/40 border-indigo-500 text-white shadow-md shadow-indigo-950/50"
                  : isLive
                  ? "bg-amber-950/20 border-amber-500/40 text-amber-200 hover:border-amber-500/60"
                  : "bg-zinc-950/40 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/50 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-mono text-xs text-zinc-400 w-5 text-center shrink-0">
                  #{index + 1}
                </span>

                <div className="min-w-0 truncate">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs truncate">
                      {slot.topic?.title || "Topic"}
                    </span>
                    {isLive && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                        LIVE
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono mt-0.5">
                    {isSold ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <TrophyIcon className="w-3 h-3" />
                        Sold for {slot.current_bid} pts
                      </span>
                    ) : isSkipped ? (
                      <span className="text-zinc-500 line-through">Skipped</span>
                    ) : (
                      <span>Pending opening</span>
                    )}
                  </div>
                </div>
              </div>

              <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0" />
            </button>
          )
        })}

        {filteredSlots.length === 0 && (
          <div className="py-8 text-center text-xs text-zinc-500">
            No slots found in this round.
          </div>
        )}
      </div>
    </div>
  )
}

