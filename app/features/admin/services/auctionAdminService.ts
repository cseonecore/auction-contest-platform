/**
 * Admin Auction Service Layer
 * Bid2Build (Auction Contest Platform)
 *
 * Implements pure data-fetching and RPC-calling functions for Admin
 * auction management, monitoring, team allocations, and lifecycle control.
 *
 * Uses authenticated Supabase client respecting Admin RLS.
 */

import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  AdminSlotWithDetails,
  AdminBidWithTeam,
  AdminTeamAuctionAllocation,
  AdminWonSlotSummary,
  AuctionOverviewStats,
  AdminAuctionAuditEvent,
  ServiceResult,
  FetchBidsOptions,
  FetchAuditLogOptions,
  OpenSlotResult,
  CloseSlotResult,
  SkipSlotResult,
  TopicRow,
  SlotRow,
  BidRow,
  WalletRow,
  AuctionRealtimeHandlers,
  RealtimeSubscriptionStatus,
} from '../types/auctionAdmin';

// ─────────────────────────────────────────────────────────────
// Raw query result interfaces for type-safe PostgREST joins
// ─────────────────────────────────────────────────────────────

interface RawSlotQueryResult {
  id: string;
  topic_id: string;
  round: 1 | 2;
  status: 'pending' | 'open' | 'sold' | 'skipped';
  current_bid: number;
  leader_team_id: string | null;
  end_time: string | null;
  winner_team_id: string | null;
  topic: TopicRow | null;
  leader_team: { id: string; name: string } | null;
  winner_team: { id: string; name: string } | null;
  bids: { count: number }[] | null;
}

interface RawBidQueryResult {
  id: string;
  slot_id: string;
  team_id: string;
  amount: number;
  server_time: string;
  team: { id: string; name: string } | null;
  slot: {
    id: string;
    round: 1 | 2;
    topic: {
      id: string;
      title: string;
      level: 'easy' | 'hard';
    } | null;
  } | null;
}

interface RawTeamAllocationQueryResult {
  id: string;
  name: string;
  wallets: { balance: number } | { balance: number }[] | null;
  won_slots: Array<{
    id: string;
    round: 1 | 2;
    current_bid: number;
    topic: {
      id: string;
      title: string;
      level: 'easy' | 'hard';
    } | null;
  }> | null;
}

interface RawAuditLogQueryResult {
  id: string;
  actor_id: string | null;
  actor_team_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Pure calculation helpers
// ─────────────────────────────────────────────────────────────

/**
 * Calculates projected bonus points for unspent balance per Rule Book §9.8:
 * "1 bonus evaluation point per 3 unspent auction points, rounded down."
 */
export function calculateBonusPoints(unspentBalance: number): number {
  if (typeof unspentBalance !== 'number' || isNaN(unspentBalance)) return 0;
  return Math.floor(Math.max(0, unspentBalance) / 3);
}

// ─────────────────────────────────────────────────────────────
// Data-fetching service functions
// ─────────────────────────────────────────────────────────────

/**
 * Fetches all auction slots joined with topic, leader team, winner team,
 * and total bid count. Ordered naturally by round and slot ID.
 */
export async function fetchAllSlotsWithDetails(): Promise<ServiceResult<AdminSlotWithDetails[]>> {
  try {
    const { data, error } = await supabase
      .from('slots')
      .select(`
        id,
        topic_id,
        round,
        status,
        current_bid,
        leader_team_id,
        end_time,
        winner_team_id,
        topic:topics (*),
        leader_team:teams!slots_leader_team_id_fkey (id, name),
        winner_team:teams!slots_winner_team_id_fkey (id, name),
        bids (count)
      `)
      .order('round', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to fetch auction slots from Supabase',
      };
    }

    if (!data) {
      return { success: true, data: [] };
    }

    const rawSlots = data as unknown as RawSlotQueryResult[];
    const mappedSlots: AdminSlotWithDetails[] = rawSlots.map((raw) => {
      const bidCount =
        Array.isArray(raw.bids) && raw.bids.length > 0 ? (raw.bids[0]?.count ?? 0) : 0;

      return {
        id: raw.id,
        topic_id: raw.topic_id,
        round: raw.round,
        status: raw.status,
        current_bid: raw.current_bid,
        leader_team_id: raw.leader_team_id,
        end_time: raw.end_time,
        winner_team_id: raw.winner_team_id,
        topic: raw.topic ?? {
          id: raw.topic_id,
          level: raw.round === 1 ? 'easy' : 'hard',
          title: 'Unknown Topic',
          description: null,
          criterion: null,
        },
        leader_team: raw.leader_team,
        winner_team: raw.winner_team,
        bid_count: bidCount,
      };
    });

    return { success: true, data: mappedSlots };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error fetching auction slots';
    return { success: false, error: message };
  }
}

