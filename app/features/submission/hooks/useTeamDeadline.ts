/**
 * useTeamDeadline — the authoritative submission deadline for a team.
 *
 * Calls the team_deadline(p_team_id) database function, which computes:
 *   base_deadline + (10 min × number_of_challenge_solves, capped at 60 min)
 *
 * Also fetches the team's solve count so the UI can show bonus breakdown.
 * Updates every 30 seconds so the countdown stays fresh.
 */

"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import type { TeamDeadlineState } from "@/types/submission"

export function useTeamDeadline(teamId: string | null): TeamDeadlineState {
  const [deadline, setDeadline] = useState<string | null>(null)
  const [solveCount, setSolveCount] = useState(0)
  const [msRemaining, setMsRemaining] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Keep a ref to the deadline so the interval callback can read it
  const deadlineRef = useRef<string | null>(null)

  const fetchDeadline = useCallback(async () => {
    if (!teamId) {
      setLoading(false)
      return
    }

    try {
      setError(null)

      // 1. Call the team_deadline RPC
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dl, error: dlErr } = await (supabase.rpc as any)(
        "team_deadline",
        { p_team_id: teamId }
      )

      if (dlErr) throw dlErr

      const deadlineStr = dl as string
      setDeadline(deadlineStr)
      deadlineRef.current = deadlineStr

      // 2. Fetch solve count so the UI knows how many bonuses were earned
      const { count, error: countErr } = await supabase
        .from("challenge_solves")
        .select("*", { count: "exact", head: true })
        .eq("team_id", teamId)

      if (countErr) throw countErr
      setSolveCount(count ?? 0)

      // 3. Calculate remaining time
      const remaining = new Date(deadlineStr).getTime() - Date.now()
      setMsRemaining(remaining)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to fetch deadline"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [teamId])

  // Fetch on mount and when teamId changes
  useEffect(() => {
    void fetchDeadline()
  }, [fetchDeadline])

  // Tick the countdown every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (deadlineRef.current) {
        const remaining =
          new Date(deadlineRef.current).getTime() - Date.now()
        setMsRemaining(remaining)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Re-fetch the deadline every 30 seconds
  // (in case the team solves a challenge and the deadline extends)
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchDeadline()
    }, 30_000)

    return () => clearInterval(interval)
  }, [fetchDeadline])

  return {
    deadline,
    msRemaining,
    isExpired: msRemaining < 0,
    solveCount,
    // bonusMinutes cannot be computed accurately on the client because
    // the settings table (challenge_bonus_minutes_per_solve, etc.) is
    // admin-only.  The `deadline` from team_deadline() is the single
    // source of truth — it already includes the correct bonus.
    bonusMinutes: null,
    loading,
    error,
  }
}

