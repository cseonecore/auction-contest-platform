"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import type { BidWithTeam } from "@/types/auction"

export function useBids(slotId: string | null) {
  const [bids, setBids] = useState<BidWithTeam[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0)

  useEffect(() => {
    if (!slotId) return

    let isMounted = true

    const loadBids = async () => {
      const { data, error } = await supabase
        .from("bids")
        .select(`
          *,
          team:teams(id, name)
        `)
        .eq("slot_id", slotId)
        .order("server_time", { ascending: false })

      if (!isMounted) return
      if (!error && data) {
        setBids(data as unknown as BidWithTeam[])
      }
      setLoading(false)
    }

    void loadBids()

    const channel = supabase
      .channel(`bids-${slotId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bids",
          filter: `slot_id=eq.${slotId}`,
        },
        () => {
          void loadBids()
        }
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [slotId, refreshTrigger])

  const effectiveBids = slotId ? bids : []

  return {
    bids: effectiveBids,
    loading: slotId ? loading : false,
    refetch: () => setRefreshTrigger((prev) => prev + 1),
  }
}