/**
 * Fetches a single auction slot with all details and joined relationships.
 */
export async function fetchSlotById(
  slotId: string
): Promise<ServiceResult<AdminSlotWithDetails>> {
  try {
    if (!slotId || typeof slotId !== 'string') {
      return { success: false, error: 'Valid slot ID is required' };
    }

    const { data, error } = await supabase
      .from('slots')
      .select(`
        id,
        topic_id,
        round,
        status,
        current_bid,
        leader_team_id,
        end_time,
        winner_team_id,
        topic:topics (*),
        leader_team:teams!slots_leader_team_id_fkey (id, name),
        winner_team:teams!slots_winner_team_id_fkey (id, name),
        bids (count)
      `)
      .eq('id', slotId)
      .single();

    if (error) {
      return {
        success: false,
        error: error.message || `Failed to fetch auction slot ${slotId}`,
      };
    }

    if (!data) {
      return { success: false, error: 'Auction slot not found' };
    }

    const raw = data as unknown as RawSlotQueryResult;
    const bidCount =
      Array.isArray(raw.bids) && raw.bids.length > 0 ? (raw.bids[0]?.count ?? 0) : 0;

    const slot: AdminSlotWithDetails = {
      id: raw.id,
      topic_id: raw.topic_id,
      round: raw.round,
      status: raw.status,
      current_bid: raw.current_bid,
      leader_team_id: raw.leader_team_id,
      end_time: raw.end_time,
      winner_team_id: raw.winner_team_id,
      topic: raw.topic ?? {
        id: raw.topic_id,
        level: raw.round === 1 ? 'easy' : 'hard',
        title: 'Unknown Topic',
        description: null,
        criterion: null,
      },
      leader_team: raw.leader_team,
      winner_team: raw.winner_team,
      bid_count: bidCount,
    };

    return { success: true, data: slot };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error fetching auction slot';
    return { success: false, error: message };
  }
}

/**
 * Fetches recent bids with team name, slot round, and topic details.
 * Supports filtering by slotId or teamId, and custom limit (default 50).
 */
export async function fetchRecentBids(
  options?: FetchBidsOptions
): Promise<ServiceResult<AdminBidWithTeam[]>> {
  try {
    let query = supabase
      .from('bids')
      .select(`
        id,
        slot_id,
        team_id,
        amount,
        server_time,
        team:teams (
          id,
          name
        ),
        slot:slots (
          id,
          round,
          topic:topics (
            id,
            title,
            level
          )
        )
      `)
      .order('server_time', { ascending: false });

    if (options?.slotId) {
      query = query.eq('slot_id', options.slotId);
    }

    if (options?.teamId) {
      query = query.eq('team_id', options.teamId);
    }

    const limit = options?.limit ?? 50;
    query = query.limit(limit);

    const { data, error } = await query;

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to fetch bids from Supabase',
      };
    }

    if (!data) {
      return { success: true, data: [] };
    }

    const rawBids = data as unknown as RawBidQueryResult[];
    const mappedBids: AdminBidWithTeam[] = rawBids.map((b) => ({
      id: b.id,
      slot_id: b.slot_id,
      team_id: b.team_id,
      amount: b.amount,
      server_time: b.server_time,
      team: b.team ?? { id: b.team_id, name: 'Unknown Team' },
      slot: b.slot
        ? {
            id: b.slot.id,
            round: b.slot.round,
            topic: b.slot.topic ?? null,
          }
        : null,
    }));

    return { success: true, data: mappedBids };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error fetching bids';
    return { success: false, error: message };
  }
}

