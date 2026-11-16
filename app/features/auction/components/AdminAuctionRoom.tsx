"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Loader2, RotateCcw, Trophy, Users } from "lucide-react";
import { ContestRulesModal } from "./ContestRulesModal";
import { LiveLeaderboardGrid } from "./LiveLeaderboardGrid";
import { AuctionSoldModal, type SoldResultData } from "./AuctionSoldModal";
import { formatMinSec } from "../utils/countdown";
import { useAdminAuth } from "@/features/admin/hooks/useAdminAuth";
import { useAuction } from "../hooks/useAuction";
import { useAuctionTimer } from "../hooks/useAuctionTimer";
import { useAdminAuctionActions } from "@/features/admin/hooks/useAdminAuctionActions";
import { AuctionControlPanel } from "@/features/admin/components/auction/AuctionControlPanel";
import { AuctionTimerControl } from "@/features/admin/components/auction/AuctionTimerControl";
import { TeamEliminationControl } from "@/features/admin/components/auction/TeamEliminationControl";
import { BonusApproval } from "@/features/admin/components/auction/BonusApproval";
import { fetchAllSlotsWithDetails } from "@/features/admin/services/auctionAdminService";
import { B2BLogo } from "@/components/shared/B2BLogo";

/**
 * Admin auction arena.
 *
 * The admin sees the same authoritative state as the participants and
 * controls the contest through the engine functions. Nothing here
 * writes to a table directly.
 */
