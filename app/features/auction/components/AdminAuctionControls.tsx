"use client"

import React, { useState } from "react"
import { openAuctionSlot, closeAuctionSlot, skipAuctionSlot } from "../utils/adminActions"
import { GavelIcon, ShieldAlertIcon } from "./Icons"
import type { SlotWithDetails } from "@/types/auction"

interface AdminAuctionControlsProps {
  slot: SlotWithDetails | null
  isAdmin: boolean
  onActionComplete?: () => void
}

export function AdminAuctionControls({
  slot,
  isAdmin,
  onActionComplete,
}: AdminAuctionControlsProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null)

  if (!isAdmin || !slot) return null

  const isOpen = slot.status === "open"
  const isPending = slot.status === "pending"

  const handleOpen = async () => {
    setFeedback(null)
    setLoadingAction("open")
    const res = await openAuctionSlot(slot.id)
    setLoadingAction(null)
    if (!res.success) {
      setFeedback({ type: "error", message: res.error || "Failed to open slot" })
    } else {
      setFeedback({ type: "success", message: "Slot opened with 10s countdown window!" })
      onActionComplete?.()
    }
  }

  const handleClose = async () => {
    if (!confirm("Are you sure you want to close this auction slot? This will finalize the winner and deduct points.")) {
      return
    }
    setFeedback(null)
    setLoadingAction("close")
    const res = await closeAuctionSlot(slot.id)
    setLoadingAction(null)
    if (!res.success) {
      setFeedback({ type: "error", message: res.error || "Failed to close slot" })
    } else {
      setFeedback({
        type: "success",
        message: res.data?.status === "sold" ? "Slot closed and sold to leader!" : "Slot concluded with 0 bids (skipped).",
      })
      onActionComplete?.()
    }
  }

  const handleSkip = async () => {
    if (!confirm("Are you sure you want to manually skip this slot?")) {
      return
    }
    setFeedback(null)
    setLoadingAction("skip")
    const res = await skipAuctionSlot(slot.id)
    setLoadingAction(null)
    if (!res.success) {
      setFeedback({ type: "error", message: res.error || "Failed to skip slot" })
    } else {
      setFeedback({ type: "success", message: "Slot marked as skipped." })
      onActionComplete?.()
    }
  }

  return (
    <div className="bg-rose-950/20 border border-rose-500/30 rounded-2xl p-4 sm:p-5 shadow-lg">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
            <ShieldAlertIcon className="w-4 h-4 text-rose-400" />
            Organizer / Admin Controls
          </h4>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
          Admin Authorization Active
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {isPending && (
          <button
            onClick={handleOpen}
            disabled={loadingAction !== null}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loadingAction === "open" ? "Opening..." : "▶ Open Slot (10s Window)"}
          </button>
        )}

        {isOpen && (
          <button
            onClick={handleClose}
            disabled={loadingAction !== null}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loadingAction === "close" ? "Closing..." : "■ Close & Finalize Slot"}
          </button>
        )}

        {(isPending || isOpen) && (
          <button
            onClick={handleSkip}
            disabled={loadingAction !== null}
            className="px-3 py-2 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors disabled:opacity-50"
          >
            {loadingAction === "skip" ? "Skipping..." : "Skip Slot"}
          </button>
        )}

        <span className="text-[11px] text-zinc-400 font-mono ml-auto">
          Slot ID: {slot.id.slice(0, 8)}... (Round {slot.round})
        </span>
      </div>

      {feedback && (
        <div
          className={`mt-3 p-2.5 rounded-xl text-xs flex items-center gap-2 ${
            feedback.type === "success"
              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
              : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
          }`}
        >
          <GavelIcon className="w-3.5 h-3.5" />
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  )
}

