/**
 * Types for Admin Auction Management Module
 * Bid2Build (Auction Contest Platform)
 *
 * Augments existing database row and auction types for Admin-side
 * monitoring, allocation tracking, and lifecycle controls.
 */

import type {
  SlotRow,
  TopicRow,
  BidRow,
  WalletRow,
  TeamRow,
  AuditLogRow,
} from '@/types/database';
import type {
  OpenSlotResult,
  CloseSlotResult,
  SkipSlotResult,
  ResetAuctionResult,
  CreateAuctionTopicResult,
  SlotStatus,
  AuctionRound,
} from '@/types/auction';

// ─────────────────────────────────────────────────────────────
// Re-export core schema types for convenient imports
// ─────────────────────────────────────────────────────────────
export type {
  SlotRow,
  TopicRow,
  BidRow,
  WalletRow,
  TeamRow,
  AuditLogRow,
  OpenSlotResult,
  CloseSlotResult,
  SkipSlotResult,
  ResetAuctionResult,
  CreateAuctionTopicResult,
  SlotStatus,
  AuctionRound,
};

// ─────────────────────────────────────────────────────────────
// Enriched Slot Types
// ─────────────────────────────────────────────────────────────

/**
 * Slot fully enriched for Admin view with topic, leader team, winner team,
 * and total bid count.
 */
export interface AdminSlotWithDetails extends SlotRow {
  topic: TopicRow;
  leader_team: Pick<TeamRow, 'id' | 'name'> | null;
  winner_team: Pick<TeamRow, 'id' | 'name'> | null;
  bid_count: number;
}

// ─────────────────────────────────────────────────────────────
// Enriched Bid Types
// ─────────────────────────────────────────────────────────────

/**
 * Bid enriched with team and slot details for Admin bid log and live monitoring.
 */
