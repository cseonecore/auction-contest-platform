"use client";

import React from "react";
import type { AuctionTeamState } from "@/features/auction/types/auction.types";

interface LiveTeamsDisplayProps {
  teams: AuctionTeamState[];
}

/**
 * The public team board.
 *
 * Only the public data the event stream exposes: team name, current
 * bid and remaining budget.
 */
export function LiveTeamsDisplay({ teams }: LiveTeamsDisplayProps) {
  const sorted = [...teams].sort((a, b) => {
    if (b.current_bid !== a.current_bid) return b.current_bid - a.current_bid;
    return a.name.localeCompare(b.name);
  });

  if (sorted.length === 0) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-[#1a1b1f] p-10 text-center text-2xl text-zinc-500">
        No teams have registered yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
      {sorted.map((team, index) => (
        <div
          key={team.id}
          className={`rounded-2xl border px-5 py-4 ${
            team.eliminated
              ? "border-rose-500/40 bg-rose-950/30 opacity-70"
              : index === 0 && team.current_bid > 0
                ? "border-emerald-500/50 bg-emerald-950/30"
                : "border-zinc-800 bg-[#1a1b1f]"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-zinc-600 w-8">#{index + 1}</span>
            <span className="text-xl font-bold text-white truncate flex-1">{team.name}</span>
            {team.eliminated && (
              <span className="text-[10px] font-black uppercase tracking-wider text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded-full">
                Out
              </span>
            )}
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-black font-mono text-white">{team.current_bid}</span>
            <span className="text-sm font-bold text-zinc-400">{team.balance} left</span>
          </div>
        </div>
      ))}
    </div>
  );
}
