import { describe, expect, it } from "vitest";
import { validateBid, type BidValidationInput } from "@/features/auction/utils/bid-validation";

/**
 * The bid rules the participant interface mirrors. These are only a
 * UX pre-filter — the database enforces the same rules inside
 * `place_bid()` — but they must never disagree with it.
 */

describe("validateBid", () => {
  const base: BidValidationInput = {
    currentBid: 0,
    minBid: 10,
    minRaise: 10,
    walletBalance: 100,
    isLeader: false,
    hasWonRound: false,
    isCaptain: true,
    slotStatus: "open",
  };

  it("allows the minimum opening bid", () => {
    const result = validateBid(base);
    expect(result.canBid).toBe(true);
    expect(result.minNextBid).toBe(10);
  });

  it("requires the minimum raise above the current bid", () => {
    const result = validateBid({ ...base, currentBid: 30 });
    expect(result.minNextBid).toBe(40);
    expect(result.canBid).toBe(true);
  });

  it("blocks a non-captain", () => {
    const result = validateBid({ ...base, isCaptain: false });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/captain/i);
  });

  it("blocks an eliminated team", () => {
    const result = validateBid({ ...base, eliminated: true });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/eliminated/i);
  });

  it("blocks bidding while the auction is paused", () => {
    const result = validateBid({ ...base, paused: true });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/paused/i);
  });

  it("blocks the leading team", () => {
    const result = validateBid({ ...base, currentBid: 30, isLeader: true });
    expect(result.canBid).toBe(false);
  });

  it("blocks a team that already won in the round", () => {
    const result = validateBid({ ...base, hasWonRound: true });
    expect(result.canBid).toBe(false);
  });

  it("blocks a team that cannot afford the next bid", () => {
    const result = validateBid({ ...base, currentBid: 90, walletBalance: 95 });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/insufficient/i);
  });

  it("blocks bidding on an item that is not open", () => {
    const result = validateBid({ ...base, slotStatus: "sold" });
    expect(result.canBid).toBe(false);
  });
});