/**
 * Fetches all teams with their wallet balance, won slots (Round 1 & Round 2),
 * total points spent, and Rule Book §9.8 projected bonus points.
 */
export async function fetchTeamWalletAllocations(): Promise<
  ServiceResult<AdminTeamAuctionAllocation[]>
> {
  try {
    const { data, error } = await supabase
      .from('teams')
      .select(`
        id,
        name,
        wallets (
          balance
        ),
        won_slots:slots!slots_winner_team_id_fkey (
          id,
          round,
          current_bid,
          topic:topics (
            id,
            title,
            level
          )
        )
      `)
      .order('name', { ascending: true });

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to fetch team allocations from Supabase',
      };
    }

    if (!data) {
      return { success: true, data: [] };
    }

    const rawTeams = data as unknown as RawTeamAllocationQueryResult[];
    const allocations: AdminTeamAuctionAllocation[] = rawTeams.map((team) => {
      let balance = 100;
      if (team.wallets) {
        if (Array.isArray(team.wallets)) {
          balance = team.wallets[0]?.balance ?? 100;
        } else if (typeof team.wallets.balance === 'number') {
          balance = team.wallets.balance;
        }
      }

      const wonList = Array.isArray(team.won_slots) ? team.won_slots : [];
      const r1Won = wonList.find((s) => s.round === 1);
      const r2Won = wonList.find((s) => s.round === 2);

      const round1Slot: AdminWonSlotSummary | null = r1Won
        ? {
            slot_id: r1Won.id,
            round: 1,
            winning_bid: r1Won.current_bid,
            topic_id: r1Won.topic?.id ?? '',
            topic_title: r1Won.topic?.title ?? 'Round 1 Topic',
            topic_level: r1Won.topic?.level ?? 'easy',
          }
        : null;

      const round2Slot: AdminWonSlotSummary | null = r2Won
        ? {
            slot_id: r2Won.id,
            round: 2,
            winning_bid: r2Won.current_bid,
            topic_id: r2Won.topic?.id ?? '',
            topic_title: r2Won.topic?.title ?? 'Round 2 Topic',
            topic_level: r2Won.topic?.level ?? 'hard',
          }
        : null;

      const round1Won = !!round1Slot;
      const round2Won = !!round2Slot;
      const allocationCompleted = round1Won && round2Won;
      const totalSpent =
        (round1Slot?.winning_bid ?? 0) + (round2Slot?.winning_bid ?? 0);
      const projectedBonus = calculateBonusPoints(balance);

      return {
        team_id: team.id,
        team_name: team.name,
        wallet_balance: balance,
        total_spent: totalSpent,
        projected_bonus_points: projectedBonus,
        round1_slot: round1Slot,
        round2_slot: round2Slot,
        round1_won: round1Won,
        round2_won: round2Won,
        allocation_completed: allocationCompleted,
      };
    });

    return { success: true, data: allocations };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error fetching team allocations';
    return { success: false, error: message };
  }
}

/**
 * Fetches audit log events related to auction activities
 * (slot_opened, slot_sold, slot_skipped).
 */
