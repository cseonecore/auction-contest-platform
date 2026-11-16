"use client";

import React from "react";
import { B2BLogo } from "@/components/shared/B2BLogo";
import { useProjectorAuction } from "@/features/projector/auction/hooks/useProjectorAuction";
import { useAuctionTimer } from "@/features/auction/hooks/useAuctionTimer";
import { ProjectorTimer } from "@/features/projector/auction/components/ProjectorTimer";
import { CurrentQuestionDisplay } from "@/features/projector/auction/components/CurrentQuestionDisplay";
import { HighestBidDisplay } from "@/features/projector/auction/components/HighestBidDisplay";
import { LiveTeamsDisplay } from "@/features/projector/auction/components/LiveTeamsDisplay";
import { AuctionAnnouncements } from "@/features/projector/auction/components/AuctionAnnouncements";

/**
 * Auditorium projector.
 *
 * Read-only and public: it renders the same authoritative state as
 * the participant arena, without exposing submissions, private team
 * data or any admin control.
 */
export default function ProjectorAuctionPage() {
  const { state, loading, error, connection, lastEvent } = useProjectorAuction();

  const activeSlot = state.active_slot;
  const session = state.session;

  const biddingCountdown = useAuctionTimer({
    endTime: activeSlot?.end_time ?? null,
    serverTime: state.server_time,
    running: activeSlot?.status === "open",
    paused: activeSlot?.timer_status === "paused",
    pausedRemainingSeconds: activeSlot?.paused_remaining_seconds ?? 0,
  });

  const solvingCountdown = useAuctionTimer({
    endTime: session?.timer_ends_at ?? null,
    serverTime: state.server_time,
    running: session?.timer_status === "running",
    paused: session?.timer_status === "paused",
    pausedRemainingSeconds: session?.paused_remaining_seconds ?? 0,
  });

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-zinc-100 font-sans p-6 sm:p-10">
      <header className="flex items-center justify-between gap-6 pb-6 border-b border-zinc-800/80">
        <div className="flex items-center gap-5">
          <B2BLogo variant="light" height={40} />
          <span className="text-2xl font-black uppercase tracking-[0.25em] text-zinc-500">
            Live Auction
          </span>
        </div>

        <div className="flex items-center gap-4">
          {session?.total_bonus_seconds ? (
            <span className="text-sm font-bold text-emerald-300">
              Bonus awarded: {session.total_bonus_seconds}s
            </span>
          ) : null}
          <span
            className={`text-sm font-bold uppercase tracking-widest ${
              connection === "connected" ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {connection}
          </span>
        </div>
      </header>

      <main className="pt-8 space-y-8">
        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 px-6 py-4 text-lg text-rose-200">
            {error}
          </div>
        )}

        <CurrentQuestionDisplay item={activeSlot} />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-6">
            <HighestBidDisplay
              item={activeSlot}
              minNextBid={activeSlot?.min_next_bid ?? state.settings.min_bid}
            />
            <LiveTeamsDisplay teams={state.teams} />
          </div>

          <div className="space-y-6">
            <ProjectorTimer
              secondsLeft={biddingCountdown.secondsLeft}
              status={activeSlot?.timer_status ?? "idle"}
              paused={Boolean(session?.is_paused)}
              bonusSeconds={session?.total_bonus_seconds ?? 0}
            />

            {session?.timer_status === "running" && (
              <div className="rounded-3xl border border-emerald-500/40 bg-emerald-950/30 px-8 py-5 text-center">
                <div className="text-xl font-black uppercase tracking-[0.25em] text-emerald-300/80">
                  Solving Clock
                </div>
                <div className="text-6xl font-black font-mono text-emerald-200 mt-1">
                  {String(Math.floor(solvingCountdown.secondsLeft / 60)).padStart(2, "0")}:
                  {String(solvingCountdown.secondsLeft % 60).padStart(2, "0")}
                </div>
              </div>
            )}

            {loading && (
              <div className="rounded-2xl border border-zinc-800 bg-[#1a1b1f] p-6 text-center text-xl text-zinc-500">
                Connecting to the live auction...
              </div>
            )}
          </div>
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-black uppercase tracking-[0.25em] text-zinc-500">
            Announcements
          </h2>
          <AuctionAnnouncements events={state.events} lastEvent={lastEvent} />
        </section>
      </main>
    </div>
  );
}
