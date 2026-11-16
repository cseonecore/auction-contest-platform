"use client";

/**
 * Scoring realtime hook.
 *
 * Competition scores change when a judge approves a solution, so the
 * leaderboard subscribes to the same normalised event stream the
 * auction uses and re-reads the snapshot when a solution is approved.
 */

import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { fetchScoringSnapshot, type ScoringSnapshot } from "../services/scoring.service";

export function useScoringRealtime() {
  const [snapshot, setSnapshot] = useState<ScoringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchScoringSnapshot();
      setSnapshot(next);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load the scoreboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const channel: RealtimeChannel = supabase
      .channel("scoring-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "auction_events" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.event_type === "solution_approved" || row.event_type === "bonus_time_granted") {
            void refresh();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
