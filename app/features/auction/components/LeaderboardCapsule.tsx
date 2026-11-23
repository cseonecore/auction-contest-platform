"use client";

import React from "react";
import Image from "next/image";
import { getMascotSrc } from "../utils/mascot";

export interface LeaderboardTeam {
  id: string;
  name: string;
  /** Highest accepted bid in the current live auction (not a wallet). */
  currentBid?: number;
  balance?: number;
  highestBid?: number;
  winningBid?: number;
  totalSpent?: number;
  winsCount?: number;
  /** Overrides the displayed number (e.g. custom monetary stat). */
  stat?: number;
  /** Eliminated teams render in dark red regardless of rank. */
  eliminated?: boolean;
  /** The team's database character_index (1..10) — same source as /profile. */
  characterIndex?: number | null;
}

interface LeaderboardCapsuleProps {
  team: LeaderboardTeam;
  rank: number;
  totalTeams?: number;
  isCurrentTeam?: boolean;
  /** The authoritative `active_slot.leader_team_id`. */
  isLeading?: boolean;
  /** Larger text/padding for the auditorium projector. */
  variant?: "default" | "projector";
}

export function LeaderboardCapsule({
  team,
  rank,
  totalTeams = 20,
  isCurrentTeam = false,
  isLeading = false,
  variant = "default",
}: LeaderboardCapsuleProps) {
  // Live auction boards pass `currentBid` (even when it is 0), so the
  // displayed amount is always the actual bid — never a wallet balance.
  // The older fallbacks are kept for non-live consumers of this capsule.
  const bidValue = team.currentBid ?? team.highestBid ?? team.winningBid;
  const hasBidValue = bidValue !== undefined && bidValue !== null;
  const leading = isLeading && !team.eliminated && (bidValue ?? 0) > 0;
  const isProjector = variant === "projector";

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

  // Use the same mascot source as the /profile page: the DB character_index.
  // Hash fallback applies only when the DB value is unavailable.
  const mascotSrc = getMascotSrc(team.characterIndex, team.id || team.name);

  // Monetary value determination (fallback path for non-live consumers).
  const totalSpent =
    team.totalSpent ?? (team.balance != null ? Math.max(0, 100 - team.balance) : 0);
  const winsCount = team.winsCount ?? team.stat ?? 0;

  const displayAmount = hasBidValue
    ? Math.max(0, bidValue as number)
    : totalSpent > 0
      ? totalSpent
      : (team.balance ?? 100);
  const amountLabel = hasBidValue
    ? "Highest Bid"
    : totalSpent > 0
      ? "Total Spent"
      : "Balance";

  const highlightClass = leading
    ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-zinc-950 shadow-lg shadow-emerald-950/30"
    : isCurrentTeam
      ? "ring-2 ring-[#ff5500] ring-offset-2 ring-offset-zinc-950"
      : "";

  return (
    <div
      className={`relative rounded-full flex items-center justify-between shadow-md border transition-all duration-200 select-none ${getRankStyle()} ${highlightClass} ${
        isProjector ? "py-3 px-4 sm:px-5" : "py-2 px-3 sm:px-3.5"
      }`}
    >
      {/* Left Avatar */}
      <div
        className={`rounded-full bg-white/10 p-0.5 overflow-hidden shrink-0 flex items-center justify-center border border-white/20 ${
          isProjector ? "w-12 h-12" : "w-10 h-10"
        }`}
      >
        <Image
          src={mascotSrc}
          alt={team.name}
          width={isProjector ? 44 : 36}
          height={isProjector ? 44 : 36}
          className="object-contain"
        />
      </div>

      {/* Right Content: Team Name, badges and actual bid amount */}
      <div className={`flex-1 text-left overflow-hidden ${isProjector ? "ml-4" : "ml-3"}`}>
        <div
          className={`font-semibold text-white/90 truncate leading-tight flex items-center gap-1.5 ${
            isProjector ? "text-sm" : "text-[11px]"
          }`}
        >
          <span className="truncate">{team.name}</span>
          {leading && (
            <span
              className={`shrink-0 rounded-full bg-white/25 font-black uppercase tracking-wider text-white ${
                isProjector ? "text-[10px] px-2 py-0.5" : "text-[8px] px-1.5 py-0.5"
              }`}
            >
              Leading
            </span>
          )}
          {winsCount > 0 && (
            <span className="shrink-0 text-[9px] bg-amber-400/30 text-amber-200 border border-amber-400/40 px-1 py-0.2 rounded-xs font-mono font-bold">
              {winsCount} win{winsCount > 1 ? "s" : ""}
            </span>
          )}
          {isCurrentTeam && (
            <span className="shrink-0 text-[9px] bg-white/20 px-1 py-0.2 rounded-xs uppercase tracking-wider font-bold">
              You
            </span>
          )}
        </div>

        <div className="mt-0.5 flex items-baseline justify-between gap-1">
          <div
            className={`font-black text-white leading-tight font-sans tracking-tight ${
              isProjector ? "text-3xl xl:text-4xl" : "text-xl sm:text-2xl"
            }`}
          >
            {displayAmount}{" "}
            <span
              className={`font-bold text-white/60 ${
                isProjector ? "text-base" : "text-[10px]"
              }`}
            >
              pts
            </span>
          </div>
          <span className="shrink-0 text-[9px] font-semibold text-white/70 uppercase tracking-wider">
            {amountLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
