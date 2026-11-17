'use client';

/**
 * useAdminAuction Hook
 * Bid2Build (Auction Contest Platform)
 *
 * Central React hook managing Admin Auction state, data fetching,
 * Realtime synchronization, concurrency-safe RPC controls, and filtering.
 *
 * Enforces Rule Book §5 constraints and relies on database as single source of truth.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  AdminSlotWithDetails,
  AdminBidWithTeam,
  AdminTeamAuctionAllocation,
  AuctionOverviewStats,
  AdminAuctionAuditEvent,
  SlotStatusFilter,
  SlotRoundFilter,
  AuctionActionFeedback,
  ActionInProgressState,
  CreateTopicFormValues,
  UseAdminAuctionOptions,
  UseAdminAuctionReturn,
  RealtimeSubscriptionStatus,
} from '../types/auctionAdmin';
import {
  fetchAllSlotsWithDetails,
  fetchRecentBids,
  fetchTeamWalletAllocations,
  fetchAuctionAuditLogs,
  fetchAuctionOverviewStats,
  openSlot,
  closeSlot,
  skipSlot,
  resetAuction,
  createAuctionTopic,
  subscribeToAuctionRealtime,
} from '../services/auctionAdminService';

export function useAdminAuction(
  options: UseAdminAuctionOptions = {}
): UseAdminAuctionReturn {
  const { autoSubscribeRealtime = true, pollIntervalMs = null } = options;

  // Data states
  const [slots, setSlots] = useState<AdminSlotWithDetails[]>([]);
  const [teamAllocations, setTeamAllocations] = useState<AdminTeamAuctionAllocation[]>([]);
  const [recentBids, setRecentBids] = useState<AdminBidWithTeam[]>([]);
  const [overviewStats, setOverviewStats] = useState<AuctionOverviewStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuctionAuditEvent[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  // Status & loading states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<ActionInProgressState | null>(null);
  const [actionFeedback, setActionFeedback] = useState<AuctionActionFeedback | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeSubscriptionStatus>(
    autoSubscribeRealtime ? 'CONNECTING' : 'CLOSED'
  );
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Filter & search states
  const [statusFilter, setStatusFilter] = useState<SlotStatusFilter>('all');
  const [roundFilter, setRoundFilter] = useState<SlotRoundFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Refs for concurrency guards and lifecycle safety
  const isExecutingActionRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Debounced trigger to refresh state when Realtime events arrive.
   * Prevents database query storms while ensuring state is kept fresh.
   * Functional state updater avoids stale closures.
   */
  const scheduleSync = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setRefreshTrigger((prev) => prev + 1);
    }, 300);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Effect 1: Realtime subscription lifecycle (independent of data refreshes)
  // Subscribes once on mount (if enabled) and stays connected continuously.
  // Unsubscribes ONLY on unmount or if autoSubscribeRealtime changes.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoSubscribeRealtime) {
      return;
    }

    let isSubMounted = true;

    const sub = subscribeToAuctionRealtime({
      onSlotChange: () => {
        scheduleSync();
      },
      onBidInsert: () => {
        scheduleSync();
      },
      onWalletChange: () => {
        scheduleSync();
      },
      onStatusChange: (status) => {
        if (isSubMounted) {
          setRealtimeStatus(status);
        }
      },
    });

    return () => {
      isSubMounted = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      sub.unsubscribe();
    };
  }, [autoSubscribeRealtime, scheduleSync]);

  // ─────────────────────────────────────────────────────────────
  // Effect 2: Authoritative data fetching & optional fallback polling
  // Runs on mount and whenever refreshTrigger increments (manual refresh, actions, or Realtime events).
  // Does NOT teardown or touch the Realtime subscription.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    async function fetchAuctionData() {
      try {
        const [
          slotsRes,
          allocationsRes,
          bidsRes,
          statsRes,
          auditRes,
        ] = await Promise.all([
          fetchAllSlotsWithDetails(),
          fetchTeamWalletAllocations(),
          fetchRecentBids({ limit: 40 }),
          fetchAuctionOverviewStats(),
          fetchAuctionAuditLogs({ limit: 30 }),
        ]);

        if (!isMounted) return;

        if (!slotsRes.success || !slotsRes.data) {
          throw new Error(slotsRes.error || 'Failed to fetch auction slots');
        }

        setSlots(slotsRes.data);

        if (allocationsRes.success && allocationsRes.data) {
          setTeamAllocations(allocationsRes.data);
        }

        if (bidsRes.success && bidsRes.data) {
          setRecentBids(bidsRes.data);
        }

        if (statsRes.success && statsRes.data) {
          setOverviewStats(statsRes.data);
        }

        if (auditRes.success && auditRes.data) {
          setAuditLogs(auditRes.data);
        }

        setError(null);
      } catch (err) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Unexpected error loading auction data';
        setError(msg);
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsInitialLoad(false);
        }
      }
    }

    void fetchAuctionData();

    // Optional fallback polling loop (suppressed while executing an action)
    let pollInterval: NodeJS.Timeout | null = null;
    if (pollIntervalMs && pollIntervalMs > 0) {
      pollInterval = setInterval(() => {
        if (isMounted && !isExecutingActionRef.current) {
          void fetchAuctionData();
        }
      }, pollIntervalMs);
    }

    return () => {
      isMounted = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [refreshTrigger, pollIntervalMs]);

  // ─────────────────────────────────────────────────────────────
  // Derived state: Active slot & Selected slot
  // ─────────────────────────────────────────────────────────────

  const activeSlot = useMemo(() => {
    return slots.find((s) => s.status === 'open') ?? null;
  }, [slots]);

  const selectedSlot = useMemo(() => {
    if (!selectedSlotId) return null;
    return slots.find((s) => s.id === selectedSlotId) ?? null;
  }, [slots, selectedSlotId]);

  // ─────────────────────────────────────────────────────────────
  // Derived state: Filtered slots
  // ─────────────────────────────────────────────────────────────

  const filteredSlots = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return slots.filter((slot) => {
      // Status filter
      if (statusFilter !== 'all' && slot.status !== statusFilter) {
        return false;
      }

      // Round filter
      if (roundFilter !== 'all' && slot.round !== roundFilter) {
        return false;
      }

      // Search filter
      if (query) {
        const matchesTopicTitle =
          slot.topic?.title?.toLowerCase().includes(query) ?? false;
        const matchesTopicDesc =
          slot.topic?.description?.toLowerCase().includes(query) ?? false;
        const matchesLeader =
          slot.leader_team?.name?.toLowerCase().includes(query) ?? false;
        const matchesWinner =
          slot.winner_team?.name?.toLowerCase().includes(query) ?? false;
        const matchesId = slot.id.toLowerCase().includes(query);

        if (
          !matchesTopicTitle &&
          !matchesTopicDesc &&
          !matchesLeader &&
          !matchesWinner &&
          !matchesId
        ) {
          return false;
        }
      }

      return true;
    });
  }, [slots, statusFilter, roundFilter, searchQuery]);

  // ─────────────────────────────────────────────────────────────
  // Concurrency-guarded Lifecycle Actions
  // ─────────────────────────────────────────────────────────────

  /**
   * Opens a pending auction slot with a 10-second opening window.
   * Concurrency-guarded: rejects if another action is in progress or slot is not pending.
   * Accepts optional custom starting bid points (defaults to 10).
   */
  const handleOpenSlot = useCallback(
    async (slotId: string, startingBid: number = 10): Promise<boolean> => {
      if (isExecutingActionRef.current) {
        setActionFeedback({
          type: 'error',
          message: 'Another auction action is already in progress. Please wait.',
        });
        return false;
      }

      const target = slots.find((s) => s.id === slotId);
      if (!target) {
        setActionFeedback({ type: 'error', message: 'Target auction slot not found.' });
        return false;
      }

      if (target.status !== 'pending') {
        setActionFeedback({
          type: 'error',
          message: `Cannot open slot: status is currently "${target.status}". Only pending slots can be opened.`,
        });
        return false;
      }

      if (typeof startingBid !== 'number' || isNaN(startingBid) || startingBid <= 0) {
        setActionFeedback({
          type: 'error',
          message: 'Starting bid points must be a valid positive whole number.',
        });
        return false;
      }

      // Check if there is already another open slot
      const existingOpen = slots.find((s) => s.status === 'open' && s.id !== slotId);
      if (existingOpen) {
        setActionFeedback({
          type: 'error',
          message: `Cannot open slot: Slot #${existingOpen.id.slice(0, 8)} is already open. Close or skip it first.`,
        });
        return false;
      }

      isExecutingActionRef.current = true;
      setActionInProgress({ slotId, action: 'open' });
      setActionFeedback(null);

      try {
        const res = await openSlot(slotId, startingBid);
        if (!res.success) {
          setActionFeedback({
            type: 'error',
            message: res.error || 'Failed to open slot.',
          });
          return false;
        }

        setActionFeedback({
          type: 'success',
          message: `Slot opened successfully! 10-second bidding window is active (starting bid: ${startingBid} pts).`,
        });

        setRefreshTrigger((prev) => prev + 1);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to execute openSlot RPC';
        setActionFeedback({ type: 'error', message: msg });
        return false;
      } finally {
        setActionInProgress(null);
        isExecutingActionRef.current = false;
      }
    },
    [slots]
  );

  /**
   * Closes an active open slot.
   * - If highest bidder exists: assigns win and deducts points from wallet.
   * - If no bids: marks slot as skipped.
   * Concurrency-guarded: rejects if another action is in progress or slot is not open.
   */
  const handleCloseSlot = useCallback(
    async (slotId: string): Promise<boolean> => {
      if (isExecutingActionRef.current) {
        setActionFeedback({
          type: 'error',
          message: 'Another auction action is already in progress. Please wait.',
        });
        return false;
      }

      const target = slots.find((s) => s.id === slotId);
      if (!target) {
        setActionFeedback({ type: 'error', message: 'Target auction slot not found.' });
        return false;
      }

      if (target.status !== 'open') {
        setActionFeedback({
          type: 'error',
          message: `Cannot close slot: status is currently "${target.status}". Only open slots can be closed.`,
        });
        return false;
      }

      isExecutingActionRef.current = true;
      setActionInProgress({ slotId, action: 'close' });
      setActionFeedback(null);

      try {
        const res = await closeSlot(slotId);
        if (!res.success) {
          setActionFeedback({
            type: 'error',
            message: res.error || 'Failed to close slot.',
          });
          return false;
        }

        const isSold = res.data?.status === 'sold';
        const msg = isSold
          ? `Slot closed and SOLD for ${res.data?.winning_bid ?? 0} pts to winning team!`
          : `Slot closed with 0 bids and marked as SKIPPED.`;

        setActionFeedback({ type: 'success', message: msg });

        setRefreshTrigger((prev) => prev + 1);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to execute closeSlot RPC';
        setActionFeedback({ type: 'error', message: msg });
        return false;
      } finally {
        setActionInProgress(null);
        isExecutingActionRef.current = false;
      }
    },
    [slots]
  );

  /**
   * Manually skips a pending or open slot via Admin override.
   * Concurrency-guarded: rejects if another action is in progress or slot is already sold/skipped.
   */
  const handleSkipSlot = useCallback(
    async (slotId: string): Promise<boolean> => {
      if (isExecutingActionRef.current) {
        setActionFeedback({
          type: 'error',
          message: 'Another auction action is already in progress. Please wait.',
        });
        return false;
      }

      const target = slots.find((s) => s.id === slotId);
      if (!target) {
        setActionFeedback({ type: 'error', message: 'Target auction slot not found.' });
        return false;
      }

      if (target.status !== 'pending' && target.status !== 'open') {
        setActionFeedback({
          type: 'error',
          message: `Cannot skip slot: status is "${target.status}". Only pending or open slots can be skipped.`,
        });
        return false;
      }

      isExecutingActionRef.current = true;
      setActionInProgress({ slotId, action: 'skip' });
      setActionFeedback(null);

      try {
        const res = await skipSlot(slotId);
        if (!res.success) {
          setActionFeedback({
            type: 'error',
            message: res.error || 'Failed to skip slot.',
          });
          return false;
        }

        setActionFeedback({
          type: 'success',
          message: `Slot marked as SKIPPED by admin override.`,
        });

        setRefreshTrigger((prev) => prev + 1);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to execute skipSlot RPC';
        setActionFeedback({ type: 'error', message: msg });
        return false;
      } finally {
        setActionInProgress(null);
        isExecutingActionRef.current = false;
      }
    },
    [slots]
  );

  /**
   * Performs an atomic full reset of the auction.
   * Resets all slots to pending, deletes all bids, and restores team wallets.
   * Concurrency-guarded: rejects if another action is in progress.
   */
  const handleResetAuction = useCallback(async (): Promise<boolean> => {
    if (isExecutingActionRef.current) {
      setActionFeedback({
        type: 'error',
        message: 'Another auction action is already in progress. Please wait.',
      });
      return false;
    }

    isExecutingActionRef.current = true;
    setActionInProgress({ action: 'reset' });
    setActionFeedback(null);

    try {
      const res = await resetAuction();
      if (!res.success) {
        setActionFeedback({
          type: 'error',
          message: res.error || 'Failed to execute auction reset.',
        });
        return false;
      }

      const info = res.data;
      const count = info?.slots_reset ?? slots.length;
      const balance = info?.starting_balance ?? 100;

      setActionFeedback({
        type: 'success',
        message: `Auction reset successfully! ${count} slots restored to Pending, bids deleted, and wallets restored to ${balance} pts.`,
      });

      setRefreshTrigger((prev) => prev + 1);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to execute resetAuction RPC';
      setActionFeedback({ type: 'error', message: msg });
      return false;
    } finally {
      setActionInProgress(null);
      isExecutingActionRef.current = false;
    }
  }, [slots.length]);

  /**
   * Creates a new auction topic and its associated slot(s) atomically.
   * Concurrency-guarded: rejects if another action is in progress.
   */
  const handleCreateTopic = useCallback(
    async (values: CreateTopicFormValues): Promise<boolean> => {
      if (isExecutingActionRef.current) {
        setActionFeedback({
          type: 'error',
          message: 'Another auction action is already in progress. Please wait.',
        });
        return false;
      }

      if (!values.title || !values.title.trim()) {
        setActionFeedback({ type: 'error', message: 'Topic title is required.' });
        return false;
      }

      isExecutingActionRef.current = true;
      setActionInProgress({ action: 'add_topic' });
      setActionFeedback(null);

      try {
        const res = await createAuctionTopic(values);
        if (!res.success) {
          setActionFeedback({
            type: 'error',
            message: res.error || 'Failed to create auction topic.',
          });
          return false;
        }

        const slotCount = res.data?.slots?.length ?? values.slots_count ?? 1;
        setActionFeedback({
          type: 'success',
          message: `Topic "${values.title.trim()}" created successfully with ${slotCount} pending slot(s)!`,
        });

        setRefreshTrigger((prev) => prev + 1);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create auction topic';
        setActionFeedback({ type: 'error', message: msg });
        return false;
      } finally {
        setActionInProgress(null);
        isExecutingActionRef.current = false;
      }
    },
    []
  );

  const clearFeedback = useCallback(() => {
    setActionFeedback(null);
  }, []);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  return {
    slots,
    filteredSlots,
    activeSlot,
    selectedSlot,
    teamAllocations,
    recentBids,
    overviewStats,
    auditLogs,

    isLoading,
    isInitialLoad,
    error,
    actionInProgress,
    actionFeedback,
    realtimeStatus,

    statusFilter,
    roundFilter,
    searchQuery,
    selectedSlotId,
    setStatusFilter,
    setRoundFilter,
    setSearchQuery,
    setSelectedSlotId,

    handleOpenSlot,
    handleCloseSlot,
    handleSkipSlot,
    handleResetAuction,
    handleCreateTopic,
    clearFeedback,
    refreshAll,
  };
}
