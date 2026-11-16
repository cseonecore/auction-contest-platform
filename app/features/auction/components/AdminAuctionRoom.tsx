"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Play,
  Pause,
  SkipForward,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  Gavel,
  Users,
  Trophy,
} from "lucide-react";
import { ContestRulesModal } from "./ContestRulesModal";
import { LiveLeaderboardGrid } from "./LiveLeaderboardGrid";
import { AuctionSoldModal, SoldResultData } from "./AuctionSoldModal";
import { formatMinSec, calculateCountdown } from "../utils/countdown";
import { getMascotSrc } from "../utils/mascot";
import { useAdminAuth } from "@/features/admin/hooks/useAdminAuth";
import { supabase } from "@/lib/supabase";
import { B2BLogo } from "@/components/shared/B2BLogo";

interface SlotItem {
  id: string;
  round: number;
  status: "pending" | "open" | "sold" | "skipped";
  current_bid: number;
  leader_team_id: string | null;
  end_time: string | null;
  winner_team_id: string | null;
  topic?: {
    id: string;
    level: string;
    title: string;
    description: string;
  } | null;
  leader_team?: { id: string; name: string } | null;
  winner_team?: { id: string; name: string } | null;
}

export function AdminAuctionRoom() {
  const { user, role, signOut, isAdmin } = useAdminAuth();
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  // Auction State
  const [auctionStatus, setAuctionStatus] = useState<"LIVE" | "UPCOMING" | "PAUSED" | "COMPLETED">("UPCOMING");
  const [activeSlot, setActiveSlot] = useState<SlotItem | null>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(1);
  const [totalSlots, setTotalSlots] = useState<number>(40);
  const [allSlots, setAllSlots] = useState<SlotItem[]>([]);
  const [historyResults, setHistoryResults] = useState<any[]>([]);
  const [leaderboardTeams, setLeaderboardTeams] = useState<any[]>([]);
  const [settings, setSettings] = useState({
    min_bid: 10,
    min_raise: 10,
    opening_window_seconds: 10,
    timer_extension_seconds: 5,
  });

  // Timer
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Action Loading
  const [isPerformingAction, setIsPerformingAction] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [lastSoldResult, setLastSoldResult] = useState<SoldResultData | null>(null);
  const lastAnnouncedSlotIdRef = useRef<string | null>(null);

  // 1. Fetch State
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/auction/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();

      if (data.success) {
        setAuctionStatus(data.auctionStatus);
        setTotalSlots(data.totalSlots || 40);
        setActiveSlotIndex(data.activeSlotIndex || 1);
        setSettings(data.settings);
        setAllSlots(data.slots || []);

        const slot = data.activeSlot as SlotItem | null;
        setActiveSlot(slot);

        // Check if slot closed to trigger popup
        if (slot && (slot.status === "sold" || slot.status === "skipped")) {
          if (lastAnnouncedSlotIdRef.current !== slot.id) {
            lastAnnouncedSlotIdRef.current = slot.id;
            setLastSoldResult({
              slotNumber: data.activeSlotIndex,
              status: slot.status,
              topicTitle: slot.topic?.title,
              winnerTeamName: slot.winner_team?.name || slot.leader_team?.name,
              winnerTeamId: slot.winner_team_id || slot.leader_team_id || undefined,
              winningBid: slot.current_bid,
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // 2. Fetch Leaderboard & History
  const fetchAuxiliary = useCallback(async (slotId?: string | null) => {
    try {
      const [tRes, hRes] = await Promise.all([
        fetch(slotId ? `/api/auction/teams?slotId=${slotId}` : "/api/auction/teams", { cache: "no-store" }),
        fetch("/api/auction/history", { cache: "no-store" }),
      ]);

      if (tRes.ok) {
        const tData = await tRes.json();
        if (tData.teams) setLeaderboardTeams(tData.teams);
      }

      if (hRes.ok) {
        const hData = await hRes.json();
        if (hData.results) setHistoryResults(hData.results);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchState();
    fetchAuxiliary(activeSlot?.id);
  }, [fetchState, fetchAuxiliary, activeSlot?.id]);

  useEffect(() => {
    fetchState();
    fetchAuxiliary();
  }, [fetchState, fetchAuxiliary]);

  useEffect(() => {
    fetchAuxiliary(activeSlot?.id);
  }, [activeSlot?.id, fetchAuxiliary]);

  // Realtime subscription & polling
  useEffect(() => {
    const channel = supabase
      .channel("admin-auction-room")
      .on("postgres_changes", { event: "*", schema: "public", table: "slots" }, () => {
        refreshAll();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, () => {
        refreshAll();
      })
      .subscribe();

    const interval = setInterval(refreshAll, 2000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refreshAll]);

  // Countdown timer loop
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    if (!activeSlot || activeSlot.status !== "open" || !activeSlot.end_time) {
      setSecondsLeft(0);
      return;
    }

    const tick = () => {
      const countdown = calculateCountdown(activeSlot.end_time);
      setSecondsLeft(countdown.secondsLeft);
      if (countdown.isExpired) {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        fetchState();
      }
    };

    tick();
    timerIntervalRef.current = setInterval(tick, 250);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [activeSlot?.end_time, activeSlot?.status, fetchState]);

  // Admin Actions Dispatcher
  const handleAdminAction = async (action: string, payload: any = {}) => {
    setIsPerformingAction(true);
    setActionMessage(null);

    try {
      const res = await fetch("/api/auction/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Action failed.");
      }

      setActionMessage({ text: `Action "${action}" succeeded!`, type: "success" });
      refreshAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error executing admin action";
      setActionMessage({ text: msg, type: "error" });
    } finally {
      setIsPerformingAction(false);
    }
  };

  const timeFormatted = formatMinSec(secondsLeft);
  const isOpen = activeSlot?.status === "open";
  const isPending = activeSlot?.status === "pending";
  const isPaused = auctionStatus === "PAUSED";
  const isCompleted = auctionStatus === "COMPLETED";

  return (
    <div className="min-h-screen bg-[#111215] text-zinc-100 flex flex-col font-sans selection:bg-[#fe5102] selection:text-white">
      {/* ─────────────────────────────────────────────────────────────
          ADMIN HEADER
         ───────────────────────────────────────────────────────────── */}
      <header className="w-full bg-[#18191d] border-b border-zinc-800 px-4 sm:px-8 py-3.5 select-none">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <B2BLogo variant="light" height={28} />
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-red-950/80 border border-red-500/40 text-red-300 font-bold uppercase tracking-wider">
              Admin Controller
            </span>
          </div>

          <div className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-medium text-zinc-300">
            <button
              type="button"
              onClick={() => setIsRulesOpen(true)}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Contest Rules
            </button>

            <Link href="/admin" className="hover:text-white transition-colors">
              Dashboard
            </Link>

            <Link href="/admin/settings" className="hover:text-white transition-colors">
              Settings
            </Link>

            <Link href="/admin/registration" className="hover:text-white transition-colors">
              Teams
            </Link>

            <Link
              href="/admin/auction?view=console"
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition-colors border border-white/10 text-xs"
            >
              Management Console
            </Link>

            <Link href="/auction" className="text-[#fe5102] hover:underline font-bold">
              View Participant Arena
            </Link>

            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              className="hover:text-red-400 transition-colors cursor-pointer"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Action Message Toast */}
        {actionMessage && (
          <div
            className={`p-3 rounded-xl border text-xs sm:text-sm font-semibold flex items-center justify-between ${
              actionMessage.type === "success"
                ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                : "bg-red-950/60 border-red-500/40 text-red-300"
            }`}
          >
            <span>{actionMessage.text}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-xs opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            B. AUCTION STATUS OVERVIEW (KPI CARDS)
           ───────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Status */}
          <div className="bg-[#1c1d22] border border-zinc-800 rounded-2xl p-4 shadow-lg">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Auction Status
            </span>
            <div className="flex items-center gap-1.5 mt-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  auctionStatus === "LIVE"
                    ? "bg-emerald-400 animate-pulse"
                    : auctionStatus === "PAUSED"
                    ? "bg-amber-400"
                    : "bg-zinc-400"
                }`}
              />
              <span className="text-base sm:text-lg font-black text-white">
                {auctionStatus}
              </span>
            </div>
          </div>

          {/* Current Slot */}
          <div className="bg-[#1c1d22] border border-zinc-800 rounded-2xl p-4 shadow-lg">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Current Slot
            </span>
            <div className="text-base sm:text-lg font-black text-white mt-1">
              {activeSlotIndex} of {totalSlots}
            </div>
            <span className="text-[11px] text-zinc-500">
              Round {activeSlot?.round ?? 1}
            </span>
          </div>

          {/* Highest Bid */}
          <div className="bg-[#1c1d22] border border-zinc-800 rounded-2xl p-4 shadow-lg">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Highest Bid
            </span>
            <div className="text-base sm:text-lg font-black text-[#fe5102] font-mono mt-1">
              {activeSlot?.current_bid ?? 0} coins
            </div>
          </div>

          {/* Leading Team */}
          <div className="bg-[#1c1d22] border border-zinc-800 rounded-2xl p-4 shadow-lg">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Leading Team
            </span>
            <div className="text-sm sm:text-base font-bold text-white mt-1 truncate">
              {activeSlot?.leader_team?.name || "None"}
            </div>
          </div>

          {/* Participating Teams */}
          <div className="bg-[#1c1d22] border border-zinc-800 rounded-2xl p-4 shadow-lg">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Participating Teams
            </span>
            <div className="text-base sm:text-lg font-black text-white mt-1">
              {leaderboardTeams.length}
            </div>
          </div>

          {/* Live Countdown */}
          <div className="bg-[#fef3c7] border border-amber-300 rounded-2xl p-4 shadow-lg text-center">
            <span className="text-[10px] font-bold text-[#92400e] uppercase tracking-wider block">
              Auction Countdown
            </span>
            <div className="text-lg sm:text-xl font-black text-[#78350f] font-mono mt-1">
              {isOpen ? timeFormatted : "Closed"}
            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            C. ADMIN CONTROLS (Context-Aware Control Bar)
           ───────────────────────────────────────────────────────────── */}
        <div className="bg-[#1a1b1f] border border-zinc-800 rounded-2xl p-5 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Gavel className="w-5 h-5 text-[#fe5102]" />
                Tournament Control Console
              </h3>
              <p className="text-xs text-zinc-400">
                Authoritative backend controls for opening, pausing, and finalizing slots.
              </p>
            </div>

            {/* Quick Slot Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 font-medium">Select Slot:</span>
              <select
                value={activeSlot?.id || ""}
                onChange={(e) => {
                  const sel = allSlots.find((s) => s.id === e.target.value);
                  if (sel) {
                    setActiveSlot(sel);
                    setActiveSlotIndex(allSlots.findIndex((s) => s.id === sel.id) + 1);
                  }
                }}
                className="bg-zinc-800 border border-zinc-700 text-xs rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-[#fe5102]"
              >
                {allSlots.map((s, idx) => (
                  <option key={s.id} value={s.id}>
                    Slot {idx + 1} ({s.status.toUpperCase()}) - {s.topic?.title || "Problem"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Buttons Row */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* UPCOMING STATE: START AUCTION */}
            {auctionStatus === "UPCOMING" && (
              <button
                type="button"
                disabled={isPerformingAction}
                onClick={() => handleAdminAction("open_slot")}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                Start Tournament (Open Slot 1)
              </button>
            )}

            {/* OPEN / PENDING SLOT: OPEN SLOT BUTTON */}
            {isPending && (
              <button
                type="button"
                disabled={isPerformingAction}
                onClick={() => handleAdminAction("open_slot", { slotId: activeSlot?.id })}
                className="px-5 py-2.5 rounded-xl bg-[#fe5102] hover:bg-[#e64d00] text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                Open Slot {activeSlotIndex} ({settings.opening_window_seconds}s)
              </button>
            )}

            {/* LIVE STATE: PAUSE / RESUME */}
            {isOpen && (
              <button
                type="button"
                disabled={isPerformingAction}
                onClick={() => handleAdminAction("pause_auction")}
                className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                <Pause className="w-4 h-4" />
                Pause Auction
              </button>
            )}

            {isPaused && (
              <button
                type="button"
                disabled={isPerformingAction}
                onClick={() => handleAdminAction("resume_auction")}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                Resume Auction
              </button>
            )}

            {/* CLOSE CURRENT SLOT (SOLD OR UNSOLD) */}
            {(isOpen || isPaused) && (
              <button
                type="button"
                disabled={isPerformingAction}
                onClick={() => handleAdminAction("close_slot", { slotId: activeSlot?.id })}
                className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                Close Current Slot (Award / Skip)
              </button>
            )}

            {/* SKIP SLOT */}
            {(isOpen || isPending || isPaused) && (
              <button
                type="button"
                disabled={isPerformingAction}
                onClick={() => handleAdminAction("skip_slot", { slotId: activeSlot?.id })}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs flex items-center gap-2 border border-zinc-700 transition-all cursor-pointer disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                Skip Slot
              </button>
            )}

            {/* EXTEND TIMER (+15s) */}
            {isOpen && (
              <button
                type="button"
                disabled={isPerformingAction}
                onClick={() => handleAdminAction("extend_timer", { extraSeconds: 15 })}
                className="px-3.5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-bold text-xs flex items-center gap-1.5 border border-amber-500/30 transition-all cursor-pointer disabled:opacity-50"
              >
                <Clock className="w-3.5 h-3.5" />
                +15s Timer
              </button>
            )}

            {/* NEXT SLOT */}
            <button
              type="button"
              disabled={isPerformingAction}
              onClick={() => handleAdminAction("next_slot")}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50 ml-auto"
            >
              <SkipForward className="w-4 h-4" />
              Next Slot
            </button>

            {/* RESET TOURNAMENT (DANGEROUS) */}
            <button
              type="button"
              disabled={isPerformingAction}
              onClick={() => {
                if (confirm("Are you sure you want to reset all auction slots and wallets back to initial state?")) {
                  handleAdminAction("reset_auction");
                }
              }}
              className="px-3 py-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/80 border border-red-500/40 text-red-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            D. LIVE LEADERBOARD (ADMIN VIEW)
           ───────────────────────────────────────────────────────────── */}
        <div className="bg-[#1a1b1f] border border-zinc-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-400" />
              Live Tournament Leaderboard
            </h3>
            <span className="text-xs text-zinc-400">
              Ranked descending by current active bid
            </span>
          </div>

          <LiveLeaderboardGrid
            teams={leaderboardTeams}
            currentTeamId={null}
            loading={false}
          />
        </div>

        {/* ─────────────────────────────────────────────────────────────
            E. PERSISTED AUCTION RESULTS TABLE
           ───────────────────────────────────────────────────────────── */}
        <div className="bg-[#1a1b1f] border border-zinc-800 rounded-2xl p-5 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              Persisted Auction Results History
            </h3>
            <span className="text-xs text-zinc-400">
              {historyResults.length} Slots Concluded
            </span>
          </div>

          {historyResults.length === 0 ? (
            <div className="p-8 text-center text-zinc-400 text-xs italic bg-zinc-900/50 rounded-xl border border-zinc-800/80">
              No slots have been concluded yet. Completed slots will appear here with winning bid and deducted coins.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900/90 text-zinc-400 text-[10px] uppercase font-bold tracking-wider border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Slot #</th>
                    <th className="py-3 px-4">Round</th>
                    <th className="py-3 px-4">Problem Statement</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Winning Team</th>
                    <th className="py-3 px-4">Winning Bid</th>
                    <th className="py-3 px-4">Coins Deducted</th>
                    <th className="py-3 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-medium">
                  {historyResults.map((item, idx) => {
                    const isSold = item.status === "sold";
                    const itemMascot = getMascotSrc(item.winnerTeam?.id || item.winnerTeam?.name);
                    return (
                      <tr key={item.slotId || idx} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-white">
                          #{item.slotNumber}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300">
                            Round {item.round}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-white truncate max-w-xs">
                          {item.topicTitle}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isSold
                                ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {isSold ? "SOLD" : "UNSOLD"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {isSold && item.winnerTeam ? (
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-white/20 p-0.5 overflow-hidden shrink-0">
                                <Image
                                  src={itemMascot}
                                  alt={item.winnerTeam.name}
                                  width={20}
                                  height={20}
                                  className="object-contain"
                                />
                              </div>
                              <span className="font-bold text-white">
                                {item.winnerTeam.name}
                              </span>
                            </div>
                          ) : (
                            <span className="text-zinc-500 italic">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-[#fe5102]">
                          {isSold ? `${item.winningBid} coins` : "—"}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-zinc-300">
                          {isSold ? `-${item.coinsDeducted} coins` : "0"}
                        </td>
                        <td className="py-3 px-4 text-zinc-500 text-[11px] font-mono">
                          {item.endTime ? new Date(item.endTime).toLocaleTimeString() : "Just now"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Rules Modal */}
      <ContestRulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
      />

      {/* Sold / Unsold Modal Popup */}
      <AuctionSoldModal
        result={lastSoldResult}
        onClose={() => setLastSoldResult(null)}
      />
    </div>
  );
}
