"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { LeaderboardTeam } from "../components/LeaderboardCapsule";

export function useAuctionLeaderboard(slotId?: string | null) {
  const [teams, setTeams] = useState<LeaderboardTeam[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const url = slotId ? `/api/auction/teams?slotId=${slotId}` : "/api/auction/teams";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load leaderboard");
      const data = await res.json();
      if (data.success) {
        setTeams(data.teams || []);
        setError(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading leaderboard";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [slotId]);

  useEffect(() => {
    fetchLeaderboard();

    const channel = supabase
      .channel(`leaderboard-${slotId || "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, () => {
        fetchLeaderboard();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "slots" }, () => {
        fetchLeaderboard();
      })
      .subscribe();

    const poll = setInterval(fetchLeaderboard, 2500);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [fetchLeaderboard, slotId]);

  return {
    teams,
    loading,
    error,
    refetch: fetchLeaderboard,
  };
}
