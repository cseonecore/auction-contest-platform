/**
 * useSubmissionSession — top-level state for the submission page.
 *
 * Similar to useAuctionSession, this resolves:
 *   - The signed-in user and their team
 *   - Whether the user is the team captain (only captains can submit)
 *   - Which slots the team won in the auction
 *   - Existing submissions for those slots
 *
 * The submission UI (built later by another teammate) will consume this hook.
 */

"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import type { TeamRow, SubmissionRow } from "@/types/database"
import type { WonSlot } from "@/types/submission"

export interface SubmissionSession {
  // ── Auth & team ────────────────────────────────────────────
  userId: string | null
  teamId: string | null
  teamName: string | null
  isCaptain: boolean

  // ── Won slots ──────────────────────────────────────────────
  /** Slots this team won in the auction (status = 'sold'). */
  wonSlots: WonSlot[]
  /** Convenience: the easy slot, if the team won one. */
  easySlot: WonSlot | null
  /** Convenience: the hard slot, if the team won one. */
  hardSlot: WonSlot | null

  // ── Existing submissions ───────────────────────────────────
  /** One per won slot, or empty if not yet submitted. */
  submissions: SubmissionRow[]

  // ── Meta ───────────────────────────────────────────────────
  loading: boolean
  error: string | null

  /** Re-fetch submissions (e.g. after submitting a slot). */
  refetch: () => Promise<void>
}

export function useSubmissionSession(): SubmissionSession {
  const [userId, setUserId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [teamName, setTeamName] = useState<string | null>(null)
  const [isCaptain, setIsCaptain] = useState(false)

  const [wonSlots, setWonSlots] = useState<WonSlot[]>([])
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Resolve user and team (same pattern as useAuctionSession) ──
  const loadSession = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // 1. Get authenticated user
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setUserId(null)
        setTeamId(null)
        setIsCaptain(false)
        setLoading(false)
        return
      }
      setUserId(user.id)

      // 2. Find the user's team
      //    First try: direct captain lookup
      let resolvedTeamId: string | null = null
      let resolvedTeamName: string | null = null
      let resolvedIsCaptain = false

      const { data: captainTeam } = await supabase
        .from("teams")
        .select("id, name, captain_id")
        .eq("captain_id", user.id)
        .maybeSingle()

      if (captainTeam) {
        const t = captainTeam as unknown as TeamRow
        resolvedTeamId = t.id
        resolvedTeamName = t.name
        resolvedIsCaptain = true
      } else {
        // Fallback: member lookup with team join
        const { data: memberData } = await supabase
          .from("members")
          .select("team_id, team:teams(id, name, captain_id)")
          .eq("id", user.id)
          .maybeSingle()

        const m = memberData as unknown as {
          team_id: string
          team?: TeamRow
        } | null

        if (m?.team) {
          resolvedTeamId = m.team.id
          resolvedTeamName = m.team.name
          resolvedIsCaptain = m.team.captain_id === user.id
        }
      }

      setTeamId(resolvedTeamId)
      setTeamName(resolvedTeamName)
      setIsCaptain(resolvedIsCaptain)

      if (!resolvedTeamId) {
        setLoading(false)
        return
      }

      // 3. Fetch the slots this team won
      const { data: slotsData, error: slotsErr } = await supabase
        .from("slots")
        .select(
          `id, topic_id, round, status, winner_team_id,
           topic:topics(id, level, title, description)`
        )
        .eq("winner_team_id", resolvedTeamId)
        .eq("status", "sold")

      if (slotsErr) throw slotsErr

      const typedSlots = (slotsData || []) as unknown as WonSlot[]
      setWonSlots(typedSlots)

      // 4. Fetch existing submissions for this team
      const { data: subData, error: subErr } = await supabase
        .from("submissions")
        .select("*")
        .eq("team_id", resolvedTeamId)

      if (subErr) throw subErr
      setSubmissions((subData || []) as unknown as SubmissionRow[])
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load submission session"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  // ── Derived state ──
  const easySlot = wonSlots.find((s) => s.topic.level === "easy") ?? null
  const hardSlot = wonSlots.find((s) => s.topic.level === "hard") ?? null

  return {
    userId,
    teamId,
    teamName,
    isCaptain,
    wonSlots,
    easySlot,
    hardSlot,
    submissions,
    loading,
    error,
    refetch: loadSession,
  }
}