export async function fetchAuctionAuditLogs(
  options?: FetchAuditLogOptions
): Promise<ServiceResult<AdminAuctionAuditEvent[]>> {
  try {
    let query = supabase
      .from('audit_log')
      .select('id, actor_id, actor_team_id, action, entity_type, entity_id, details, created_at')
      .order('created_at', { ascending: false });

    if (options?.action) {
      query = query.eq('action', options.action);
    } else {
      query = query.in('action', ['slot_opened', 'slot_sold', 'slot_skipped']);
    }

    if (options?.slotId) {
      query = query.eq('entity_id', options.slotId);
    }

    const limit = options?.limit ?? 50;
    query = query.limit(limit);

    const { data, error } = await query;

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to fetch auction audit logs',
      };
    }

    if (!data) {
      return { success: true, data: [] };
    }

    const rawLogs = data as unknown as RawAuditLogQueryResult[];
    const auditEvents: AdminAuctionAuditEvent[] = rawLogs.map((log) => ({
      id: log.id,
      actor_id: log.actor_id,
      actor_team_id: log.actor_team_id,
      action: log.action,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      details: (log.details as Record<string, unknown>) ?? null,
      created_at: log.created_at,
    }));

    return { success: true, data: auditEvents };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error fetching audit logs';
    return { success: false, error: message };
  }
}

/**
 * Fetches aggregated statistics for the Admin Auction Dashboard.
 * Computes slot distributions, team allocation progress, points spent, and total bids.
 */
export async function fetchAuctionOverviewStats(): Promise<
  ServiceResult<AuctionOverviewStats>
> {
  try {
    // Run slots query, team allocations query, and bid count in parallel
    const [slotsResult, teamsResult, bidsCountResult] = await Promise.all([
      fetchAllSlotsWithDetails(),
      fetchTeamWalletAllocations(),
      supabase.from('bids').select('id', { count: 'exact', head: true }),
    ]);

    if (!slotsResult.success || !slotsResult.data) {
      return {
        success: false,
        error: slotsResult.error || 'Failed to fetch slots for overview stats',
      };
    }

    if (!teamsResult.success || !teamsResult.data) {
      return {
        success: false,
        error: teamsResult.error || 'Failed to fetch teams for overview stats',
      };
    }

    const slots = slotsResult.data;
    const teams = teamsResult.data;
    const totalBids = bidsCountResult.count ?? 0;

    const round1Slots = slots.filter((s) => s.round === 1);
    const round2Slots = slots.filter((s) => s.round === 2);
    const pendingSlots = slots.filter((s) => s.status === 'pending');
    const openSlots = slots.filter((s) => s.status === 'open');
    const soldSlots = slots.filter((s) => s.status === 'sold');
    const skippedSlots = slots.filter((s) => s.status === 'skipped');
    const activeSlot = openSlots.length > 0 ? openSlots[0] : null;

    const totalPointsSpent = soldSlots.reduce(
      (sum, s) => sum + (s.current_bid || 0),
      0
    );

    const completedTeams = teams.filter((t) => t.allocation_completed).length;
    const partialTeams = teams.filter(
      (t) => t.round1_won !== t.round2_won
    ).length;
    const noAllocTeams = teams.filter(
      (t) => !t.round1_won && !t.round2_won
    ).length;

    const stats: AuctionOverviewStats = {
      total_slots: slots.length,
      round1_slots_total: round1Slots.length,
      round2_slots_total: round2Slots.length,
      pending_slots: pendingSlots.length,
      open_slots: openSlots.length,
      sold_slots: soldSlots.length,
      skipped_slots: skippedSlots.length,
      active_slot: activeSlot,
      total_bids: totalBids,
      total_points_spent: totalPointsSpent,
      teams_total: teams.length,
      teams_with_completed_allocation: completedTeams,
      teams_with_partial_allocation: partialTeams,
      teams_with_no_allocation: noAllocTeams,
    };

    return { success: true, data: stats };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error fetching overview stats';
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────────────────────
// Admin RPC Wrappers
// ─────────────────────────────────────────────────────────────

/**
 * Admin action to open a pending slot with a 10-second opening window.
 * Calls RPC `open_slot(p_slot_id: uuid)`.
 */
export async function openSlot(
  slotId: string
): Promise<ServiceResult<OpenSlotResult>> {
  try {
    if (!slotId || typeof slotId !== 'string') {
      return { success: false, error: 'Valid slot ID is required to open a slot' };
    }

    const { data, error } = await supabase.rpc('open_slot', {
      p_slot_id: slotId,
    });

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to open auction slot',
      };
    }

    return {
      success: true,
      data: data as unknown as OpenSlotResult,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error opening auction slot';
    return { success: false, error: message };
  }
}

/**
 * Admin action to close an active open slot.
 * - If highest bidder exists: sells slot, deducts winning amount from winner wallet,
 *   and records audit event.
 * - If no bids were placed: marks slot as skipped and records audit event.
 * Calls RPC `close_slot(p_slot_id: uuid)`.
 */
export async function closeSlot(
  slotId: string
): Promise<ServiceResult<CloseSlotResult>> {
  try {
    if (!slotId || typeof slotId !== 'string') {
      return { success: false, error: 'Valid slot ID is required to close a slot' };
    }

    const { data, error } = await supabase.rpc('close_slot', {
      p_slot_id: slotId,
    });

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to close auction slot',
      };
    }

    return {
      success: true,
      data: data as unknown as CloseSlotResult,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error closing auction slot';
    return { success: false, error: message };
  }
}

