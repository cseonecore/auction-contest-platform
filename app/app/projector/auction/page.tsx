"use client";

/**
 * Auditorium projector view — /projector/auction
 *
 * Exactly what the reference projector design shows and nothing more:
 *   1. The current problem statement card (timer + progress pill inside).
 *   2. The live leaderboard.
 *
 * Read-only and public: it only reads `get_live_auction_state()` and the
 * realtime event stream. No administrative buttons, no navigation.
 * Opens from the admin page in a new browser tab.
 */

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useProjectorAuction } from "@/features/projector/auction/hooks/useProjectorAuction";
import { useAuctionTimer } from "@/features/auction/hooks/useAuctionTimer";
import { LeaderboardCapsule } from "@/features/auction/components/LeaderboardCapsule";
import { B2BLogo } from "@/components/shared/B2BLogo";
import type { LiveAuctionState } from "@/features/auction/types/auction.types";

/** Formats remaining seconds as "00m 20s". */
function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function pad2(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

/**
 * Splits the stored description into a brief (first sentence) and the
 * remaining detailed description — the brief is derived, never invented.
 */
function splitBrief(description: string | null | undefined): {
  brief: string;
  detail: string;
} {
  const text = (description ?? "").trim();
  if (!text) return { brief: "", detail: "" };

  const match = text.match(/^[\s\S]*?([.!?)\n])/);
  if (!match) return { brief: text, detail: "" };

  const end = (match.index ?? 0) + match[0].length;
  const brief = text.slice(0, end).trim();
  const detail = text.slice(end).trim();
  return detail ? { brief, detail } : { brief, detail: "" };
}

/**
 * Questions won per team, replayed from the publicly readable
 * `auction_events` stream (RLS policy "Public view auction events").
 *
 * The slots table itself is not readable by the anonymous projector
 * client in the deployed database, but every sale emits an
 * `auction_finalized` event carrying the winning team, and a full
 * auction reset re-emits `pending` status events for every slot — so
 * replaying those events in chronological order yields exactly the
 * same per-team win counts the slots table holds.
 *
 * Re-fetched whenever the authoritative state syncs (heartbeat,
 * realtime events) — the filtered query is small and cheap.
 */
function usePublicWins(state: LiveAuctionState) {
  const [wins, setWins] = useState<Map<string, number>>(() => new Map());
  const syncedAt = state.server_time;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("auction_events")
        .select("event_type, slot_id, team_id, payload, server_timestamp")
        .or("event_type.eq.auction_finalized,payload->>status.eq.pending")
        .order("server_timestamp", { ascending: true });
      if (cancelled || error || !data) return;

      // Chronological replay: latest status per slot decides.
      const winnerBySlot = new Map<string, string>();
      for (const row of data as Array<{
        event_type: string;
        slot_id: string | null;
        team_id: string | null;
        payload: Record<string, unknown> | null;
      }>) {
        if (row.payload?.status === "pending") {
          winnerBySlot.delete(row.slot_id as string);
        } else if (row.event_type === "auction_finalized" && row.team_id && row.slot_id) {
          winnerBySlot.set(row.slot_id, row.team_id);
        }
      }

      const counts = new Map<string, number>();
      for (const teamId of winnerBySlot.values()) {
        counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
      }
      setWins(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [syncedAt]);

  return wins;
}

