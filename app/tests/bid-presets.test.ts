import { describe, expect, it } from "vitest";
import {
  BID_PRESET_INCREMENTS,
  calculatePresetBid,
} from "@/features/auction/utils/bid-presets";

describe("bid presets", () => {
  it("offers the four one-click increments", () => {
    expect([...BID_PRESET_INCREMENTS]).toEqual([20, 15, 10, 5]);
  });

  it("adds the preset increment to the minimum legal next bid", () => {
    expect(calculatePresetBid(10, 20)).toBe(30);
    expect(calculatePresetBid(10, 15)).toBe(25);
    expect(calculatePresetBid(10, 10)).toBe(20);
    expect(calculatePresetBid(10, 5)).toBe(15);
  });

  it("uses the authoritative minimum next bid after an existing bid", () => {
    expect(calculatePresetBid(60, 10)).toBe(70);
    expect(calculatePresetBid(60, 5)).toBe(65);
  });

  it("never returns a fractional or negative amount", () => {
    expect(calculatePresetBid(10.9, 5.9)).toBe(15);
    expect(calculatePresetBid(-10, 5)).toBe(5);
  });
});
