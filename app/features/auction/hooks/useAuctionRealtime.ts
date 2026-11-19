"use client";

/**
 * Realtime subscription to the single normalised event stream.
 *
 * `public.auction_events` is written by database triggers, so every
 * surface (participant arena, admin console, projector) observes the
 * exact same sequence of events. Clients never assume they received
 * every event: on (re)connect the authoritative state is re-fetched.
 */

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { AuctionConnectionStatus, AuctionEvent } from "../types/auction.types";

interface UseAuctionRealtimeOptions {
  /** Called for every event (already de-duplicated by id). */
  onEvent?: (event: AuctionEvent) => void;
  /** Called when the authoritative state should be re-read. */
  onSyncRequired?: () => void;
  /** Disable the subscription entirely (e.g. in the admin console). */
  enabled?: boolean;
}

const DEBOUNCE_MS = 120;

export function useAuctionRealtime({
  onEvent,
  onSyncRequired,
  enabled = true,
}: UseAuctionRealtimeOptions = {}) {
  const [status, setStatus] = useState<AuctionConnectionStatus>("connecting");
  const [lastEvent, setLastEvent] = useState<AuctionEvent | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const seenEventsRef = useRef<Set<string>>(new Set());
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  const onSyncRef = useRef(onSyncRequired);

  useEffect(() => {
    onEventRef.current = onEvent;
    onSyncRef.current = onSyncRequired;
  }, [onEvent, onSyncRequired]);

  useEffect(() => {
    if (!enabled) {
      setStatus("offline");
      return;
    }

    let cancelled = false;

    const requestSync = () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        onSyncRef.current?.();
      }, DEBOUNCE_MS);
    };

    const handleRow = (row: Record<string, unknown>) => {
      const id = String(row.id ?? "");
      if (id && seenEventsRef.current.has(id)) return;
      if (id) {
        seenEventsRef.current.add(id);
        // Keep the de-duplication window bounded.
        if (seenEventsRef.current.size > 500) {
          const first = seenEventsRef.current.values().next().value;
          if (first) seenEventsRef.current.delete(first);
        }
      }

      const event = {
        id,
        event_type: String(row.event_type ?? ""),
        slot_id: (row.slot_id as string | null) ?? null,
        team_id: (row.team_id as string | null) ?? null,
        payload: (row.payload as Record<string, unknown>) ?? {},
        timer_ends_at: (row.timer_ends_at as string | null) ?? null,
        timer_status: (row.timer_status as AuctionEvent["timer_status"]) ?? null,
        server_timestamp: String(row.server_timestamp ?? new Date().toISOString()),
      } as AuctionEvent;

      setLastEvent(event);
      onEventRef.current?.(event);
      requestSync();
    };

    const channel = supabase
      .channel("auction-event-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "auction_events" },
        (payload) => handleRow(payload.new as Record<string, unknown>)
      )
      .subscribe((subscriptionStatus) => {
        if (cancelled) return;

        if (subscriptionStatus === "SUBSCRIBED") {
          setStatus("connected");
          // Re-read the authoritative state on every (re)connect: the
          // client may have missed events while it was offline.
          requestSync();
        } else if (
          subscriptionStatus === "CHANNEL_ERROR" ||
          subscriptionStatus === "TIMED_OUT"
        ) {
          setStatus("reconnecting");
        } else if (subscriptionStatus === "CLOSED") {
          setStatus("offline");
        }
      });

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [enabled]);

  return { status, lastEvent };
}