/**
 * Admin override to manually skip a pending or open slot immediately.
 * No wallet deduction is made.
 * Calls RPC `skip_slot(p_slot_id: uuid)`.
 */
export async function skipSlot(
  slotId: string
): Promise<ServiceResult<SkipSlotResult>> {
  try {
    if (!slotId || typeof slotId !== 'string') {
      return { success: false, error: 'Valid slot ID is required to skip a slot' };
    }

    const { data, error } = await supabase.rpc('skip_slot', {
      p_slot_id: slotId,
    });

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to skip auction slot',
      };
    }

    return {
      success: true,
      data: data as unknown as SkipSlotResult,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error skipping auction slot';
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────────────────────
// Realtime Subscription Management
// ─────────────────────────────────────────────────────────────

/**
 * Subscribes to Supabase Realtime changes across `slots`, `bids`, and `wallets`.
 * Notifies caller via handlers and provides subscription status tracking.
 * Returns an unsubscribe cleanup function and the channel instance.
 */
export function subscribeToAuctionRealtime(
  handlers: AuctionRealtimeHandlers
): { unsubscribe: () => void; channel: RealtimeChannel } {
  const channelName = `admin-auction-feed-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase.channel(channelName);

  if (handlers.onSlotChange) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'slots' },
      (payload) => {
        handlers.onSlotChange?.({
          eventType: payload.eventType,
          new: payload.new as SlotRow,
          old: payload.old as Partial<SlotRow>,
        });
      }
    );
  }

  if (handlers.onBidInsert) {
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bids' },
      (payload) => {
        handlers.onBidInsert?.({
          eventType: payload.eventType,
          new: payload.new as BidRow,
        });
      }
    );
  }

  if (handlers.onWalletChange) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wallets' },
      (payload) => {
        handlers.onWalletChange?.({
          eventType: payload.eventType,
          new: payload.new as WalletRow,
          old: payload.old as Partial<WalletRow>,
        });
      }
    );
  }

  channel.subscribe((status, err) => {
    let mappedStatus: RealtimeSubscriptionStatus = 'CONNECTING';
    if (status === 'SUBSCRIBED') mappedStatus = 'SUBSCRIBED';
    else if (status === 'TIMED_OUT') mappedStatus = 'TIMED_OUT';
    else if (status === 'CLOSED') mappedStatus = 'CLOSED';
    else if (status === 'CHANNEL_ERROR') mappedStatus = 'CHANNEL_ERROR';

    handlers.onStatusChange?.(
      mappedStatus,
      err instanceof Error ? err : err ? new Error(String(err)) : undefined
    );
  });

  const unsubscribe = () => {
    try {
      void supabase.removeChannel(channel);
    } catch {
      // Safe no-op on cleanup
    }
  };

  return { unsubscribe, channel };
}

