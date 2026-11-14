import { supabase } from "@/lib/supabase"
import type { PlaceBidResult } from "@/types/auction"

export interface PlaceBidParams {
  slotId: string
  amount: number
  currentBid: number
  walletBalance: number
  isLeader: boolean
  hasWonRound: boolean
  isCaptain: boolean
}

export interface PlaceBidResponse {
  success: boolean
  data?: PlaceBidResult
  error?: string
}

/**
 * Validates and dispatches a bid to the database function `public.place_bid`.
 *
 * Enforces Rule Book §5.1, §5.2, §5.3:
 * - Losing bids cost nothing (no deduction on bid).
 * - Minimum bid is 10; minimum raise is 10 above current bid.
 * - Only the team captain can place bids.
 * - Cannot bid if already leading or already won in this round.
 */
export async function submitBid({
  slotId,
  amount,
  currentBid,
  walletBalance,
  isLeader,
  hasWonRound,
  isCaptain,
}: PlaceBidParams): Promise<PlaceBidResponse> {
  // 1. Client-side sanity checks (instant feedback before network call)
  if (!isCaptain) {
    return { success: false, error: "Only the designated team captain can place bids." }
  }

  if (hasWonRound) {
    return { success: false, error: "Your team has already won a slot in this round." }
  }

  if (isLeader) {
    return { success: false, error: "Your team is already the highest bidder on this slot." }
  }

  const minRequired = currentBid === 0 ? 10 : currentBid + 10
  if (amount < minRequired) {
    return {
      success: false,
      error: `Bid too low. Minimum required bid is ${minRequired} points (current: ${currentBid}).`,
    }
  }

  if (amount > walletBalance) {
    return {
      success: false,
      error: `Insufficient balance. Your wallet has ${walletBalance} points remaining.`,
    }
  }

  // 2. Call the atomic PostgreSQL RPC function
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("place_bid", {
      p_slot_id: slotId,
      p_amount: Math.floor(amount),
    })

    if (error) {
      return {
        success: false,
        error: error.message || "Failed to place bid. Please try again.",
      }
    }

    const result = data as unknown as PlaceBidResult
    return {
      success: true,
      data: result,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred"
    return { success: false, error: message }
  }
}
