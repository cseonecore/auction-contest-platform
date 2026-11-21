/**
 * Bid rules mirrored by the participant interface.
 *
 * These are a UX pre-filter only — PostgreSQL enforces the same rules
 * inside `place_bid()`. They must never disagree with the database:
 * the client may be more forgiving (the server has the last word) but
 * it may never be stricter in a way that blocks a legal bid.
 */

export interface BidValidationInput {
  /** Highest bid currently on the item. */
  currentBid: number;
  /** Minimum opening bid (from the settings table). */
  minBid: number;
  /** Minimum raise above the current bid (from the settings table). */
  minRaise: number;
  /** Points the team can still spend. */
  walletBalance: number;
  /** The team is already leading this item. */
  isLeader: boolean;
  /** The team already won an item in this round (kept for advisory context; multiple wins are allowed). */
  hasWonRound?: boolean;
  /** Total number of questions successfully won by the team across the contest (max 2). */
  wonCount?: number;
  /** Active auction round (1, 2, or 3). */
  currentRound?: number;
  /** Status of the auction item. */
  slotStatus: string;
  /** The team has been eliminated. */
  eliminated?: boolean;
  /** The auction is paused. */
  paused?: boolean;
  /**
   * The client-side countdown has reached zero for this item.
   * Advisory ONLY: it never blocks an open item, because the browser
   * clock can be a hair behind the server clock and the backend
   * (`place_bid`) owns the decision. It only sharpens the disabled
   * reason once the item is already not open.
   */
  timerExpired?: boolean;
  /**
   * No active auction session exists. Advisory only: an admin may
   * open bidding without a session and `place_bid()` still accepts
   * those bids, so the client must not block them. It only sharpens
   * the disabled reason when the item is already not open.
   */
  sessionActive?: boolean;
}

export interface BidValidationResult {
  canBid: boolean;
  reason?: string;
  /** The lowest amount the team may bid right now. */
  minNextBid: number;
}

export function validateBid(input: BidValidationInput): BidValidationResult {
  const minNextBid =
    input.currentBid === 0 ? input.minBid : input.currentBid + input.minRaise;

  const fail = (reason: string): BidValidationResult => ({
    canBid: false,
    reason,
    minNextBid,
  });

  if (input.eliminated) return fail("Your team has been eliminated from the auction.");
  if (input.currentRound === 3 && (input.wonCount ?? 0) >= 2) {
    return fail("Your team already has 2 problem statements and cannot participate in Round 3.");
  }
  if (input.wonCount !== undefined && input.wonCount >= 2) {
    return fail("Your team has already acquired the maximum limit of 2 problem statements.");
  }
  if (input.paused) return fail("Bidding is currently paused.");
  if (input.slotStatus !== "open") {
    if (input.timerExpired) {
      return fail("The bidding window for this item has closed.");
    }
    if (input.sessionActive === false) {
      return fail("The auction is not live right now.");
    }
    return fail("The auction item is not open for bidding.");
  }
  // Multiple wins per round are supported — teams are allowed to win multiple problems.
  if (input.isLeader) return fail("Your team is already the highest bidder.");
  if (input.walletBalance < minNextBid) {
    return fail(`Insufficient balance — ${minNextBid} points are required.`);
  }

  return { canBid: true, minNextBid };
}
