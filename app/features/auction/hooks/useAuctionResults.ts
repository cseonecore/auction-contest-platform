"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface CompletedSlotResult {
  slotId: string;
  slotNumber: number;
  round: number;
  status: "sold" | "skipped";
  topicTitle: string;
  description?: string;
  winnerTeam?: { id: string; name: string } | null;
  winningBid: number;
  coinsDeducted: number;
  endTime: string | null;
}

export function useAuctionResults() {
  const [results, setResults] = useState<CompletedSlotResult[]>([]);
  const [totalSlots, setTotalSlots] = useState<number>(40);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch("/api/auction/history", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load auction history");
      const data = await res.json();
      if (data.success) {
        setResults(data.results || []);
        setTotalSlots(data.totalSlots || 40);
        setError(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading history";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults();

    const channel = supabase
      .channel("auction-results-history")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "slots" }, () => {
        fetchResults();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchResults]);

  return {
    results,
    totalSlots,
    loading,
    error,
    refetch: fetchResults,
  };
}
