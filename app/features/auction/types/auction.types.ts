/**
 * Auction types shared by the participant arena, the admin console
 * and the projector.
 *
 * These mirror the payload of `get_live_auction_state()` — the
 * authoritative contract implemented in migration 017.
 */

export type AuctionSessionStatus =
  | "draft"
  | "ready"
  | "question_selection"
  | "bidding_open"
  | "bidding_closed"
  | "finalizing"
  | "question_assigned"
  | "solving"
  | "completed"
  | "cancelled";

export type AuctionItemStatus = "pending" | "open" | "sold" | "skipped";

export type AuctionTimerStatus =
  | "idle"
  | "running"
  | "paused"
  | "expired"
  | "completed";

export interface AuctionTopic {
  id: string;
  level: "easy" | "hard";
  title: string;
  description: string | null;
  criterion: unknown;
}

export interface AuctionSessionState {
  id: string;
  status: AuctionSessionStatus;
  round: number;
  is_paused: boolean;
  timer_status: AuctionTimerStatus;
  timer_ends_at: string | null;
  paused_remaining_seconds: number;
  total_bonus_seconds: number;
  total_manual_extension_seconds: number;
  active_slot_id: string | null;
}

export interface AuctionItem {
  id: string;
  status: AuctionItemStatus;
  round: number;
  current_bid: number;
  min_bid: number;
  min_next_bid: number;
  leader_team_id: string | null;
  leader_team_name: string | null;
  winner_team_id: string | null;
  winner_team_name: string | null;
  end_time: string | null;
  timer_status: AuctionTimerStatus;
  paused_remaining_seconds: number;
  question_number: number | null;
  topic: AuctionTopic | null;
}

export interface AuctionTeamState {
  id: string;
  name: string;
  balance: number;
  eliminated: boolean;
  current_bid: number;
  /** DB character_index (1..10) — the same value the /profile page shows. */
  character_index?: number | null;
}

export interface AuctionBid {
  id: string;
  slot_id: string;
  team_id: string;
  team_name: string;
  amount: number;
  server_time: string;
}

export interface AuctionEvent {
  id: string;
  event_type: string;
  slot_id: string | null;
  team_id: string | null;
  payload: Record<string, unknown>;
  timer_ends_at: string | null;
  timer_status: AuctionTimerStatus | null;
  server_timestamp: string;
}

export interface AuctionElimination {
  team_id: string;
  team_name: string;
  rule: string;
  reason: string;
  eliminated_at: string;
}

export interface AuctionSettings {
  min_bid: number;
  min_raise: number;
  opening_window_seconds: number;
  timer_extension_seconds: number;
  bonus_time_seconds: number;
  solving_timer_seconds: number;
  starting_wallet_balance: number;
  bonus_points_rate: { points: number; per_unspent: number };
}

export interface LiveAuctionState {
  server_time: string | null;
  /** Total number of auction items in the contest (20). */
  total_items?: number;
  /** Number of items already sold. */
  items_sold?: number;
  /** Number of items currently open for bidding. */
  items_open?: number;
  session: AuctionSessionState | null;
  active_slot: AuctionItem | null;
  bids: AuctionBid[];
  teams: AuctionTeamState[];
  settings: AuctionSettings;
  events: AuctionEvent[];
  eliminations: AuctionElimination[];
}

/** A participant's own auction state (balance, wins, bids). */
export interface TeamAuctionState {
  team_id: string;
  balance: number;
  spent: number;
  eliminated: boolean;
  elimination: { rule: string; reason: string; eliminated_at: string } | null;
  won_slots: Array<{
    slot_id: string;
    round: number;
    topic_title: string;
    winning_bid: number;
    sold_at: string | null;
  }>;
  bids: Array<{
    id: string;
    slot_id: string;
    amount: number;
    server_time: string;
    topic_title: string;
    slot_status: AuctionItemStatus;
    is_winning_bid: boolean;
  }>;
  server_time: string | null;
}

export type AuctionConnectionStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "offline";

export const EMPTY_SETTINGS: AuctionSettings = {
  min_bid: 10,
  min_raise: 10,
  opening_window_seconds: 10,
  timer_extension_seconds: 5,
  bonus_time_seconds: 60,
  solving_timer_seconds: 4500,
  starting_wallet_balance: 100,
  bonus_points_rate: { points: 1, per_unspent: 3 },
};
