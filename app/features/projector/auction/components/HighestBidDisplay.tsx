"use client";

import React from "react";
import type { AuctionItem } from "@/features/auction/types/auction.types";

interface HighestBidDisplayProps {
  item: AuctionItem | null;
  minNextBid: number;
}

/** The leading bid and the team that owns it. */
export function HighestBidDisplay({ item, minNextBid }: HighestBidDisplayProps) {
  const hasBid = Boolean(item && item.current_bid > 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="rounded-3xl border border-zinc-800 bg-[#1a1b1f] p-8">
        <span className="text-xl font-black uppercase tracking-[0.25em] text-zinc-400">
          Highest Bid
        </span>
        <div className="mt-3 text-7xl font-black font-mono text-[#fe5102] leading-none">
          {item?.current_bid ?? 0}
          <span className="text-2xl text-zinc-500 ml-2">pts</span>
        </div>
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-[#1a1b1f] p-8">
        <span className="text-xl font-black uppercase tracking-[0.25em] text-zinc-400">
          Highest Bidder
        </span>
        <div className="mt-3 text-4xl font-black text-white leading-tight truncate">
          {item?.leader_team_name ?? "No bids yet"}
        </div>
        {hasBid && (
          <div className="mt-2 text-lg text-zinc-400">
            Next minimum bid:{" "}
            <span className="font-mono font-bold text-emerald-300">{minNextBid} pts</span>
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-[#1a1b1f] p-8">
        <span className="text-xl font-black uppercase tracking-[0.25em] text-zinc-400">
          Item Status
        </span>
        <div className="mt-3 text-4xl font-black text-white uppercase">
          {item?.status ?? "idle"}
        </div>
        {item?.winner_team_name && (
          <div className="mt-2 text-lg text-emerald-300 font-bold">
            Won by {item.winner_team_name}
          </div>
        )}
      </div>
    </div>
  );
}