export default function ProjectorAuctionPage() {
  const { state, connection, refresh } = useProjectorAuction();

  const activeSlot = state.active_slot;
  const isLive = !!activeSlot && activeSlot.status === "open";
  const topic = activeSlot?.topic ?? null;
  const { brief, detail } = splitBrief(topic?.description);

  const totalCount = state.total_items ?? 0;
  const displayNumber = activeSlot?.question_number ?? 1;

  // Server-authoritative countdown: the database owns the deadline.
  const countdown = useAuctionTimer({
    endTime: activeSlot?.end_time ?? null,
    serverTime: state.server_time,
    running: activeSlot?.timer_status === "running",
    paused: activeSlot?.timer_status === "paused",
    pausedRemainingSeconds: activeSlot?.paused_remaining_seconds ?? 0,
    onExpire: () => {
      // The backend decides what expiry means — re-read the state.
      void refresh();
    },
  });

  const timerLabel = !isLive
    ? "Awaiting open"
    : activeSlot?.timer_status === "paused"
      ? `${formatClock(countdown.secondsLeft)} · Paused`
      : countdown.isExpired
        ? "Time expired"
        : `Time Left: ${formatClock(countdown.secondsLeft)}`;

  // ── Leaderboard: questions won per team, descending ─────────
  const winsByTeam = usePublicWins(state);

  const boardRows = useMemo(() => {
    return state.teams
      .map((t, i) => ({
        id: t.id,
        name: t.name,
        balance: t.balance,
        currentBid: t.current_bid,
        stat: winsByTeam.get(t.id) ?? 0,
        eliminated: t.eliminated,
        characterIndex: (i % 10) + 1,
      }))
      .sort((a, b) => b.stat - a.stat || b.balance - a.balance || a.name.localeCompare(b.name));
  }, [state.teams, winsByTeam]);

  const pillTone = !isLive
    ? "bg-zinc-700 text-zinc-200"
    : countdown.isExpired
      ? "bg-rose-600 text-white"
      : countdown.isUrgent
        ? "bg-amber-500 text-amber-950"
        : "bg-emerald-600 text-white";
  const pillBadgeTone =
    pillTone === "bg-emerald-600 text-white"
      ? "bg-sky-200 text-emerald-950"
      : pillTone === "bg-amber-500 text-amber-950"
        ? "bg-amber-100 text-amber-900"
        : "bg-white/20 text-white";

  return (
    <div className="flex min-h-screen flex-col bg-[#111215] font-sans text-white">
      {/* Slim status bar — no navigation clutter */}
      <header className="flex items-center justify-between border-b border-white/10 bg-[#141518] px-6 py-3 select-none">
        <div className="flex items-center gap-3">
          <B2BLogo variant="light" height={20} />
          <span className="rounded-full border border-[#fe5102]/30 bg-[#fe5102]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#fe5102]">
            Auction Live
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-400">
          <span
            className={`h-2 w-2 rounded-full ${
              connection === "connected"
                ? "animate-pulse bg-emerald-500"
                : "bg-rose-500"
            }`}
          />
          {connection === "connected" ? "Live" : "Reconnecting…"}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {/* Problem statement card */}
        <section className="min-h-[320px] rounded-2xl border border-white/10 bg-[#1b1c21] p-6 sm:p-10">
          {activeSlot && topic ? (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-500">
                    Problem Statement
                  </p>
                  <h1 className="mt-1 text-2xl font-black text-white sm:text-4xl">
                    Problem Statement {pad2(displayNumber)}
                  </h1>
                  <h2 className="mt-2 truncate text-base font-semibold text-zinc-300 sm:text-xl">
                    {topic.title}
                  </h2>
                </div>

                {/* Progress + timer pill (inside the card) */}
                <div
                  className={`inline-flex shrink-0 items-center gap-2.5 self-start rounded-full py-2 pl-2 pr-5 ${pillTone}`}
                >
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-black ${pillBadgeTone}`}
                  >
                    {pad2(displayNumber)} / {pad2(totalCount)}
                  </span>
                  <span className="text-sm font-black">{timerLabel}</span>
                </div>
              </div>

              {brief && (
                <p className="mt-7 text-lg font-semibold leading-relaxed text-zinc-100 sm:text-xl">
                  {brief}
                </p>
              )}
              {(detail || (!brief && topic.description)) && (
                <div className="mt-4 max-h-64 overflow-y-auto whitespace-pre-line text-base leading-relaxed text-zinc-400">
                  {detail || topic.description}
                </div>
              )}
              {!topic.description && (
                <p className="mt-7 text-base italic text-zinc-600">
                  No description was provided for this problem statement.
                </p>
              )}

              {isLive && (
                <p className="mt-6 text-sm text-zinc-500">
                  {activeSlot?.leader_team_name
                    ? `Current bid ${activeSlot.current_bid} pts · Leader: ${activeSlot.leader_team_name}`
                    : `Current bid ${activeSlot?.current_bid ?? 0} pts · No bids yet`}
                </p>
              )}
            </>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
              <p className="text-2xl font-black text-zinc-400">
                Waiting for the next problem statement
              </p>
              <p className="mt-2 text-base text-zinc-600">
                The organiser has not published a question yet.
              </p>
            </div>
          )}
        </section>

        {/* Live leaderboard */}
        <div className="mt-8">
          <h2 className="mb-4 text-xl font-black tracking-tight text-white sm:text-2xl">
            Lead board
          </h2>

          {boardRows.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-10 text-center text-lg text-zinc-500">
              No teams have registered yet.
            </p>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {boardRows.map((team, rank) => (
                  <LeaderboardCapsule
                    key={team.id}
                    team={team}
                    rank={rank + 1}
                    totalTeams={boardRows.length}
                  />
                ))}
              </div>
              {boardRows.length > 8 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#111215] to-transparent" />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
