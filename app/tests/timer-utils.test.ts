import { describe, expect, it } from "vitest";
import { calculateRemaining } from "@/features/auction/hooks/useAuctionTimer";

/**
 * The countdown must be anchored to the server deadline. A participant
 * with a wrong device clock must still see the correct remaining time,
 * which is what `serverOffsetMs` compensates for.
 */
describe("calculateRemaining", () => {
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

  it("reports the seconds left until the deadline", () => {
    const result = calculateRemaining(iso(30_000));
    expect(result.isExpired).toBe(false);
    expect(result.secondsLeft).toBeGreaterThanOrEqual(28);
    expect(result.secondsLeft).toBeLessThanOrEqual(31);
  });

  it("reports an expired deadline", () => {
    const result = calculateRemaining(iso(-5_000));
    expect(result.isExpired).toBe(true);
    expect(result.secondsLeft).toBe(0);
  });

  it("treats a missing deadline as expired", () => {
    const result = calculateRemaining(null);
    expect(result.isExpired).toBe(true);
    expect(result.secondsLeft).toBe(0);
  });

  it("flags the urgent and critical windows", () => {
    expect(calculateRemaining(iso(4_000)).isUrgent).toBe(true);
    expect(calculateRemaining(iso(4_000)).isCritical).toBe(false);
    expect(calculateRemaining(iso(2_000)).isCritical).toBe(true);
    expect(calculateRemaining(iso(30_000)).isUrgent).toBe(false);
  });

  it("compensates for a wrong device clock", () => {
    // The device clock is 60 seconds BEHIND the server clock.
    //   serverOffsetMs = deviceNow - serverNow = -60_000
    // The server says the deadline is 60 seconds away, which in device
    // time is 120 seconds away.
    const endTime = iso(120_000);
    const behind = calculateRemaining(endTime, -60_000);
    expect(behind.secondsLeft).toBeGreaterThanOrEqual(58);
    expect(behind.secondsLeft).toBeLessThanOrEqual(61);
  });

  it("compensates for a device clock that is ahead", () => {
    // The device clock is 30 seconds AHEAD of the server clock.
    // The server says the deadline is 60 seconds away, which in device
    // time is only 30 seconds away.
    const endTime = iso(30_000);
    const ahead = calculateRemaining(endTime, 30_000);
    expect(ahead.secondsLeft).toBeGreaterThanOrEqual(58);
    expect(ahead.secondsLeft).toBeLessThanOrEqual(61);
  });
});
