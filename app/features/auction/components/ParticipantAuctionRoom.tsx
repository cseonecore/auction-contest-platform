"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertTriangle, Loader2, RefreshCw, Trophy } from "lucide-react";
import { ParticipantAuctionHeader } from "./ParticipantAuctionHeader";
import { ParticipantBiddingPanel } from "./ParticipantBiddingPanel";
import { LiveLeaderboardGrid } from "./LiveLeaderboardGrid";
import { AuctionSoldModal, type SoldResultData } from "./AuctionSoldModal";
import { formatMinSec } from "../utils/countdown";
import { getMascotSrc } from "../utils/mascot";
import { useAuction } from "../hooks/useAuction";
import { useAuctionTimer } from "../hooks/useAuctionTimer";

/**
 * Participant auction arena.
 *
 * Every value rendered here comes from the authoritative database
 * state. There is no preview team, no placeholder counter and no
 * optimistic balance mutation: the interface shows what the backend
 * says and asks the backend to change it.
 */
export function ParticipantAuctionRoom() {
  const { state, identity, teamState, connection, loading, error, lastEvent, refresh, placeBid } =
    useAuction();

  const [soldResult, setSoldResult] = useState<SoldResultData | null>(null);
  const [announcement, setAnnouncement] = useState<{ text: string; tone: "info" | "warning" | "success" } | null>(null);
  const announcedRef = useRef<string | null>(null);

  const activeSlot = state.active_slot;
  const session = state.session;
  const settings = state.settings;

  const isPaused = Boolean(session?.is_paused);
  const isLive = activeSlot?.status === "open" && !isPaused;

  const countdown = useAuctionTimer({
    endTime: activeSlot?.end_time ?? null,
    serverTime: state.server_time,
    running: Boolean(activeSlot?.status === "open") && !isPaused,
    paused: isPaused,
    pausedRemainingSeconds: activeSlot?.paused_remaining_seconds ?? 0,
    onExpire: () => {
      // The backend decides whether the item closed — ask it.
      void refresh();
    },
  });

  // Announce the outcome of the item that just concluded.
  useEffect(() => {
    if (!activeSlot) return;
    if (activeSlot.status !== "sold" && activeSlot.status !== "skipped") return;
    if (announcedRef.current === activeSlot.id) return;

    announcedRef.current = activeSlot.id;
    setSoldResult({
      slotNumber: activeSlot.question_number ?? 0,
      status: activeSlot.status,
      topicTitle: activeSlot.topic?.title,
      winnerTeamName: activeSlot.winner_team_name ?? activeSlot.leader_team_name ?? undefined,
      winnerTeamId: activeSlot.winner_team_id ?? activeSlot.leader_team_id ?? undefined,
      winningBid: activeSlot.current_bid,
    });
  }, [activeSlot]);

  // Announce bonus time and eliminations from the event stream.
  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.event_type === "bonus_time_granted") {
      const teamName = String(lastEvent.payload.team_name ?? "A team");
      const seconds = Number(lastEvent.payload.bonus_seconds ?? 0);
      setAnnouncement({
        text: `Bonus time awarded to ${teamName} (+${seconds}s)`,
        tone: "success",
      });
    } else if (lastEvent.event_type === "team_eliminated") {
      const teamName = String(lastEvent.payload.team_name ?? "A team");
      setAnnouncement({ text: `${teamName} has been eliminated`, tone: "warning" });
    } else if (
      lastEvent.event_type === "highest_bid_changed" &&
      lastEvent.team_id &&
      lastEvent.team_id !== identity.teamId &&
      identity.teamId
    ) {
      const leader = String(lastEvent.payload.leader_name ?? "Another team");
      setAnnouncement({ text: `Outbid — ${leader} is now leading`, tone: "warning" });
    }
  }, [lastEvent, identity.teamId]);

  const handlePlaceBid = useCallback(
    async (amount: number): Promise<{ success: boolean; error?: string }> => {
      if (!activeSlot) {
        return { success: false, error: "There is no live auction item right now." };
      }
      return placeBid(activeSlot.id, amount);
    },
    [activeSlot, placeBid]
  );

  const teams = useMemo(
    () =>
      state.teams.map((team, index) => ({
        id: team.id,
        name: team.name,
        balance: team.balance,
        currentBid: team.current_bid,
        eliminated: team.eliminated,
        characterIndex: (index % 10) + 1,
      })),
    [state.teams]
  );

  const myTeam = useMemo(
    () => teams.find((team) => team.id === identity.teamId) ?? null,
    [teams, identity.teamId]
  );

  const myElimination = useMemo(
    () => state.eliminations.find((el) => el.team_id === identity.teamId) ?? null,
    [state.eliminations, identity.teamId]
  );

  const wonRounds = useMemo(() => {
    const rounds = new Set<number>();
    (teamState?.won_slots ?? []).forEach((slot) => rounds.add(slot.round));
    return rounds;
  }, [teamState]);

  const hasWonRound = activeSlot ? wonRounds.has(activeSlot.round) : false;
  const isLeader = activeSlot?.leader_team_id === identity.teamId;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111215] text-zinc-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#fe5102]" />
          <p className="text-xs text-zinc-400">Connecting to the live auction...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111215] text-zinc-100 flex flex-col font-sans selection:bg-[#ff5500] selection:text-white">
      <ParticipantAuctionHeader
        connectionStatus={
          connection === "connected"
            ? "connected"
            : connection === "offline"
              ? "offline"
              : "reconnecting"
        }
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {error && (
          <div className="mb-5 p-4 rounded-xl border border-red-500/40 bg-red-950/40 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-200 hover:text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}

        {announcement && (
          <div
            className={`mb-5 px-4 py-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              announcement.tone === "success"
                ? "bg-emerald-950/50 border-emerald-500/40 text-emerald-300"
                : announcement.tone === "warning"
                  ? "bg-amber-950/50 border-amber-500/40 text-amber-200"
                  : "bg-zinc-900/70 border-zinc-800 text-zinc-300"
            }`}
          >
            <Trophy className="w-4 h-4 shrink-0" />
            <span>{announcement.text}</span>
            <button
              type="button"
              onClick={() => setAnnouncement(null)}
              className="ml-auto text-sm opacity-60 hover:opacity-100"
              aria-label="Dismiss announcement"
            >
              &times;
            </button>
          </div>
        )}

        {myElimination && (
          <div className="mb-5 px-4 py-4 rounded-xl border border-rose-500/40 bg-rose-950/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-200">
                <p className="font-bold uppercase tracking-wider">Your team has been eliminated</p>
                <p className="mt-1 text-rose-300/90">{myElimination.reason}</p>
                <p className="mt-1 text-[11px] text-rose-300/60">
                  Eliminated on{" "}
                  {new Date(myElimination.eliminated_at).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ── LEFT PANEL ─────────────────────────────────────── */}
          <div className="lg:col-span-5 space-y-5">
            <div className="flex items-center gap-2 text-sm text-zinc-400 font-medium">
              <span>Auction Status</span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5 ${
                  isLive
                    ? "bg-[#064e3b]/80 border border-emerald-500/40 text-emerald-300"
                    : isPaused
                      ? "bg-amber-950/80 border border-amber-500/40 text-amber-300"
                      : "bg-zinc-800 border border-zinc-700 text-zinc-400"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isLive
                      ? "bg-emerald-400 animate-pulse"
                      : isPaused
                        ? "bg-amber-400"
                        : "bg-zinc-400"
                  }`}
                />
                <span className="capitalize">
                  {isPaused ? "Paused" : isLive ? "Live" : session?.status === "completed" ? "Completed" : "Upcoming"}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-3 sm:p-4 flex items-center gap-3 shadow-xl">
                <div className="w-13 h-13 rounded-full bg-orange-500/20 border border-orange-500/40 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                  <Image
                    src={getMascotSrc(myTeam?.id ?? identity.teamId ?? undefined, myTeam?.characterIndex ?? 1)}
                    alt={myTeam?.name ?? "Your team"}
                    width={46}
                    height={46}
                    className="object-contain"
                  />
                </div>

                <div className="overflow-hidden">
                  <div className="text-white font-bold text-base sm:text-lg flex items-center gap-1.5 truncate">
                    <span>{myTeam?.name ?? identity.teamName ?? "Not registered"}</span>
                    {myTeam && (
                      <span className="w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px] font-black shrink-0">
                        ✓
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="bg-[#d1fae5] text-[#065f46] text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full leading-tight">
                      Coin Balance : {myTeam?.balance ?? teamState?.balance ?? 0}
                    </span>
                    <span className="bg-[#ffedd5] text-[#9a3412] text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full leading-tight">
                      Problem Assigned : {teamState?.won_slots?.length ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-[#fef3c7] border border-amber-300 rounded-2xl p-2.5 sm:p-3.5 text-center shadow-md min-w-[130px] sm:min-w-[150px] shrink-0">
                <div className="text-[#92400e] text-[10px] sm:text-xs font-bold tracking-wide">
                  {isPaused ? "Paused" : "Auction Ends In"}
                </div>
                <div className="text-[#78350f] font-black text-base sm:text-xl font-mono tracking-tight mt-0.5">
                  {isPaused
                    ? formatMinSec(countdown.secondsLeft)
                    : activeSlot?.status === "open"
                      ? formatMinSec(countdown.secondsLeft)
                      : "--:--"}
                </div>
              </div>
            </div>

            {state.events.length > 0 && (
              <div className="space-y-1.5 text-xs text-zinc-300 pl-1">
                {state.events
                  .filter((event) => event.event_type === "auction_finalized")
                  .slice(0, 4)
                  .map((event) => {
                    const payload = event.payload as {
                      status?: string;
                      slot_id?: string;
                      winner_name?: string;
                      winning_bid?: number;
                    };
                    const sold = payload.status === "sold";
                    return (
                      <div key={event.id} className="flex items-center gap-2 truncate">
                        <span>Problem {payload.slot_id ? String(payload.slot_id).slice(0, 6) : ""}</span>
                        <span className={sold ? "text-emerald-400 font-semibold" : "text-zinc-500"}>
                          {sold ? "sold to" : "unsold"}
                        </span>
                        {sold && payload.winner_name && (
                          <div className="inline-flex items-center gap-1.5 bg-[#15803d] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            <span className="truncate max-w-[110px]">{payload.winner_name}</span>
                            <span className="font-mono">{payload.winning_bid}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="pt-2">
              <ParticipantBiddingPanel
                slotId={activeSlot?.id ?? null}
                slotStatus={activeSlot?.status ?? "pending"}
                currentBid={activeSlot?.current_bid ?? 0}
                leadingTeamName={activeSlot?.leader_team_name ?? null}
                isLeader={isLeader}
                walletBalance={myTeam?.balance ?? teamState?.balance ?? 0}
                hasWonRound={hasWonRound}
                wonCount={teamState?.won_slots?.length ?? 0}
                currentRound={session?.round ?? activeSlot?.round ?? 1}
                minBid={settings.min_bid}
                minRaise={settings.min_raise}
                isCaptain={identity.isCaptain}
                eliminated={Boolean(myElimination)}
                paused={isPaused}
                timerExpired={Boolean(activeSlot?.end_time) && countdown.secondsLeft <= 0}
                sessionActive={Boolean(session)}
                onBidSubmit={handlePlaceBid}
              />
            </div>
          </div>

          {/* ── RIGHT PANEL ────────────────────────────────────── */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 sm:p-6 shadow-xl relative select-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    {activeSlot?.topic?.title
                      ? `Problem Statement ${activeSlot.question_number != null ? String(activeSlot.question_number).padStart(2, "0") : ""}: ${activeSlot.topic.title}`
                      : "Problem Statement"}
                  </h2>
                  <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-1.5">
                    {activeSlot?.topic?.level
                      ? `Level: ${activeSlot.topic.level} Topic`
                      : "Awaiting the next problem statement"}
                  </div>
                </div>

                {activeSlot?.question_number != null && (
                  <div className="bg-[#bfdbfe] text-[#1e40af] text-xs sm:text-sm font-black px-3 py-1 rounded-full shrink-0 shadow-sm">
                    {String(activeSlot.question_number).padStart(2, "0")}
                    {state.total_items ? ` / ${String(state.total_items).padStart(2, "0")}` : ""}
                  </div>
                )}
              </div>

              <p className="text-xs sm:text-sm text-zinc-300 mt-2.5 leading-relaxed">
                {activeSlot?.topic?.description ||
                  "The organiser has not published a problem statement for this item yet."}
              </p>

              {activeSlot?.topic?.criterion != null && (
                <div className="mt-3 text-[11px] text-zinc-400 border-t border-zinc-800/80 pt-2">
                  <span className="font-semibold text-zinc-300">Evaluation Criteria: </span>
                  {typeof activeSlot.topic.criterion === "object"
                    ? JSON.stringify(activeSlot.topic.criterion)
                    : String(activeSlot.topic.criterion)}
                </div>
              )}
            </div>

            <div className="w-full bg-[#fef08a] border border-amber-300 rounded-2xl py-3 px-6 text-center shadow-lg">
              <div className="text-[#78350f] font-black text-3xl sm:text-4xl font-mono tracking-tight">
                {activeSlot?.status === "open"
                  ? formatMinSec(countdown.secondsLeft)
                  : isPaused
                    ? "PAUSED"
                    : "--:--"}
              </div>
            </div>

            <div className="pt-2">
              <LiveLeaderboardGrid
                teams={teams}
                currentTeamId={identity.teamId}
                loading={loading}
              />
            </div>
          </div>
        </div>
      </main>

      <AuctionSoldModal result={soldResult} onClose={() => setSoldResult(null)} />
    </div>
  );
}
