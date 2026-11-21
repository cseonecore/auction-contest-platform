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
    minRaise: 5,
    walletBalance: 100,
    isLeader: false,
    hasWonRound: false,
    slotStatus: "open",
  };

  it("allows the minimum opening bid", () => {
    const result = validateBid(base);
    expect(result.canBid).toBe(true);
    expect(result.minNextBid).toBe(10);
  });

  it("requires the minimum raise above the current bid", () => {
    const result = validateBid({ ...base, currentBid: 30 });
    expect(result.minNextBid).toBe(35);
    expect(result.canBid).toBe(true);
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

  it("allows a team that already won in the round to bid (multiple wins permitted)", () => {
    const result = validateBid({ ...base, hasWonRound: true });
    expect(result.canBid).toBe(true);
  });

  it("blocks a team that cannot afford the next bid", () => {
    const result = validateBid({ ...base, currentBid: 90, walletBalance: 94 });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/insufficient/i);
  });

  it("blocks bidding on an item that is not open", () => {
    const result = validateBid({ ...base, slotStatus: "sold" });
    expect(result.canBid).toBe(false);
  });

  // ── Advisory context (Bug 3): these inputs only sharpen the disabled
  // ── reason — they must never block a bid the backend would accept.

  it("reports a closed bidding window once the countdown has expired", () => {
    const result = validateBid({ ...base, slotStatus: "sold", timerExpired: true });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/window .*closed/i);
  });

  it("reports an inactive session while the auction is not live", () => {
    const result = validateBid({ ...base, slotStatus: "pending", sessionActive: false });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/not live/i);
  });

  it("never blocks an open item just because the session is inactive", () => {
    // The admin may open bidding without a session; place_bid() still
    // accepts those bids, so the interface must accept them too.
    const result = validateBid({ ...base, sessionActive: false });
    expect(result.canBid).toBe(true);
  });

  it("never blocks an open item just because the countdown has expired", () => {
    // The server clock owns the deadline; a client that thinks the
    // window expired must still let the backend decide.
    const result = validateBid({ ...base, timerExpired: true });
    expect(result.canBid).toBe(true);
  });

  // ── 3-Round rules & question limits ─────────────────────────────────

  it("blocks a team that has already acquired 2 questions across the contest", () => {
    const result = validateBid({ ...base, wonCount: 2 });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/maximum limit of 2 problem statements/i);
  });

  it("allows a team with 1 question to bid in Round 2", () => {
    const result = validateBid({ ...base, wonCount: 1, currentRound: 2 });
    expect(result.canBid).toBe(true);
  });

  it("blocks a team with 2 questions from participating in Round 3 recovery auction", () => {
    const result = validateBid({ ...base, wonCount: 2, currentRound: 3 });
    expect(result.canBid).toBe(false);
    expect(result.reason).toMatch(/cannot participate in Round 3/i);
  });

  it("allows a team with fewer than 2 questions (0 or 1) to bid in Round 3", () => {
    const r0 = validateBid({ ...base, wonCount: 0, currentRound: 3 });
    expect(r0.canBid).toBe(true);

    const r1 = validateBid({ ...base, wonCount: 1, currentRound: 3 });
    expect(r1.canBid).toBe(true);
  });
});
