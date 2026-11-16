"use client";

/**
 * The auction hook used by every surface.
 *
 * It owns exactly one source of truth — the authoritative state from
 * `get_live_auction_state()` — and reconciles it with the realtime
 * event stream. There is no second copy of the auction state and no
 * polling fallback: when the socket drops, the client reconnects and
 * re-reads the state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);

    const result = await fetchLiveAuctionState();

    if (result.success && result.data) {
      setState(result.data);
      setError(null);
    } else {
      setError(result.error ?? "Failed to load the auction state");
    }

    if (teamId) {
      const teamResult = await fetchTeamAuctionState(teamId);
      if (teamResult.success && teamResult.data) {
        setTeamState(teamResult.data);
      }
    }

    if (showSpinner) setRefreshing(false);
    setLoading(false);
  }, [teamId]);

  // Resolve the participant identity once.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await fetchCurrentIdentity();
      if (cancelled) return;

      if (result.success && result.data) {
        setIdentity(result.data);
        if (result.data.teamId) {
          setResolvedTeamId(result.data.teamId);
        }
      } else {
        setError(result.error ?? "You must be signed in to participate.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
