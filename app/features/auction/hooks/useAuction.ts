"use client";

/**
 * The auction hook used by every surface.
 *
 * It owns exactly one source of truth — the authoritative state from
 * `get_live_auction_state()` — and reconciles it with the realtime
 * event stream. The realtime channel is the primary sync path, but it
 * is never the ONLY path: a periodic re-read and a re-read on window
 * focus heal a dropped subscription or a missed event.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  fetchCurrentIdentity,
  fetchLiveAuctionState,
  fetchTeamAuctionState,
  placeBid as placeBidService,
} from "../services/auction.service";
import { useAuctionRealtime } from "./useAuctionRealtime";
import type {
  AuctionConnectionStatus,
  AuctionEvent,
  LiveAuctionState,
  TeamAuctionState,
} from "../types/auction.types";
import { EMPTY_SETTINGS } from "../types/auction.types";

export interface UseAuctionReturn {
  state: LiveAuctionState;
  identity: {
    userId: string | null;
    teamId: string | null;
    teamName: string | null;
    isCaptain: boolean;
  };
  teamState: TeamAuctionState | null;
  connection: AuctionConnectionStatus;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastEvent: AuctionEvent | null;
  refresh: () => Promise<void>;
  placeBid: (slotId: string, amount: number) => Promise<{ success: boolean; error?: string }>;
}

export function useAuction(options: { teamId?: string | null } = {}): UseAuctionReturn {
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

  const [identity, setIdentity] = useState<{
    userId: string | null;
    teamId: string | null;
    teamName: string | null;
    isCaptain: boolean;
  }>({ userId: null, teamId: null, teamName: null, isCaptain: false });

  const [teamState, setTeamState] = useState<TeamAuctionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The team the participant belongs to (resolved from the session).
  const [resolvedTeamId, setResolvedTeamId] = useState<string | null>(
    options.teamId ?? null
  );
  const teamId = options.teamId ?? resolvedTeamId;

  // Monotonic sequence number: only the LATEST load may land. The
  // realtime channel, the timer expiry, a window focus and the periodic
  // re-read all fire overlapping loads — without this guard an older
  // response could overwrite newer state (e.g. resurrect a bid that
  // was just outbid, or rewind the countdown).
  const loadSeqRef = useRef(0);

  const load = useCallback(
    async (showSpinner = false) => {
      const seq = ++loadSeqRef.current;
      if (showSpinner) setRefreshing(true);

      const result = await fetchLiveAuctionState();

      // A newer load superseded this one — discard it entirely.
      if (seq !== loadSeqRef.current) {
        if (showSpinner) setRefreshing(false);
        return;
      }

      if (result.success && result.data) {
        setState(result.data);
        setError(null);
      } else {
        setError(result.error ?? "Failed to load the auction state");
      }

      if (teamId) {
        const teamResult = await fetchTeamAuctionState(teamId);
        if (seq !== loadSeqRef.current) {
          if (showSpinner) setRefreshing(false);
          return;
        }
        if (teamResult.success && teamResult.data) {
          setTeamState(teamResult.data);
        }
      }

      if (showSpinner) setRefreshing(false);
      setLoading(false);
    },
    [teamId]
  );

  // Resolve the participant identity. Re-run whenever the browser's
  // Supabase session changes (login adopted via setSession, sign-out,
  // token re-issue) so `identity.isCaptain` can never go stale.
  const resolveIdentity = useCallback(async () => {
    const result = await fetchCurrentIdentity();

    if (result.success && result.data) {
      setIdentity(result.data);
      if (result.data.teamId) {
        setResolvedTeamId(result.data.teamId);
      }
    } else {
      setError(result.error ?? "You must be signed in to participate.");
    }
  }, []);

  useEffect(() => {
    void resolveIdentity();
  }, [resolveIdentity]);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setIdentity({ userId: null, teamId: null, teamName: null, isCaptain: false });
        setResolvedTeamId(null);
        setError("You must be signed in to participate.");
        return;
      }

      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        void resolveIdentity();
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, [resolveIdentity]);

  // Initial authoritative load.
  useEffect(() => {
    void load(true);
  }, [load]);

  // Realtime reconciliation.
  const { status: connection, lastEvent } = useAuctionRealtime({
    onSyncRequired: () => {
      void load(false);
    },
  });

  // Safety net for the realtime path: re-read the authoritative state
  // periodically while the tab is visible, and immediately when the
  // tab regains focus. Realtime stays primary; this only heals a
  // dropped subscription or an event that never arrived.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const resync = () => {
      if (document.visibilityState !== "visible") return;
      void load(false);
    };

    const interval = window.setInterval(resync, 15000);
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [load]);

  const placeBid = useCallback(
    async (slotId: string, amount: number) => {
      const result = await placeBidService(slotId, amount);

      if (result.success) {
        // Re-read the authoritative state instead of patching it locally.
        void load(false);
        return { success: true };
      }

      return { success: false, error: result.error ?? "Failed to place the bid" };
    },
    [load]
  );

  return useMemo(
    () => ({
      state,
      identity,
      teamState,
      connection,
      loading,
      refreshing,
      error,
      lastEvent,
      refresh: () => load(true),
      placeBid,
    }),
    [state, identity, teamState, connection, loading, refreshing, error, lastEvent, load, placeBid]
  );
}
