"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface AuctionStateSlot {
  id: string;
  round: number;
  status: "pending" | "open" | "sold" | "skipped";
  current_bid: number;
  leader_team_id: string | null;
  end_time: string | null;
  winner_team_id: string | null;
  topic?: {
    id: string;
    level: string;
    title: string;
    description: string;
    criterion?: any;
  } | null;
  leader_team?: {
    id: string;
    name: string;
  } | null;
  winner_team?: {
    id: string;
    name: string;
  } | null;
}

export function useAuctionState() {
  const [auctionStatus, setAuctionStatus] = useState<"LIVE" | "UPCOMING" | "PAUSED" | "COMPLETED">("UPCOMING");
  const [activeSlot, setActiveSlot] = useState<AuctionStateSlot | null>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(1);
  const [totalSlots, setTotalSlots] = useState<number>(40);
  const [slots, setSlots] = useState<AuctionStateSlot[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [settings, setSettings] = useState({
    min_bid: 10,
    min_raise: 10,
    opening_window_seconds: 10,
    timer_extension_seconds: 5,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/auction/state", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load auction state");
      const data = await res.json();

      if (data.success) {
        setAuctionStatus(data.auctionStatus);
        setActiveSlot(data.activeSlot);
        setActiveSlotIndex(data.activeSlotIndex);
        setTotalSlots(data.totalSlots);
        setSlots(data.slots || []);
        setHistory(data.history || []);
        setSettings(data.settings);
        setError(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading auction state";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();

    const channel = supabase
      .channel("hook-auction-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "slots" }, () => {
        fetchState();
      })
      .subscribe();

    const interval = setInterval(fetchState, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [fetchState]);

  return {
    auctionStatus,
    activeSlot,
    activeSlotIndex,
    totalSlots,
    slots,
    history,
    settings,
    loading,
    error,
    refetch: fetchState,
  };
}
