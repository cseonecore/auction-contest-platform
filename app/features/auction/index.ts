/**
 * Bid2Build — Auction module public surface.
 *
 * One module, one timer, one source of truth. Everything the
 * participant arena, the admin console and the projector share lives
 * here.
 */

// ── Participant arena ────────────────────────────────────────────
export * from "./components/ParticipantAuctionRoom";
export * from "./components/ParticipantAuctionHeader";
export * from "./components/ParticipantBiddingPanel";
export * from "./components/BidConfirmationModal";
export * from "./components/ContestRulesModal";
export * from "./components/AuctionSoldModal";
export * from "./components/LiveLeaderboardGrid";
export * from "./components/LeaderboardCapsule";

// ── Admin arena ──────────────────────────────────────────────────
export * from "./components/AdminAuctionRoom";

// ── Hooks ────────────────────────────────────────────────────────
export * from "./hooks/useAuction";
export * from "./hooks/useAuctionRealtime";
export * from "./hooks/useAuctionTimer";

// ── Services ─────────────────────────────────────────────────────
export * from "./services/auction.service";

// ── Types ────────────────────────────────────────────────────────
export * from "./types/auction.types";

// ── Utils ────────────────────────────────────────────────────────
export * from "./utils/mascot";
export * from "./utils/countdown";
