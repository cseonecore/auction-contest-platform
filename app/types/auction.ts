/**
 * Auction-specific TypeScript types.
 *
 * These augment the raw database row types with joined/derived shapes
 * used by the auction UI and hooks.
 */

import type { SlotRow, TopicRow, BidRow, WalletRow, TeamRow } from './database'

// ─────────────────────────────────────────────────────────────
// Joined / enriched query types
// ─────────────────────────────────────────────────────────────

/** Slot joined with its topic (used in the slot queue). */
export type SlotWithTopic = SlotRow & {
  topic: TopicRow
}

/** Slot fully enriched with topic, leader team, and winner team. */
export type SlotWithDetails = SlotRow & {
  topic: TopicRow
  leader_team: Pick<TeamRow, 'id' | 'name'> | null
  winner_team: Pick<TeamRow, 'id' | 'name'> | null
}

/** Bid enriched with the team's name. */
export type BidWithTeam = BidRow & {
  team: Pick<TeamRow, 'id' | 'name'>
}

// ─────────────────────────────────────────────────────────────
// RPC return types
// ─────────────────────────────────────────────────────────────

/**
 * Returned by place_bid().
 * wallet_balance is UNCHANGED — deduction only happens on win (close_slot).
 */
export interface PlaceBidResult {
  success: boolean
  slot_id: string
  team_id: string
  amount: number
  /** Current wallet balance (NOT deducted; losing bids are free). */
  wallet_balance: number
}

/** Returned by open_slot(). */
export interface OpenSlotResult {
  success: boolean
  slot_id: string
  status: 'open'
  end_time: string
}

/** Returned by close_slot(). */
export interface CloseSlotResult {
  success: boolean
  slot_id: string
  status: 'sold' | 'skipped'
  winner_team_id?: string
  winning_bid?: number
}

/** Returned by skip_slot(). */
export interface SkipSlotResult {
  success: boolean
  slot_id: string
  status: 'skipped'
}

// ─────────────────────────────────────────────────────────────
// Enum-like types
// ─────────────────────────────────────────────────────────────

export type SlotStatus  = SlotRow['status']   // 'pending' | 'open' | 'sold' | 'skipped'
export type AuctionRound = 1 | 2              // 1 = Easy (Round 1), 2 = Hard (Round 2)

// ─────────────────────────────────────────────────────────────
// UI / logic types
// ─────────────────────────────────────────────────────────────

/** Whether the current captain is eligible to bid and why if not. */
export interface BidEligibility {
  canBid: boolean
  reason?: string
}

/** Countdown timer state derived from slots.end_time. */
export interface CountdownState {
  secondsLeft: number
  isExpired: boolean
  /** < 5 seconds remaining */
  isUrgent: boolean
  /** < 3 seconds remaining */
  isCritical: boolean
}

/**
 * Top-level auction session state surfaced by useAuctionSession().
 * This is the single source of truth for the auction page.
 */
export interface AuctionSession {
  // ── Auth & team ──────────────────────────────────────────
  userId: string | null
  teamId: string | null
  isCaptain: boolean
  team: Pick<TeamRow, 'id' | 'name'> | null

  // ── Wallet ───────────────────────────────────────────────
  wallet: WalletRow | null
  walletLoading: boolean

  // ── Slot queue ───────────────────────────────────────────
  /** All slots across both rounds (for the queue panel). */
  allSlots: SlotWithTopic[]
  /** ID of the currently open slot, if any. */
  activeSlotId: string | null
  slotsLoading: boolean

  // ── Won rounds ───────────────────────────────────────────
  /**
   * Set of round numbers where this team has already won a slot.
   * Once a round is in this set the team is locked from further
   * bidding in that round (Rule Book §5.3).
   */
  wonRounds: Set<AuctionRound>

  // ── Meta ─────────────────────────────────────────────────
  loading: boolean
  error: string | null
}

/**
 * Auction settings read from the `settings` table.
 * Defaults reflect the Rule Book values.
 */
export interface AuctionSettings {
  /** Minimum opening bid. Default: 10. */
  min_bid: number
  /** Minimum raise above current bid. Default: 10. */
  min_raise: number
  /** Opening window in seconds before slot is auto-skipped. Default: 10. */
  opening_window_seconds: number
  /** Timer extension per new bid. Default: 3. */
  timer_extension_seconds: number
  /** Starting wallet balance per team. Default: 100. */
  starting_balance: number
  /**
   * Bonus evaluation points per N unspent auction points.
   * Rule Book §9.8: 1 bonus per 3 unspent, rounded down.
   * Denominator = 3 by default.
   */
  bonus_points_per: number
}

export const DEFAULT_AUCTION_SETTINGS: AuctionSettings = {
  min_bid: 10,
  min_raise: 10,
  opening_window_seconds: 10,
  timer_extension_seconds: 3,
  starting_balance: 100,
  bonus_points_per: 3,
}

