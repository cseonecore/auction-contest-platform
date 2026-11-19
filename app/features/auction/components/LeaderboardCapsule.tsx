"use client";

import React from "react";
import Image from "next/image";
import { getMascotSrc } from "../utils/mascot";

export interface LeaderboardTeam {
  id: string;
  name: string;
  balance?: number;
  currentBid?: number;
  highestBid?: number;
  winningBid?: number;
  totalSpent?: number;
  winsCount?: number;
  characterIndex?: number;
  /** Overrides the displayed number (e.g. custom monetary stat). */
  stat?: number;
  /** Eliminated teams render in dark red regardless of rank. */
  eliminated?: boolean;
}

interface LeaderboardCapsuleProps {
  team: LeaderboardTeam;
  rank: number;
  totalTeams?: number;
  isCurrentTeam?: boolean;
}

export function LeaderboardCapsule({
  team,
  rank,
  totalTeams = 20,
  isCurrentTeam = false,
}: LeaderboardCapsuleProps) {
  // Determine rank color styling strictly matching contest visual palette
  const getRankStyle = () => {
    // Eliminated teams: deep dark red, dimmed
    if (team.eliminated) {
      return "bg-[#450a0a] border-red-900/60 text-white/70";
    }
    // 1st Place: Vibrant Green
    if (rank === 1) {
      return "bg-[#15803d] border-emerald-400/40 text-white shadow-emerald-950/40";
    }
    // 2nd Place: Warm Gold / Yellow
    if (rank === 2) {
      return "bg-[#a16207] border-yellow-400/40 text-white shadow-yellow-950/40";
    }
    // 3rd Place: Bronze / Orange
    if (rank === 3) {
      return "bg-[#9a3412] border-amber-400/40 text-white shadow-amber-950/40";
    }
    // 4th Place: Slate / Dark Blue
    if (rank === 4) {
      return "bg-[#1e293b] border-slate-500/40 text-white";
    }
    // 5th Place: Rose / Magenta
    if (rank === 5) {
      return "bg-[#be185d] border-pink-400/40 text-white";
    }
    // 6th Place: Purple
    if (rank === 6) {
      return "bg-[#7e22ce] border-purple-400/40 text-white";
    }
    // 7th Place: Cyan / Teal
    if (rank === 7) {
      return "bg-[#0e7490] border-cyan-400/40 text-white";
    }
    // Bottom 4 Teams: Deep Dark Red / Wine
    if (rank >= totalTeams - 3) {
      return "bg-[#450a0a] border-red-900/50 text-white/80";
    }
    // Neutral dark grey
    return "bg-[#27272a] border-zinc-700/50 text-white/90";
  };

  const mascotSrc = getMascotSrc(team.id || team.name, team.characterIndex || rank);

  // Monetary value determination
  const hasLiveBid = Boolean(team.currentBid && team.currentBid > 0);
  const totalSpent = team.totalSpent ?? (team.balance != null ? Math.max(0, 100 - team.balance) : 0);
  const winsCount = team.winsCount ?? team.stat ?? 0;

  let displayAmount: number;
  let amountLabel: string;

  if (hasLiveBid) {
    displayAmount = team.currentBid!;
    amountLabel = "Highest Bid";
  } else if (totalSpent > 0) {
    displayAmount = totalSpent;
    amountLabel = "Total Spent";
  } else {
    displayAmount = team.balance ?? 100;
    amountLabel = "Balance";
  }

  return (
    <div
      className={`relative rounded-full py-2 px-3 sm:px-3.5 flex items-center justify-between shadow-md border transition-all duration-200 select-none ${getRankStyle()} ${
        isCurrentTeam ? "ring-2 ring-[#ff5500] ring-offset-2 ring-offset-zinc-950" : ""
      }`}
    >
      {/* Left Avatar */}
      <div className="w-10 h-10 rounded-full bg-white/10 p-0.5 overflow-hidden shrink-0 flex items-center justify-center border border-white/20">
        <Image
          src={mascotSrc}
          alt={team.name}
          width={36}
          height={36}
          className="object-contain"
        />
      </div>

      {/* Right Content: Team Name, Wins Badge, Monetary Value */}
      <div className="flex-1 ml-3 text-left overflow-hidden">
        <div className="text-[11px] font-semibold text-white/90 truncate leading-tight flex items-center justify-between gap-1">
          <span className="truncate">{team.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            {winsCount > 0 && (
              <span className="text-[9px] bg-amber-400/30 text-amber-200 border border-amber-400/40 px-1 py-0.2 rounded-xs font-mono font-bold">
                {winsCount} win{winsCount > 1 ? "s" : ""}
              </span>
            )}
            {isCurrentTeam && (
              <span className="text-[9px] bg-white/20 px-1 py-0.2 rounded-xs uppercase tracking-wider font-bold">
                You
              </span>
            )}
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-1 mt-0.5">
          <div className="text-xl sm:text-2xl font-black text-white leading-tight font-mono tracking-tight">
            {displayAmount} <span className="text-[10px] font-bold text-white/70">PTS</span>
          </div>
          <span className="text-[9px] font-semibold text-white/70 uppercase tracking-wider shrink-0">
            {amountLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
