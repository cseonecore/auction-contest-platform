"use client";

import React from "react";
import { LeaderboardCapsule, LeaderboardTeam } from "./LeaderboardCapsule";
import { rankTeamsByBid } from "../utils/leaderboard";

interface LiveLeaderboardGridProps {
  teams: LeaderboardTeam[];
  currentTeamId?: string | null;
  /** Authoritative leader from the live item (`leader_team_id`). */
  leaderTeamId?: string | null;
  loading?: boolean;
}

export function LiveLeaderboardGrid({
  teams,
  currentTeamId,
  leaderTeamId = null,
  loading = false,
}: LiveLeaderboardGridProps) {
  // Shared ranking: highest accepted bid first, deterministic tie-break.
  // Wallet balance never influences the live leaderboard order.
  const rankedTeams = rankTeamsByBid(
    teams.map((team) => ({
      ...team,
      currentBid:
        team.currentBid ?? team.highestBid ?? team.winningBid ?? 0,
    })),
    { leaderTeamId }
  );

  return (
    <div className="w-full">
      {/* Title */}
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
          Lead board
        </h3>
        <span className="text-xs text-zinc-400 font-medium">
          {rankedTeams.length} Teams
        </span>
      </div>

      {loading && teams.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
          {Array.from({ length: 16 }).map((_, idx) => (
            <div
              key={idx}
              className="h-14 rounded-full bg-zinc-800/60 border border-zinc-700/40"
            />
          ))}
        </div>
      ) : rankedTeams.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-zinc-900/50 border border-zinc-800 text-zinc-400 text-sm">
          No teams registered yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
          {rankedTeams.map((team) => (
            <LeaderboardCapsule
              key={team.id}
              team={team}
              rank={team.rank}
              totalTeams={rankedTeams.length}
              isCurrentTeam={!!currentTeamId && team.id === currentTeamId}
              isLeading={team.isLeading}
            />
          ))}
        </div>
      )}
    </div>
  );
}
