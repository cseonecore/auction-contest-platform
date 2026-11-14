"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import type { SlotWithTopic, AuctionRound, BidEligibility } from "@/types/auction"
import type { TeamRow } from "@/types/database"
import { useWallet } from "./useWallet"

export function useAuctionSession() {
  const [userId, setUserId] = useState<string | null>(null)
  const [team, setTeam] = useState<Pick<TeamRow, "id" | "name"> | null>(null)
  const [isCaptain, setIsCaptain] = useState<boolean>(false)
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  
  const [allSlots, setAllSlots] = useState<SlotWithTopic[]>([])
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null)
  const [currentRound, setCurrentRound] = useState<AuctionRound>(1)
  const [wonRounds, setWonRounds] = useState<Set<AuctionRound>>(new Set())

  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Team wallet hook
  const { wallet, balance, projectedBonusPoints, loading: walletLoading } = useWallet(team?.id ?? null)

  // 1. Resolve User and Team
  const loadUserAndTeam = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setUserId(null)
        setTeam(null)
        setIsCaptain(false)
        setIsAdmin(false)
        return
      }

      setUserId(user.id)
      const userRole = user.app_metadata?.role
      setIsAdmin(userRole === "admin")

      // Fetch team through captain or member check
      const { data: teamData } = await supabase
        .from("teams")
        .select("id, name, captain_id")
        .eq("captain_id", user.id)
        .maybeSingle()

      if (teamData) {
        const t = teamData as unknown as { id: string; name: string }
        setTeam({ id: t.id, name: t.name })
        setIsCaptain(true)
      } else {
        const { data: memberData } = await supabase
          .from("members")
          .select("team_id, team:teams(id, name, captain_id)")
          .eq("id", user.id)
          .maybeSingle()

        const m = memberData as unknown as { team_id: string; team?: TeamRow } | null
        if (m?.team) {
          const t = m.team
          setTeam({ id: t.id, name: t.name })
          setIsCaptain(t.captain_id === user.id)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Auth check failed"
      setError(msg)
    }
  }, [])

  // 2. Fetch all slots & determine active slot / won rounds
  const fetchAuctionState = useCallback(async () => {
    try {
      const { data: slotsData, error: slotsErr } = await supabase
        .from("slots")
        .select(`
          *,
          topic:topics(*)
        `)
        .order("round", { ascending: true })
        .order("id", { ascending: true })

      if (slotsErr) throw slotsErr

      const typedSlots = (slotsData || []) as unknown as SlotWithTopic[]
      setAllSlots(typedSlots)

      // Find first currently 'open' slot
      const openSlot = typedSlots.find((s) => s.status === "open")
      if (openSlot) {
        setActiveSlotId(openSlot.id)
        setCurrentRound(openSlot.round as AuctionRound)
      } else {
        // Fallback to first pending slot
        const pendingSlot = typedSlots.find((s) => s.status === "pending")
        setActiveSlotId(pendingSlot?.id ?? typedSlots[0]?.id ?? null)
        if (pendingSlot) {
          setCurrentRound(pendingSlot.round as AuctionRound)
        }
      }

      // Check won rounds for the current team
      if (team?.id) {
        const won = new Set<AuctionRound>()
        typedSlots.forEach((s) => {
          if (s.winner_team_id === team.id && s.status === "sold") {
            won.add(s.round as AuctionRound)
          }
        })
        setWonRounds(won)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load auction slots"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [team])

  useEffect(() => {
    const run = async () => {
      await loadUserAndTeam()
    }
    void run()
  }, [loadUserAndTeam])

  useEffect(() => {
    const run = async () => {
      await fetchAuctionState()
    }
    void run()

    // Realtime listener for any slot state change across the tournament
    const channel = supabase
      .channel("auction-global-slots")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "slots",
        },
        () => {
          fetchAuctionState()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchAuctionState])

  // Helper to check if current user can bid on the active slot
  const checkBidEligibility = useCallback(
    (slotRound: AuctionRound, leaderTeamId: string | null): BidEligibility => {
      if (!userId) return { canBid: false, reason: "You must be logged in to participate." }
      if (!team) return { canBid: false, reason: "You must be registered in a team." }
      if (!isCaptain) return { canBid: false, reason: "Only your team captain can place bids." }
      if (wonRounds.has(slotRound)) {
        return {
          canBid: false,
          reason: `Your team has already won a topic in Round ${slotRound}. Each team is limited to 1 win per round.`,
        }
      }
      if (leaderTeamId === team.id) {
        return { canBid: false, reason: "Your team is already leading this slot." }
      }
      if (balance < 10) {
        return { canBid: false, reason: "Insufficient balance to place the minimum 10-point bid." }
      }
      return { canBid: true }
    },
    [userId, team, isCaptain, wonRounds, balance]
  )

  return {
    userId,
    team,
    teamId: team?.id ?? null,
    isCaptain,
    isAdmin,
    wallet,
    balance,
    projectedBonusPoints,
    walletLoading,
    allSlots,
    activeSlotId,
    setActiveSlotId,
    currentRound,
    wonRounds,
    loading,
    error,
    checkBidEligibility,
    refetchState: fetchAuctionState,
  }
}
