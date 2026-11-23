"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Clock, CheckCircle2, AlertTriangle, Ban, Timer } from "lucide-react";
import {
  fetchBiddingResults,
  fetchAdminSubmissions,
} from "@/features/admin/services/adminAuctionService";
import {
  fetchContestFlowState,
  getTeamDevStatuses,
} from "@/features/admin/services/contestFlowService";
import type { TeamDevStatus } from "@/types/teamDev";

/** Compact view of one team's development timer (filled from BiddingResults + per-team RPC status). */
interface TeamTimerRow {
  team_id: string;
  team_name: string;
  duration_seconds: number;
  addon_seconds: number | null;
  timer_status: string;
  remaining_seconds: number;
  window_open: boolean;
  deadline: string | null;
  opens_at: string | null;
  dq_at: string | null;
  dq_pending: boolean;
  has_submission: boolean;
  submission_status: string | null;
}

interface AdminSubmissionLite {
  team_id?: string;
  status?: string;
}

function formatTimer(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

interface TeamDevTimersPanelProps {
  /** Bump to force an immediate refresh after an admin timer/submission action. */
  refreshToken?: number;
}

export function TeamDevTimersPanel({ refreshToken = 0 }: TeamDevTimersPanelProps) {
  const [rows, setRows] = useState<TeamTimerRow[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const biddingRes = await fetchBiddingResults();
      const teamIds = (biddingRes.data ?? [])
        .map((t) => t.team_id)
        .filter((id): id is string => Boolean(id));
      const [flowRes, statuses, subsRes] = await Promise.all([
        fetchContestFlowState(),
        getTeamDevStatuses(teamIds),
        fetchAdminSubmissions(),
      ]);
      setSource(flowRes.data?.submissions_source ?? null);

      const statusMap = new Map(statuses.map((s) => [s.team_id, s]));
      const subStatusMap = new Map<string, string>();
      for (const sub of subsRes.success ? (subsRes.submissions as AdminSubmissionLite[]) : []) {
        if (sub?.team_id && sub.status) subStatusMap.set(sub.team_id, sub.status);
      }

      const mapped: TeamTimerRow[] = (biddingRes.data ?? [])
        .map((t) => {
          const st: TeamDevStatus | undefined = statusMap.get(t.team_id);
          const subStatus = subStatusMap.get(t.team_id) ?? null;
          return {
            team_id: t.team_id,
            team_name: t.team_name ?? `Team ${t.team_id.slice(0, 6)}`,
            // Prefer the authoritative per-team RPC duration (base + team
            // add-on + earned bonus) over the aggregate auction totals.
            duration_seconds: st?.dev_timer_total_seconds ?? t.total_dev_seconds ?? 0,
            addon_seconds: st?.dev_addon_seconds ?? t.total_addon_dev_seconds ?? null,
            timer_status: st?.dev_timer_status ?? "not_started",
            remaining_seconds: st?.dev_timer_remaining_seconds ?? 0,
            window_open: st?.submission_window_open ?? false,
            deadline: st?.dev_deadline ?? null,
            opens_at: st?.submission_opens_at ?? null,
            dq_at: st?.dq_at ?? null,
            dq_pending: st?.dq_pending ?? false,
            has_submission: st?.has_submission ?? Boolean(subStatus),
            submission_status: subStatus,
          };
        })
        .sort((a, b) => a.team_name.localeCompare(b.team_name));
      setRows(mapped);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team timers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(id);
  }, [load, refreshToken]);

  const timerBadge = (status: string) => {
    if (status === "running")
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Running
        </span>
      );
    if (status === "finished")
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-950/60 text-slate-300 border border-slate-700">
          Finished
        </span>
      );
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-500/30">
        Not started
      </span>
    );
  };

  const dqBadge = (row: TeamTimerRow) => {
    if (row.dq_at)
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-950/60 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1">
          <Ban className="w-2.5 h-2.5" />
          DQ (Disqualified)
        </span>
      );
    if (row.dq_pending)
      return (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5" />
          DQ Pending
        </span>
      );
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-950/40 text-slate-400 border border-slate-700/40">
        OK
      </span>
    );
  };

  const sourceBadge = (src: string | null) =>
    src === "manual" ? (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">
        Manual
      </span>
    ) : src === "auto" ? (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950/60 text-blue-300 border border-blue-500/30">
        Auto
      </span>
    ) : (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
        —
      </span>
    );

  return (
    <div className="bg-[#16171b] border border-white/10 rounded-2xl p-5 space-y-3 shadow-xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#fe5102]" />
            Per-Team Development Timers
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Each team gets its own deadline (base + add-on + earned bonus). Teams with no valid
            submission before the deadline are marked DQ.
          </p>
        </div>
        <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
          <Timer className="w-3.5 h-3.5" />
          Source: {sourceBadge(source)}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-4">
          <Clock className="w-4 h-4 animate-pulse text-[#fe5102]" />
          <span>Loading team timers...</span>
        </div>
      ) : error ? (
        <div className="p-3 rounded-xl bg-red-950/80 text-red-300 border border-red-500/30 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400 py-3">No teams recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-sans">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3 text-right">Duration</th>
                <th className="px-4 py-3 text-right">Add-on</th>
                <th className="px-4 py-3 text-center">Timer</th>
                <th className="px-4 py-3 text-right">Remaining</th>
                <th className="px-4 py-3 text-center">Submission Window</th>
                <th className="px-4 py-3">Deadline</th>
                <th className="px-4 py-3">Submission</th>
                <th className="px-4 py-3 text-center">DQ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row) => (
                <tr key={row.team_id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 font-bold text-white whitespace-nowrap">{row.team_name}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-200">
                    {formatTimer(row.duration_seconds)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-400">
                    +{row.addon_seconds != null ? formatTimer(row.addon_seconds) : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">{timerBadge(row.timer_status)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-300 whitespace-nowrap">
                    {formatTimer(row.remaining_seconds)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${
                        row.window_open
                          ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/30"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      }`}
                    >
                      {row.window_open ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Open
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                          Closed
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                    {formatWhen(row.deadline)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${
                        row.submission_status === "approved"
                          ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/40"
                          : row.submission_status === "rejected"
                          ? "bg-rose-950/60 text-rose-300 border-rose-500/40"
                          : row.submission_status
                          ? "bg-amber-950/60 text-amber-300 border-amber-500/40"
                          : "bg-slate-950/40 text-slate-400 border-slate-700/40"
                      }`}
                    >
                      {row.submission_status ?? "None"}
                    </span>
                    {row.has_submission && (
                      <div className="text-[10px] text-emerald-400/90 font-mono mt-0.5">
                        valid submission on record
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">{dqBadge(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-4 px-4 py-2 text-[10px] text-slate-500 font-sans">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Window = final 20 min before the deadline
            </span>
            <span className="flex items-center gap-1.5">
              <Ban className="w-3 h-3 text-rose-400" />
              DQ = deadline passed with no valid submission
            </span>
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              DQ Pending = deadline passed, submission arrives later
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