export function AdminAuctionRoom() {
  const router = useRouter();
  const { signOut } = useAdminAuth();

  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [soldResult, setSoldResult] = useState<SoldResultData | null>(null);
  const [pendingSlots, setPendingSlots] = useState<
    Array<{ id: string; title: string; round: number }>
  >([]);

  const { state, connection, loading, error, refresh } = useAuction();

  const activeSlot = state.active_slot;
  const session = state.session;

  const biddingCountdown = useAuctionTimer({
    endTime: activeSlot?.end_time ?? null,
    serverTime: state.server_time,
    running: activeSlot?.status === "open",
    paused: activeSlot?.timer_status === "paused",
    pausedRemainingSeconds: activeSlot?.paused_remaining_seconds ?? 0,
    onExpire: () => void refresh(),
  });

  const solvingCountdown = useAuctionTimer({
    endTime: session?.timer_ends_at ?? null,
    serverTime: state.server_time,
    running: session?.timer_status === "running",
    paused: session?.timer_status === "paused",
    pausedRemainingSeconds: session?.paused_remaining_seconds ?? 0,
  });

  const loadPendingSlots = useCallback(async () => {
    const result = await fetchAllSlotsWithDetails();
    if (!result.success || !result.data) return;
    setPendingSlots(
      result.data
        .filter((slot) => slot.status === "pending")
        .map((slot) => ({
          id: slot.id,
          title: slot.topic?.title ?? "Problem",
          round: slot.round,
        }))
    );
  }, []);

  useEffect(() => {
    void loadPendingSlots();
  }, [loadPendingSlots, state.active_slot, state.events]);

  const actions = useAdminAuctionActions({
    onRefresh: () => {
      void refresh();
      void loadPendingSlots();
    },
    activeSlotId: activeSlot?.id ?? null,
  });

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

  const eliminationTeams = useMemo(
    () =>
      teams.map((team) => {
        const elimination = state.eliminations.find((el) => el.team_id === team.id);
        return {
          id: team.id,
          name: team.name,
          eliminated: Boolean(team.eliminated),
          reason: elimination?.reason,
          eliminated_at: elimination?.eliminated_at,
        };
      }),
    [teams, state.eliminations]
  );

  useEffect(() => {
    if (!activeSlot) return;
    if (activeSlot.status !== "sold" && activeSlot.status !== "skipped") return;
    setSoldResult({
      slotNumber: activeSlot.question_number ?? 0,
      status: activeSlot.status,
      topicTitle: activeSlot.topic?.title,
      winnerTeamName: activeSlot.winner_team_name ?? activeSlot.leader_team_name ?? undefined,
      winnerTeamId: activeSlot.winner_team_id ?? activeSlot.leader_team_id ?? undefined,
      winningBid: activeSlot.current_bid,
    });
  }, [activeSlot]);

  const isLive = activeSlot?.status === "open";
  const isPaused = Boolean(session?.is_paused);

  return (
    <div className="min-h-screen bg-[#111215] text-zinc-100 flex flex-col font-sans selection:bg-[#fe5100] selection:text-white">
      <header className="w-full bg-[#18191d] border-b border-zinc-800 px-4 sm:px-8 py-3.5 select-none">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <B2BLogo variant="light" height={28} />
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-red-950/80 border border-red-500/40 text-red-300 font-bold uppercase tracking-wider">
              Admin Controller
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${
                connection === "connected" ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {connection}
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
              href="/projector/auction"
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition-colors border border-white/10 text-xs"
            >
              Projector
            </Link>
            <Link href="/auction" className="text-[#fe5102] hover:underline font-bold">
              Participant Arena
            </Link>
            <button
              type="button"
              onClick={() => {
                void signOut();
                router.push("/login");
              }}
              className="hover:text-red-400 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" /> Log out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="p-4 rounded-xl border border-red-500/40 bg-red-950/40 text-xs text-red-300">
            {error}
          </div>
        )}

        {actions.feedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
              actions.feedback.type === "success"
                ? "bg-emerald-950/50 border-emerald-500/40 text-emerald-300"
                : "bg-red-950/50 border-red-500/40 text-red-300"
            }`}
          >
            <span>{actions.feedback.message}</span>
            <button type="button" onClick={actions.clearFeedback} className="opacity-70 hover:opacity-100">
              &times;
            </button>
          </div>
        )}

        {/* ── KPI strip ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            {
              label: "Auction Status",
              value: isPaused ? "PAUSED" : isLive ? "LIVE" : (session?.status ?? "IDLE").toUpperCase(),
              accent: isLive ? "text-emerald-400" : "text-zinc-300",
            },
            {
              label: "Current Item",
              value: activeSlot?.question_number ? `#${activeSlot.question_number}` : "—",
              accent: "text-white",
            },
            {
              label: "Highest Bid",
              value: `${activeSlot?.current_bid ?? 0} pts`,
              accent: "text-[#fe5102]",
            },
            {
              label: "Leading Team",
              value: activeSlot?.leader_team_name ?? "None",
              accent: "text-white",
            },
            {
              label: "Teams",
              value: String(teams.length),
              accent: "text-white",
            },
            {
              label: "Bidding Clock",
              value: activeSlot?.status === "open" ? formatMinSec(biddingCountdown.secondsLeft) : "Closed",
              accent: "text-amber-600",
            },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-[#1c1d22] border border-zinc-800 rounded-2xl p-4 shadow-lg">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                {kpi.label}
              </span>
              <div className={`text-base sm:text-lg font-black mt-1 truncate ${kpi.accent}`}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading the authoritative state...
          </div>
        )}

        <AuctionControlPanel
          sessionStatus={session?.status ?? null}
          sessionPaused={isPaused}
          activeSlotId={activeSlot?.id ?? null}
          activeSlotTitle={activeSlot?.topic?.title ?? null}
          pendingSlots={pendingSlots}
          pending={actions.pending}
          onStart={() => void actions.start()}
          onSelect={(slotId) => void actions.selectQuestion(slotId)}
          onOpenBidding={() => void actions.openBidding()}
          onCloseBidding={() => void actions.closeBidding()}
          onFinalize={() => void actions.finalize()}
          onAdvance={() => void actions.advance()}
          onSkip={(slotId) => void actions.skip(slotId)}
          onPause={() => void actions.pause()}
          onResume={() => void actions.resume()}
          onEnd={() => void actions.end()}
          onReset={() => void actions.reset()}
        />

        <AuctionTimerControl
          biddingSecondsLeft={biddingCountdown.secondsLeft}
          solvingSecondsLeft={solvingCountdown.secondsLeft}
          biddingTimerStatus={activeSlot?.timer_status ?? "idle"}
          solvingTimerStatus={session?.timer_status ?? "idle"}
          pausedRemainingSeconds={activeSlot?.paused_remaining_seconds ?? 0}
          pending={actions.pending}
          onExtendBidding={(seconds) => void actions.extendBidding(seconds)}
          onExtendSolving={(seconds) => void actions.extendSolving(seconds)}
          onStartTimer={() => void actions.startTimer()}
          onPauseTimer={() => void actions.pauseTimer()}
          onResumeTimer={() => void actions.resumeTimer()}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TeamEliminationControl
            teams={eliminationTeams}
            pending={actions.pending}
            onEliminate={(teamId, reason) => void actions.eliminate(teamId, reason)}
            onRestore={(teamId) => void actions.restore(teamId)}
          />
          <BonusApproval
            pending={actions.pending}
            onApprove={(submissionId, score, notes, grantBonus) =>
              void actions.approve(submissionId, score, notes, grantBonus)
            }
          />
        </div>

        <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-emerald-400" /> Live leaderboard
          </h3>
          <LiveLeaderboardGrid teams={teams} currentTeamId={null} loading={loading} />
        </div>

        <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
            <Trophy className="w-5 h-5 text-amber-400" /> Recent events
          </h3>
          {state.events.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">No auction events yet.</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {state.events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between gap-3 text-[11px] text-zinc-400 border-b border-zinc-800/50 py-1"
                >
                  <span className="font-mono text-zinc-300">{event.event_type}</span>
                  <span className="truncate">
                    {String(
                      (event.payload as Record<string, unknown>).team_name ??
                        (event.payload as Record<string, unknown>).topic_title ??
                        ""
                    )}
                  </span>
                  <span className="font-mono text-zinc-600">
                    {new Date(event.server_timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 bg-white/5 text-xs font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            Sync state
          </button>
        </div>
      </main>

      <ContestRulesModal isOpen={isRulesOpen} onClose={() => setIsRulesOpen(false)} />

      <AuctionSoldModal
        result={soldResult}
        onClose={() => setSoldResult(null)}
      />
    </div>
  );
}
