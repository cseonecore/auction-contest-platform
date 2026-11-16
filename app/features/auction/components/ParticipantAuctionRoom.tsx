"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { ParticipantAuctionHeader } from "./ParticipantAuctionHeader";
import { ParticipantBiddingPanel } from "./ParticipantBiddingPanel";
import { LiveLeaderboardGrid } from "./LiveLeaderboardGrid";
import { AuctionSoldModal, SoldResultData } from "./AuctionSoldModal";
import { formatMinSec, calculateCountdown } from "../utils/countdown";
import { getMascotSrc } from "../utils/mascot";
import { supabase } from "@/lib/supabase";

interface CurrentTeam {
  id: string;
  name: string;
  balance: number;
  assignedCount: number;
  isCaptain: boolean;
  characterIndex: number;
}

interface ActiveSlot {
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
    criterion?: any;
  } | null;
  leader_team?: {
    id: string;
    name: string;
  } | null;
  winner_team?: {
    id: string;
    name: string;
  } | null;
}

interface HistoryItem {
  slotId: string;
  slotNumber: number;
  status: "sold" | "skipped";
  topicTitle: string;
  winnerTeam?: { id: string; name: string } | null;
  winningBid: number;
  round: number;
}

export function ParticipantAuctionRoom() {
  const router = useRouter();

  // Current user's team state — null until resolved
  const [currentTeam, setCurrentTeam] = useState<CurrentTeam | null>(null);
  const [teamLoading, setTeamLoading] = useState(true);

  // Auction State
  const [auctionStatus, setAuctionStatus] = useState<"LIVE" | "UPCOMING" | "PAUSED" | "COMPLETED">("LIVE");
  const [activeSlot, setActiveSlot] = useState<ActiveSlot | null>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(3);
  const [totalSlots, setTotalSlots] = useState<number>(40);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [leaderboardTeams, setLeaderboardTeams] = useState<any[]>([]);
  const [settings, setSettings] = useState({
    min_bid: 10,
    min_raise: 10,
    opening_window_seconds: 10,
    timer_extension_seconds: 5,
  });

  // Timer & Countdown
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Connection & UI states
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "reconnecting" | "offline">("connected");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastSoldResult, setLastSoldResult] = useState<SoldResultData | null>(null);

  // Reference to prevent duplicate popups
  const lastAnnouncedSlotIdRef = useRef<string | null>(null);

  // 1. Resolve logged-in participant's team
  const resolveTeam = useCallback(async () => {
    setTeamLoading(true);
    try {
      let storedTeam: { id?: string; name?: string } | null = null;
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem("b2b_logged_in_team");
        if (raw) {
          try {
            storedTeam = JSON.parse(raw);
          } catch {
            // ignore
          }
        }
      }

      if (!storedTeam?.id && !storedTeam?.name) {
        // Direct / preview access without login: default to preview participant team
        setCurrentTeam({
          id: "32254098-4572-472d-b75e-1dc51ebcb273",
          name: "Team Alpha (Preview)",
          balance: 100,
          assignedCount: 0,
          isCaptain: true,
          characterIndex: 1,
        });
        return;
      }

      const idParam = storedTeam.id
        ? `id=${storedTeam.id}`
        : `name=${encodeURIComponent(storedTeam.name!)}`;
      const res = await fetch(`/api/team/profile?${idParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data.team) {
          setCurrentTeam({
            id: data.team.id,
            name: data.team.name,
            balance: data.team.balance ?? 100,
            assignedCount: data.team.assignedProblems?.length ?? 0,
            isCaptain: true,
            characterIndex: 1,
          });
          return;
        }
      }

      // If profile fetch fails, use fallback preview team instead of bouncing to login
      setCurrentTeam({
        id: storedTeam.id || "32254098-4572-472d-b75e-1dc51ebcb273",
        name: storedTeam.name || "Team Alpha (Preview)",
        balance: 100,
        assignedCount: 0,
        isCaptain: true,
        characterIndex: 1,
      });
    } catch (err) {
      console.warn("[Participant Auction] Team resolution error:", err);
      // Fallback preview team
      setCurrentTeam({
        id: "32254098-4572-472d-b75e-1dc51ebcb273",
        name: "Team Alpha (Preview)",
        balance: 100,
        assignedCount: 0,
        isCaptain: true,
        characterIndex: 1,
      });
    } finally {
      setTeamLoading(false);
    }
  }, []);

  // 2. Fetch Authoritative Auction State
  const fetchAuctionState = useCallback(async () => {
    try {
      const res = await fetch("/api/auction/state", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch state");
      const data = await res.json();

      if (data.success) {
        setAuctionStatus(data.auctionStatus);
        setTotalSlots(data.totalSlots || 40);
        setActiveSlotIndex(data.activeSlotIndex || 3);
        setSettings(data.settings);
        setHistory(data.history || []);

        const slot = data.activeSlot as ActiveSlot | null;
        setActiveSlot(slot);

        // Check if a slot was just sold or skipped to trigger announcement
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

        setConnectionStatus("connected");
      }
    } catch {
      setConnectionStatus("reconnecting");
    } finally {
      setLoading(false);
    }
  }, []);

  // 3. Fetch Leaderboard for Active Slot
  const fetchLeaderboard = useCallback(async (slotId?: string | null) => {
    try {
      const param = slotId ? `?slotId=${slotId}` : "";
      const res = await fetch(`/api/auction/teams${param}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.teams) {
          setLeaderboardTeams(data.teams);

          // Update current team's balance if in list
          if (currentTeam?.id) {
            const match = data.teams.find((t: any) => t.id === currentTeam?.id);
            if (match && typeof match.balance === "number") {
              setCurrentTeam((prev) => (prev ? {
                ...prev,
                balance: match.balance,
              } : null));
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }, [currentTeam]);

  // Master refresh
  const refreshAll = useCallback(() => {
    fetchAuctionState();
    fetchLeaderboard(activeSlot?.id);
  }, [fetchAuctionState, fetchLeaderboard, activeSlot?.id]);

  // Initial load
  useEffect(() => {
    resolveTeam();
    fetchAuctionState();
  }, [resolveTeam, fetchAuctionState]);

  // Sync leaderboard when active slot changes
  useEffect(() => {
    fetchLeaderboard(activeSlot?.id);
  }, [activeSlot?.id, fetchLeaderboard]);

  // 4. Timer Countdown Interval Loop
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    if (!activeSlot || activeSlot.status !== "open" || !activeSlot.end_time) {
      if (activeSlot && activeSlot.status === "open") {
        setSecondsLeft(84); // 1m 24s fallback
      }
      return;
    }

    const tick = () => {
      const countdown = calculateCountdown(activeSlot.end_time);
      setSecondsLeft(countdown.secondsLeft);

      if (countdown.isExpired) {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        // Refresh authoritative state on expiration
        fetchAuctionState();
      }
    };

    tick();
    timerIntervalRef.current = setInterval(tick, 250);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [activeSlot?.end_time, activeSlot?.status, fetchAuctionState]);

  // 5. Supabase Realtime Subscriptions & Polling Fallback
  useEffect(() => {
    const channel = supabase
      .channel("public-auction-room")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slots" },
        () => {
          refreshAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bids" },
        () => {
          refreshAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wallets" },
        () => {
          refreshAll();
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
        } else if (status === "CHANNEL_ERROR") {
          setConnectionStatus("reconnecting");
        }
      });

    // 2-second heartbeat polling fallback for bulletproof synchronization
    const heartbeat = setInterval(() => {
      fetchAuctionState();
      fetchLeaderboard(activeSlot?.id);
    }, 2000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(heartbeat);
    };
  }, [refreshAll, activeSlot?.id, fetchAuctionState, fetchLeaderboard]);

  // Handle Bid Placement
  const handlePlaceBid = async (amount: number): Promise<{ success: boolean; error?: string }> => {
    if (!activeSlot || !currentTeam) return { success: false, error: "No active slot or not logged in." };

    try {
      const res = await fetch("/api/auction/bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotId: activeSlot.id,
          amount,
          teamId: currentTeam.id,
          teamName: currentTeam.name,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || "Failed to place bid" };
      }

      // Optimistically update wallet and slot
      setCurrentTeam((prev) => (prev ? {
        ...prev,
        balance: data.data?.wallet_balance ?? prev.balance,
      } : null));

      // Immediate refresh
      refreshAll();
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      return { success: false, error: msg };
    }
  };

  if (teamLoading || !currentTeam) {
    return (
      <div className="min-h-screen bg-[#111215] text-zinc-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#fe5102]" />
          <p className="text-xs text-zinc-400">Loading auction room...</p>
        </div>
      </div>
    );
  }

  const currentMascotSrc = getMascotSrc(currentTeam.id, currentTeam.characterIndex);
  const timeFormatted = formatMinSec(secondsLeft);
  const isLeader = activeSlot?.leader_team_id === currentTeam.id;

  return (
    <div className="min-h-screen bg-[#111215] text-zinc-100 flex flex-col font-sans selection:bg-[#ff5500] selection:text-white">
      {/* 1. Top Header */}
      <ParticipantAuctionHeader connectionStatus={connectionStatus} />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ─────────────────────────────────────────────────────────────
              LEFT PANEL (Col 1 to 5) - Strictly Matching Figma Screenshot 3
             ───────────────────────────────────────────────────────────── */}
          <div className="lg:col-span-5 space-y-5">
            {/* Auction Status Pill */}
            <div className="flex items-center gap-2 text-sm text-zinc-400 font-medium">
              <span>Auction Status</span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5 ${
                  auctionStatus === "LIVE"
                    ? "bg-[#064e3b]/80 border border-emerald-500/40 text-emerald-300"
                    : auctionStatus === "PAUSED"
                    ? "bg-amber-950/80 border border-amber-500/40 text-amber-300"
                    : "bg-zinc-800 border border-zinc-700 text-zinc-400"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    auctionStatus === "LIVE"
                      ? "bg-emerald-400 animate-pulse"
                      : auctionStatus === "PAUSED"
                      ? "bg-amber-400"
                      : "bg-zinc-400"
                  }`}
                />
                <span className="capitalize">• {auctionStatus.toLowerCase()}</span>
              </span>
            </div>

            {/* Current Team Profile Card & Small Countdown Box (Matching Figma Image 3) */}
            <div className="flex items-center gap-3">
              {/* Team Profile Box */}
              <div className="flex-1 bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-3 sm:p-4 flex items-center gap-3 shadow-xl">
                {/* Mascot Avatar */}
                <div className="w-13 h-13 rounded-full bg-orange-500/20 border border-orange-500/40 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                  <Image
                    src={currentMascotSrc}
                    alt={currentTeam.name}
                    width={46}
                    height={46}
                    className="object-contain"
                  />
                </div>

                {/* Team Info & Badges */}
                <div className="overflow-hidden">
                  <div className="text-white font-bold text-base sm:text-lg flex items-center gap-1.5 truncate">
                    <span>{currentTeam.name}</span>
                    <span className="w-4 h-4 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px] font-black shrink-0">
                      ✓
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="bg-[#d1fae5] text-[#065f46] text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full leading-tight">
                      Coin Balance : {currentTeam.balance}
                    </span>
                    <span className="bg-[#ffedd5] text-[#9a3412] text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full leading-tight">
                      Problem Assigned : {currentTeam.assignedCount}
                    </span>
                  </div>
                </div>
              </div>

              {/* Small "Auction Ends In" Box (Right beside Team Info in Screenshot 3) */}
              <div className="bg-[#fef3c7] border border-amber-300 rounded-2xl p-2.5 sm:p-3.5 text-center shadow-md min-w-[130px] sm:min-w-[150px] shrink-0">
                <div className="text-[#92400e] text-[10px] sm:text-xs font-bold tracking-wide">
                  Auction Ends In
                </div>
                <div className="text-[#78350f] font-black text-base sm:text-xl font-mono tracking-tight mt-0.5">
                  {timeFormatted}
                </div>
              </div>
            </div>

            {/* Slot Results History (Real-Time Slot Results matching Screenshot 3) */}
            <div className="space-y-1.5 text-xs text-zinc-300 pl-1">
              {history.length === 0 ? (
                <div className="text-[11px] text-zinc-500 italic py-1">
                  Slot results will appear here in real time as problems are sold or passed.
                </div>
              ) : (
                history.slice(0, 4).map((item) => {
                  const isSold = item.status === "sold";
                  const itemMascot = getMascotSrc(item.winnerTeam?.id || item.winnerTeam?.name);
                  return (
                    <div key={item.slotId} className="flex items-center gap-2 truncate">
                      <span>Problem {item.slotNumber}</span>
                      <span className={isSold ? "text-emerald-400 font-semibold" : "text-zinc-500"}>
                        {isSold ? "sold to" : "unsold"}
                      </span>
                      {isSold && item.winnerTeam && (
                        <div className="inline-flex items-center gap-1.5 bg-[#15803d] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                          <div className="w-3.5 h-3.5 rounded-full overflow-hidden shrink-0">
                            <Image
                              src={itemMascot}
                              alt={item.winnerTeam.name}
                              width={14}
                              height={14}
                              className="object-contain"
                            />
                          </div>
                          <span className="truncate max-w-[80px]">{item.winnerTeam.name}</span>
                          <span className="font-mono">{item.winningBid}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Bidding Controls (The 4 Large Interactive Square Buttons) */}
            <div className="pt-2">
              <ParticipantBiddingPanel
                slotId={activeSlot?.id ?? null}
                slotStatus={activeSlot?.status ?? "pending"}
                currentBid={activeSlot?.current_bid ?? 0}
                leadingTeamName={activeSlot?.leader_team?.name ?? null}
                isLeader={isLeader}
                walletBalance={currentTeam.balance}
                hasWonRound={false}
                minBid={settings.min_bid}
                minRaise={settings.min_raise}
                onBidSubmit={handlePlaceBid}
              />
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────────
              RIGHT PANEL (Col 6 to 12) - Problem Statement + Leaderboard
             ───────────────────────────────────────────────────────────── */}
          <div className="lg:col-span-7 space-y-4">
            {/* Problem Statement Card matching Figma Image 1 & 3 */}
            <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 sm:p-6 shadow-xl relative select-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    {activeSlot?.topic?.title
                      ? `Problem Statement ${activeSlotIndex}: ${activeSlot.topic.title}`
                      : `Problem Statment${activeSlotIndex}`}
                  </h2>
                  <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-1.5">
                    {activeSlot?.topic?.level ? `Level: ${activeSlot.topic.level} Topic` : "Problem statement"}
                  </div>
                </div>

                {/* 3/40 Pill Badge on top-right */}
                <div className="bg-[#bfdbfe] text-[#1e40af] text-xs sm:text-sm font-black px-3 py-1 rounded-full shrink-0 shadow-sm">
                  {activeSlotIndex}/{totalSlots}
                </div>
              </div>

              {/* Description Body */}
              <p className="text-xs sm:text-sm text-zinc-300 mt-2.5 leading-relaxed">
                {activeSlot?.topic?.description || "Description in detail"}
              </p>

              {activeSlot?.topic?.criterion && (
                <div className="mt-3 text-[11px] text-zinc-400 border-t border-zinc-800/80 pt-2">
                  <span className="font-semibold text-zinc-300">Evaluation Criteria: </span>
                  {typeof activeSlot.topic.criterion === "object"
                    ? JSON.stringify(activeSlot.topic.criterion)
                    : activeSlot.topic.criterion}
                </div>
              )}
            </div>

            {/* Prominent Wide Countdown Banner (Matching Figma Image 1) */}
            <div className="w-full bg-[#fef08a] border border-amber-300 rounded-2xl py-3 px-6 text-center shadow-lg">
              <div className="text-[#78350f] font-black text-3xl sm:text-4xl font-mono tracking-tight">
                {timeFormatted}
              </div>
            </div>

            {/* Live Leaderboard Grid (4 columns, colored ranking capsules) */}
            <div className="pt-2">
              <LiveLeaderboardGrid
                teams={leaderboardTeams}
                currentTeamId={currentTeam.id}
                loading={loading}
              />
            </div>
          </div>
        </div>
      </main>

      {/* SOLD TO / UNSOLD Result Announcement Popup (Image 2 & 4) */}
      <AuctionSoldModal
        result={lastSoldResult}
        onClose={() => setLastSoldResult(null)}
      />
    </div>
  );
}
