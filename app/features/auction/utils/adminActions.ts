import { supabase } from "@/lib/supabase"
import type { OpenSlotResult, CloseSlotResult, SkipSlotResult } from "@/types/auction"

/**
 * Admin action to open a pending slot with a 10-second opening window.
 */
export async function openAuctionSlot(slotId: string): Promise<{ success: boolean; data?: OpenSlotResult; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("open_slot", { p_slot_id: slotId })
  if (error) return { success: false, error: error.message }
  return { success: true, data: data as unknown as OpenSlotResult }
}

/**
 * Admin action to close an open slot.
 * If leader exists -> sells slot and deducts winning amount from winner's wallet.
 * If no leader -> marks slot as skipped.
 */
export async function closeAuctionSlot(slotId: string): Promise<{ success: boolean; data?: CloseSlotResult; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("close_slot", { p_slot_id: slotId })
  if (error) return { success: false, error: error.message }
  return { success: true, data: data as unknown as CloseSlotResult }
}

/**
 * Admin action to manually skip a slot.
 */
export async function skipAuctionSlot(slotId: string): Promise<{ success: boolean; data?: SkipSlotResult; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("skip_slot", { p_slot_id: slotId })
  if (error) return { success: false, error: error.message }
  return { success: true, data: data as unknown as SkipSlotResult }
}
