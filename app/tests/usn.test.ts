import { describe, it, expect } from "vitest";
import { isValidUsn, normalizeUsn } from "@/lib/usn";

describe("USN validation", () => {
  it("accepts senior formats with a 4MT or 5MT prefix", () => {
    expect(isValidUsn("4MT24CS001")).toBe(true);
    expect(isValidUsn("5MT25IS042")).toBe(true);
  });

  it("accepts the first-year MT format", () => {
    expect(isValidUsn("MT26CS001")).toBe(true);
    expect(isValidUsn("mt26ec123")).toBe(true);
  });

  it("normalizes casing, spaces, and hyphens", () => {
    expect(normalizeUsn(" mt26-cs001 ")).toBe("MT26CS001");
    expect(isValidUsn(" mt26-cs001 ")).toBe(true);
  });

  it("rejects malformed or unsupported USNs", () => {
    expect(isValidUsn("")).toBe(false);
    expect(isValidUsn("MT26CS01")).toBe(false);
    expect(isValidUsn("4MT2CS001")).toBe(false);
    expect(isValidUsn("6MT26CS001")).toBe(false);
    expect(isValidUsn("MT26CSC01")).toBe(false);
    expect(isValidUsn("ABC123")).toBe(false);
  });
});