export interface AdminBidWithTeam extends BidRow {
  team: Pick<TeamRow, 'id' | 'name'>;
  slot?: {
    id: string;
    round: 1 | 2;
    topic?: Pick<TopicRow, 'id' | 'title' | 'level'> | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────
// Team Auction Allocation Types
// ─────────────────────────────────────────────────────────────

/**
 * Summary of a slot won by a team in a specific round.
 */
export interface AdminWonSlotSummary {
  slot_id: string;
  round: 1 | 2;
  winning_bid: number;
  topic_id: string;
  topic_title: string;
  topic_level: 'easy' | 'hard';
}

/**
 * Team allocation tracking round-wise wins, wallet balance,
 * total spent, and Rule Book §9.8 bonus points calculation.
 */
export interface AdminTeamAuctionAllocation {
  team_id: string;
  team_name: string;
  wallet_balance: number;
  total_spent: number;
  projected_bonus_points: number; // Math.floor(wallet_balance / 3) per Rule Book §9.8
  round1_slot: AdminWonSlotSummary | null;
  round2_slot: AdminWonSlotSummary | null;
  round1_won: boolean;
  round2_won: boolean;
  allocation_completed: boolean; // Both Round 1 and Round 2 won
}

// ─────────────────────────────────────────────────────────────
// Auction Overview Statistics
// ─────────────────────────────────────────────────────────────

/**
 * Real-time summary statistics for the Admin Auction Dashboard.
 */
export interface AuctionOverviewStats {
  total_slots: number;
  round1_slots_total: number;
  round2_slots_total: number;
  pending_slots: number;
  open_slots: number;
  sold_slots: number;
  skipped_slots: number;
  active_slot: AdminSlotWithDetails | null;
  total_bids: number;
  total_points_spent: number;
  teams_total: number;
  teams_with_completed_allocation: number;
  teams_with_partial_allocation: number;
  teams_with_no_allocation: number;
}

// ─────────────────────────────────────────────────────────────
// Audit Log Types
// ─────────────────────────────────────────────────────────────

/**
 * Audit log entry for auction actions (slot_opened, slot_sold, slot_skipped).
 */
export interface AdminAuctionAuditEvent {
  id: string;
  actor_id: string | null;
  actor_team_id: string | null;
  action: 'slot_opened' | 'slot_sold' | 'slot_skipped' | string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Service & Query Options Types
// ─────────────────────────────────────────────────────────────

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type SlotStatusFilter = 'all' | SlotStatus;
export type SlotRoundFilter = 'all' | 1 | 2;

export interface FetchBidsOptions {
  limit?: number;
  slotId?: string;
  teamId?: string;
}

export interface FetchAuditLogOptions {
  limit?: number;
  action?: string;
  slotId?: string;
}

// ─────────────────────────────────────────────────────────────
// Realtime Subscription & Hook State Types
// ─────────────────────────────────────────────────────────────

export type RealtimeSubscriptionStatus =
  | 'CONNECTING'
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR';

export interface AuctionRealtimeHandlers {
  onSlotChange?: (payload: { eventType: string; new: SlotRow; old: Partial<SlotRow> }) => void;
  onBidInsert?: (payload: { eventType: string; new: BidRow }) => void;
  onWalletChange?: (payload: { eventType: string; new: WalletRow; old: Partial<WalletRow> }) => void;
  onStatusChange?: (status: RealtimeSubscriptionStatus, error?: Error) => void;
}

export interface AuctionActionFeedback {
  type: 'success' | 'error';
  message: string;
}

export interface ActionInProgressState {
  slotId?: string;
  action: 'open' | 'close' | 'skip' | 'reset' | 'add_topic';
}

export interface CreateTopicFormValues {
  title: string;
  description: string;
  level: 'easy' | 'hard';
  starting_bid: number;
  criterion?: string;
  slots_count?: number;
}

// ─────────────────────────────────────────────────────────────
// UI Tabs, Filters, and Navigation Types
// ─────────────────────────────────────────────────────────────

export type AuctionTabKey =
  | 'overview'
  | 'queue'
  | 'controller'
  | 'feed'
  | 'allocations';

export type SlotSortField = 'id' | 'round' | 'status' | 'bid';
export type SortDirection = 'asc' | 'desc';

export type AllocationFilter = 'all' | 'completed' | 'partial' | 'none';
export type AllocationSortField = 'name' | 'balance' | 'spent' | 'status';

export type AdminNavSection =
  | 'dashboard'
  | 'registration'
  | 'overview'
  | 'queue'
  | 'controller'
  | 'feed'
  | 'allocations'
  | 'settings';

export interface UseAdminAuctionOptions {
  autoSubscribeRealtime?: boolean;
  pollIntervalMs?: number | null;
}

export interface UseAdminAuctionReturn {
  // Data
  slots: AdminSlotWithDetails[];
  filteredSlots: AdminSlotWithDetails[];
  activeSlot: AdminSlotWithDetails | null;
  selectedSlot: AdminSlotWithDetails | null;
  teamAllocations: AdminTeamAuctionAllocation[];
  recentBids: AdminBidWithTeam[];
  overviewStats: AuctionOverviewStats | null;
  auditLogs: AdminAuctionAuditEvent[];

  // Status & Loading
  isLoading: boolean;
  isInitialLoad: boolean;
  error: string | null;
  actionInProgress: ActionInProgressState | null;
  actionFeedback: AuctionActionFeedback | null;
  realtimeStatus: RealtimeSubscriptionStatus;

  // Filter & Search Controls
  statusFilter: SlotStatusFilter;
  roundFilter: SlotRoundFilter;
  searchQuery: string;
  selectedSlotId: string | null;
  setStatusFilter: (filter: SlotStatusFilter) => void;
  setRoundFilter: (filter: SlotRoundFilter) => void;
  setSearchQuery: (query: string) => void;
  setSelectedSlotId: (slotId: string | null) => void;

  // Actions with Concurrency Guards
  handleOpenSlot: (slotId: string, startingBid?: number) => Promise<boolean>;
  handleCloseSlot: (slotId: string) => Promise<boolean>;
  handleSkipSlot: (slotId: string) => Promise<boolean>;
  handleResetAuction: () => Promise<boolean>;
  handleCreateTopic: (values: CreateTopicFormValues) => Promise<boolean>;
  clearFeedback: () => void;
  refreshAll: () => Promise<void>;
}

