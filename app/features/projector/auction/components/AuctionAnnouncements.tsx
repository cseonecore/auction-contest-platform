"use client";

import React, { useEffect, useRef, useState } from "react";
import type { AuctionEvent } from "@/features/auction/types/auction.types";

interface AuctionAnnouncementsProps {
  events: AuctionEvent[];
  lastEvent: AuctionEvent | null;
}

interface Announcement {
  id: string;
  headline: string;
  detail: string;
  tone: "bonus" | "elimination" | "winner" | "info";
}

/**
 * Public announcements.
 *
 * Bonus-time awards, eliminations and winners are announced to the
 * auditorium. Only public information is ever shown.
 */
export function AuctionAnnouncements({ events, lastEvent }: AuctionAnnouncementsProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const push = (event: AuctionEvent) => {
      if (seenRef.current.has(event.id)) return;
      seenRef.current.add(event.id);

      const payload = event.payload as {
        team_name?: string;
        reason?: string;
        bonus_seconds?: number;
        topic_title?: string;
        winner_name?: string;
        winning_bid?: number;
        status?: string;
      };

      let announcement: Announcement | null = null;

      if (event.event_type === "bonus_time_granted") {
        announcement = {
          id: event.id,
          headline: "Bonus time awarded",
          detail: `${payload.team_name ?? "A team"} receives +${payload.bonus_seconds ?? 0} seconds`,
          tone: "bonus",
        };
      } else if (event.event_type === "team_eliminated") {
        announcement = {
          id: event.id,
          headline: "Team eliminated",
          detail: `${payload.team_name ?? "A team"} — ${payload.reason ?? ""}`,
          tone: "elimination",
        };
      } else if (event.event_type === "team_restored") {
        announcement = {
          id: event.id,
          headline: "Team reinstated",
          detail: `${payload.team_name ?? "A team"} is back in the auction`,
          tone: "info",
        };
      } else if (event.event_type === "auction_finalized" && payload.status === "sold") {
        announcement = {
          id: event.id,
          headline: "Problem sold",
          detail: `${payload.topic_title ?? "Problem"} won by ${payload.winner_name ?? "a team"} for ${payload.winning_bid ?? 0} points`,
          tone: "winner",
        };
      }

      if (!announcement) return;

      setAnnouncements((prev) => [announcement, ...prev].slice(0, 6));
    };

    if (lastEvent) push(lastEvent);
    events.slice(0, 10).forEach(push);
  }, [events, lastEvent]);

  const toneClass: Record<Announcement["tone"], string> = {
    bonus: "border-emerald-500/50 bg-emerald-950/40 text-emerald-200",
    elimination: "border-rose-500/50 bg-rose-950/40 text-rose-200",
    winner: "border-amber-500/50 bg-amber-950/40 text-amber-200",
    info: "border-zinc-700 bg-zinc-900/60 text-zinc-300",
  };

  return (
    <div className="space-y-3">
      {announcements.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-[#1a1b1f] p-6 text-center text-xl text-zinc-500">
          No announcements yet.
        </div>
      ) : (
        announcements.map((announcement) => (
          <div
            key={announcement.id}
            className={`rounded-2xl border px-6 py-4 ${toneClass[announcement.tone]}`}
          >
            <div className="text-xl font-black uppercase tracking-[0.2em]">
              {announcement.headline}
            </div>
            <div className="mt-1 text-2xl font-bold">{announcement.detail}</div>
          </div>
        ))
      )}
    </div>
  );
}
