"use client"

import { useEffect, useState, useRef } from "react"
import { supabase } from "@/lib/supabase"
import type { SlotWithDetails, CountdownState } from "@/types/auction"
import { calculateCountdown } from "../utils/countdown"

const INITIAL_COUNTDOWN: CountdownState = {
  secondsLeft: 0,
  isExpired: true,
  isUrgent: false,
  isCritical: false,
}

export function useSlot(slotId: string | null) {
  const [slot, setSlot] = useState<SlotWithDetails | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<CountdownState>(INITIAL_COUNTDOWN)
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0)

  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!slotId) return

    let isMounted = true

    const loadSlot = async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from("slots")
          .select(`
            *,
            topic:topics(*),
            leader_team:teams!slots_leader_team_id_fkey(id, name),
            winner_team:teams!slots_winner_team_id_fkey(id, name)
          `)
          .eq("id", slotId)
          .single()

        if (!isMounted) return
        if (fetchErr) throw fetchErr
        setSlot(data as unknown as SlotWithDetails)
        setError(null)
      } catch (err: unknown) {
        if (!isMounted) return
        const msg = err instanceof Error ? err.message : "Failed to load slot"
        setError(msg)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void loadSlot()

    const channel = supabase
      .channel(`slot-${slotId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "slots",
          filter: `id=eq.${slotId}`,
        },
        () => {
          void loadSlot()
        }
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [slotId, refreshTrigger])

  // Countdown timer interval loop
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)

    if (!slot || slot.status !== "open" || !slot.end_time) {
      return
    }

    const tick = () => {
      const state = calculateCountdown(slot.end_time)
      setCountdown(state)
      if (state.isExpired && timerRef.current) {
        clearInterval(timerRef.current)
      }
    }

    timerRef.current = setInterval(tick, 250)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [slot?.end_time, slot?.status, slot])

  const effectiveSlot = slotId ? slot : null
  const effectiveCountdown =
    effectiveSlot && effectiveSlot.status === "open" && effectiveSlot.end_time
      ? calculateCountdown(effectiveSlot.end_time)
      : INITIAL_COUNTDOWN

  return {
    slot: effectiveSlot,
    loading: slotId ? loading : false,
    error,
    countdown: countdown.secondsLeft > 0 ? countdown : effectiveCountdown,
    refetch: () => setRefreshTrigger((prev) => prev + 1),
  }
}
