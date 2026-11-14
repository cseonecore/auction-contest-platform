"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import type { WalletRow } from "@/types/database"

export function useWallet(teamId: string | null) {
  const [wallet, setWallet] = useState<WalletRow | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0)

  useEffect(() => {
    if (!teamId) return

    let isMounted = true

    const loadWallet = async () => {
      try {
        const { data, error: err } = await supabase
          .from("wallets")
          .select("*")
          .eq("team_id", teamId)
          .single()

        if (!isMounted) return
        if (err) throw err
        setWallet(data)
        setError(null)
      } catch (err: unknown) {
        if (!isMounted) return
        const msg = err instanceof Error ? err.message : "Failed to load wallet"
        setError(msg)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void loadWallet()

    const channel = supabase
      .channel(`wallet-${teamId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wallets",
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          setWallet(payload.new as WalletRow)
        }
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [teamId, refreshTrigger])

  const effectiveWallet = teamId ? wallet : null
  const projectedBonusPoints = effectiveWallet ? Math.floor(effectiveWallet.balance / 3) : 0

  return {
    wallet: effectiveWallet,
    balance: effectiveWallet?.balance ?? 0,
    projectedBonusPoints,
    loading: teamId ? loading : false,
    error,
    refetch: () => setRefreshTrigger((prev) => prev + 1),
  }
}
