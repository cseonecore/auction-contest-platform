import { describe, expect, it } from "vitest";
import {
  compareTeamsByBid,
  rankTeamsByBid,
  type BidRankableTeam,
} from "@/features/auction/utils/leaderboard";

const team = (
  id: string,
  name: string,
  currentBid: number,
  eliminated = false
): BidRankableTeam => ({ id, name, currentBid, eliminated });

describe("rankTeamsByBid", () => {
  it("ranks by the actual highest bid, descending", () => {
    const ranked = rankTeamsByBid([
      team("a", "Alpha", 20),
      team("b", "Beta", 80),
      team("c", "Gamma", 40),
    ]);

    expect(ranked.map((t) => t.currentBid)).toEqual([80, 40, 20]);
    expect(ranked.map((t) => t.name)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(ranked.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it("never uses a wallet-style field and handles no bids as zero", () => {
    const ranked = rankTeamsByBid([
      team("a", "Alpha", 0),
      { ...team("b", "Beta", 0), balance: 500 } as BidRankableTeam & {
        balance: number;
      },
    ]);

    expect(ranked.map((t) => t.currentBid)).toEqual([0, 0]);
    expect(ranked.every((t) => t.isLeading === false)).toBe(true);
  });

  it("uses a deterministic secondary sort when bids tie", () => {
    const input = [
      team("z", "beta", 30),
      team("b", "Alpha", 30),
      team("a", "alpha", 30),
    ];

    const first = rankTeamsByBid(input);
    const second = rankTeamsByBid([...input].reverse());

    expect(first.map((t) => t.id)).toEqual(["a", "b", "z"]);
    expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));
    expect(first.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it("marks the authoritative leader returned by the backend", () => {
    const ranked = rankTeamsByBid(
      [team("a", "Alpha", 50), team("b", "Beta", 90), team("c", "Gamma", 10)],
      { leaderTeamId: "b" }
    );

    expect(ranked.find((t) => t.id === "b")?.isLeading).toBe(true);
    expect(ranked.filter((t) => t.isLeading)).toHaveLength(1);
  });

  it("falls back to the top bidder when no leader id is supplied", () => {
    const ranked = rankTeamsByBid([
      team("a", "Alpha", 50),
      team("b", "Beta", 90),
    ]);

    expect(ranked[0]?.id).toBe("b");
    expect(ranked[0]?.isLeading).toBe(true);
    expect(ranked[1]?.isLeading).toBe(false);
  });

  it("does not mutate the input array", () => {
    const input = [team("a", "Alpha", 10), team("b", "Beta", 20)];
    rankTeamsByBid(input);
    expect(input.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("compareTeamsByBid", () => {
  it("sorts by bid, then name, then id", () => {
    const teams = [
      team("2", "Same", 10),
      team("1", "Same", 10),
      team("3", "Alpha", 10),
      team("0", "Zero", 0),
    ];

    expect([...teams].sort(compareTeamsByBid).map((t) => t.id)).toEqual([
      "3",
      "1",
      "2",
      "0",
    ]);
  });
});
