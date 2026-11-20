/**
 * Shared live-auction leaderboard ranking.
 *
 * Every surface (participant arena, admin console and projector) ranks
 * teams from the same authoritative value: `teams[].current_bid` in
 * `get_live_auction_state()`. That value is the highest accepted bid the
 * team placed on the item currently in play — never a wallet balance or
 * a bid count.
 */

export interface BidRankableTeam {
  id: string;
  name: string;
  /** Highest accepted bid by this team on the live item (0 when none). */
  currentBid: number;
  eliminated?: boolean;
}

export interface RankTeamsByBidOptions {
  /**
   * Authoritative leader from `active_slot.leader_team_id`. When present
   * this team is marked as leading even if the local array is stale.
   */
  leaderTeamId?: string | null;
}

export type RankedBidTeam<T extends BidRankableTeam> = T & {
  /** 1-based position after ranking. */
  rank: number;
  /** True for the current highest bidder (when a bid exists). */
  isLeading: boolean;
};

function normaliseBid(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Descending bid order with a deterministic tie-break:
 *   1. highest bid first
 *   2. team name (case-insensitive, ascending)
 *   3. team id (ascending)
 *
 * Bids are strictly increasing in the auction engine, so a positive tie
 * should not occur; the secondary rules still make the order stable if
 * two teams legitimately sit on the same value (for example, no bids yet).
 */
export function compareTeamsByBid(a: BidRankableTeam, b: BidRankableTeam): number {
  const bidDelta = normaliseBid(b.currentBid) - normaliseBid(a.currentBid);
  if (bidDelta !== 0) return bidDelta;

  const nameOrder = a.name.localeCompare(b.name, undefined, {
    sensitivity: "base",
  });
  if (nameOrder !== 0) return nameOrder;

  return a.id.localeCompare(b.id);
}

export function rankTeamsByBid<T extends BidRankableTeam>(
  teams: readonly T[],
  options: RankTeamsByBidOptions = {}
): RankedBidTeam<T>[] {
  const ranked = [...teams].sort(compareTeamsByBid);
  const leaderTeamId = options.leaderTeamId ?? null;
  const leaderHasBid =
    leaderTeamId !== null &&
    ranked.some(
      (team) => team.id === leaderTeamId && normaliseBid(team.currentBid) > 0
    );
  const highestBid = ranked.length > 0 ? normaliseBid(ranked[0]?.currentBid ?? 0) : 0;

  return ranked.map((team, index) => ({
    ...team,
    rank: index + 1,
    isLeading: leaderHasBid
      ? team.id === leaderTeamId
      : highestBid > 0 && index === 0,
  }));
}
