"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  AuctionConnectionStatus,
  AuctionEvent,
  LiveAuctionState,
} from "@/features/auction/types/auction.types";
import { EMPTY_SETTINGS } from "@/features/auction/types/auction.types";

/**
 * Projector auction state.
 *
 * Read-only by construction: the projector only ever calls the public
 * read function `get_live_auction_state()` and listens to the public
 * event stream. It has no session, no admin controls and no access to
 * submissions, wallets or audit records.
 */
export function useProjectorAuction() {
  const [state, setState] = useState<LiveAuctionState>({
    server_time: null,
    session: null,
    active_slot: null,
    bids: [],
    teams: [],
    settings: EMPTY_SETTINGS,
    events: [],
    eliminations: [],
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<AuctionConnectionStatus>("connecting");
  const [lastEvent, setLastEvent] = useState<AuctionEvent | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_live_auction_state");

    setState((previous) => {
      if (error) return previous;
      const next = (data ?? {}) as Partial<LiveAuctionState>;
      return {
        server_time: next.server_time ?? null,
        session: next.session ?? null,
        active_slot: next.active_slot ?? null,
        bids: next.bids ?? [],
        teams: next.teams ?? [],
        settings: next.settings ?? EMPTY_SETTINGS,
        events: next.events ?? [],
        eliminations: next.eliminations ?? [],
      };
    });

    if (error) {
      setError(error.message);
    } else {
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;

    const requestSync = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        void load();
      }, 150);
    };

    channel = supabase
      .channel("projector-auction")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "auction_events" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          setLastEvent({
            id: String(row.id ?? ""),
            event_type: String(row.event_type ?? ""),
            slot_id: (row.slot_id as string | null) ?? null,
            team_id: (row.team_id as string | null) ?? null,
            payload: (row.payload as Record<string, unknown>) ?? {},
            timer_ends_at: (row.timer_ends_at as string | null) ?? null,
            timer_status: (row.timer_status as never) ?? null,
            server_timestamp: String(row.server_timestamp ?? new Date().toISOString()),
          });
          requestSync();
        }
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setConnection("connected");
          requestSync();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("reconnecting");
        } else if (status === "CLOSED") {
          setConnection("offline");
        }
      });

    void load();

    // A slow heartbeat keeps the auditorium display honest even if a
    // websocket event is missed.
    const heartbeat = setInterval(() => {
      void load();
    }, 15000);

    return () => {
      cancelled = true;
      if (syncTimer) clearTimeout(syncTimer);
      clearInterval(heartbeat);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load]);

  return { state, loading, error, connection, lastEvent, refresh: load };
}
