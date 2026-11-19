"use client";

/**
 * Scoring realtime hook.
 *
 * Competition scores change when a judge approves a solution, so the
 * leaderboard subscribes to the same normalised event stream the
 * auction uses and re-reads the snapshot when a solution is approved.
 *
 * Handles subscription status, surfaces realtime errors, cleans up properly,
 * and serializes overlapping refresh requests to eliminate race conditions.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { fetchScoringSnapshot, type ScoringSnapshot } from "../services/scoring.service";

export type RealtimeConnectionStatus =
  | "CONNECTING"
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CLOSED"
  | "CHANNEL_ERROR";

export function useScoringRealtime() {
  const [snapshot, setSnapshot] = useState<ScoringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<RealtimeConnectionStatus>("CONNECTING");

  const inFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const refresh = useCallback(async () => {
    // Prevent overlapping refresh requests
    if (inFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    inFlightRef.current = true;
    try {
      const next = await fetchScoringSnapshot();
      setSnapshot(next);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load the scoreboard");
    } finally {
      setLoading(false);
      inFlightRef.current = false;

      // If an update arrived while this fetch was in flight, re-run now
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void refresh();
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;

    const channel: RealtimeChannel = supabase
      .channel("scoring-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "auction_events" },
        (payload) => {
          if (!active) return;
          const row = payload.new as Record<string, unknown>;
          if (
            row.event_type === "solution_approved" ||
            row.event_type === "bonus_time_granted" ||
            row.event_type === "solution_rejected"
          ) {
            void refresh();
          }
        }
      )
      .subscribe((status, err) => {
        if (!active) return;
        setConnectionStatus(status as RealtimeConnectionStatus);
        if (err || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(
            err?.message || `Realtime subscription disconnected: ${status}`
          );
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { snapshot, loading, error, refresh, connectionStatus };
}
