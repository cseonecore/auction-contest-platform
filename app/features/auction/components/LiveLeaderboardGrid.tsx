"use client";

import React from "react";
import { LeaderboardCapsule, LeaderboardTeam } from "./LeaderboardCapsule";

interface LiveLeaderboardGridProps {
  teams: LeaderboardTeam[];
  currentTeamId?: string | null;
  loading?: boolean;
}

export function LiveLeaderboardGrid({
  teams,
  currentTeamId,
  loading = false,
}: LiveLeaderboardGridProps) {
  // Sort teams defensively by current bid (descending), then balance, then name
  const sortedTeams = [...teams].sort((a, b) => {
    const bidDiff = (b.currentBid ?? 0) - (a.currentBid ?? 0);
    if (bidDiff !== 0) return bidDiff;
    const balDiff = (b.balance ?? 0) - (a.balance ?? 0);
    if (balDiff !== 0) return balDiff;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="w-full">
      {/* Title */}
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
          Lead board
        </h3>
        <span className="text-xs text-zinc-400 font-medium">
          {sortedTeams.length} Teams
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
      ) : sortedTeams.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-zinc-900/50 border border-zinc-800 text-zinc-400 text-sm">
          No teams registered yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
          {sortedTeams.map((team, idx) => (
            <LeaderboardCapsule
              key={team.id || `team-${idx}`}
              team={team}
              rank={idx + 1}
              totalTeams={sortedTeams.length}
              isCurrentTeam={!!currentTeamId && team.id === currentTeamId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
