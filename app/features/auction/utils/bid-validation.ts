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
  /** The team already won an item in this round. */
  hasWonRound: boolean;
  /** Only the captain may bid. */
  isCaptain: boolean;
  /** Status of the auction item. */
  slotStatus: string;
  /** The team has been eliminated. */
  eliminated?: boolean;
  /** The auction is paused. */
  paused?: boolean;
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

  if (!input.isCaptain) return fail("Only the team captain can place bids.");
  if (input.eliminated) return fail("Your team has been eliminated from the auction.");
  if (input.paused) return fail("Bidding is currently paused.");
  if (input.slotStatus !== "open") return fail("The auction item is not open for bidding.");
  if (input.hasWonRound) return fail("Your team already won an item in this round.");
  if (input.isLeader) return fail("Your team is already the highest bidder.");
  if (input.walletBalance < minNextBid) {
    return fail(`Insufficient balance — ${minNextBid} points are required.`);
  }

  return { canBid: true, minNextBid };
}
