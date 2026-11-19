"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  AdminHeader,
} from "@/features/admin/components/AdminHeader";
import { AdminSubnav } from "@/features/admin/components/AdminSubnav";
import { AdminAuthGuard } from "@/features/admin/components/AdminAuthGuard";
import { useAdminAuth } from "@/features/admin/hooks/useAdminAuth";
import {
  fetchAdminSubmissions,
  approveSubmission,
  rejectSubmission,
  reopenSubmission,
  fetchBonusHistory,
} from "@/features/admin/services/adminAuctionService";
import { useScoringRealtime } from "@/features/scoring/hooks/useScoringRealtime";
import {
  Award,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  AlertTriangle,
  X,
  Code2,
  Globe,
  Trophy,
  Coins,
  History,
} from "lucide-react";

interface SubmissionItem {
  id: string;
  team_id: string;
  team_name: string;
  slot_id: string;
  round: number;
  topic_title: string;
  topic_description?: string;
  repository_url: string | null;
  live_url: string | null;
  status: "submitted" | "approved" | "rejected" | string;
  submitted_at: string;
  approved_at?: string | null;
  approved_by?: string | null;
  judge_notes?: string | null;
  evaluation?: {
    score: number;
    report?: Record<string, unknown>;
    status?: string;
  } | null;
  bonus?: {
    bonus_seconds: number;
    created_at: string;
  } | null;
}

interface BonusHistoryEntry {
  id: string;
  team_name: string;
  bonus_seconds: number;
  submission_id: string;
  created_at?: string;
}

function SubmissionsDashboardContent() {
  const { user, role, signOut } = useAdminAuth();

  // Tab: 'submissions' or 'leaderboard'
  const [activeTab, setActiveTab] = useState<"submissions" | "leaderboard">("submissions");

  // Submissions State
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [bonusHistory, setBonusHistory] = useState<BonusHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "submitted" | "approved" | "rejected">("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  // Review Modal State
  const [selectedSub, setSelectedSub] = useState<SubmissionItem | null>(null);
  const [evalScore, setEvalScore] = useState<number>(0);
  const [judgeNotes, setJudgeNotes] = useState<string>("");
  const [grantBonus, setGrantBonus] = useState<boolean>(false);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalFeedback, setModalFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Scoring Realtime
  const { snapshot, loading: scoringLoading, refresh: refreshScoring } = useScoringRealtime();

  const loadData = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);
      setError(null);

      const [subRes, bonusRes] = await Promise.all([
        fetchAdminSubmissions(),
        fetchBonusHistory(),
      ]);

      if (subRes.success && subRes.submissions) {
        setSubmissions(subRes.submissions as SubmissionItem[]);
      } else {
        setError(subRes.error || "Failed to load submissions.");
      }

      if (bonusRes.success && Array.isArray(bonusRes.data)) {
        setBonusHistory(bonusRes.data as BonusHistoryEntry[]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load submissions.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Open Review Modal
  const handleOpenReview = (sub: SubmissionItem) => {
    setSelectedSub(sub);
    const existingScore = sub.evaluation?.score ?? 0;
    setEvalScore(existingScore);
    setJudgeNotes(sub.judge_notes ?? "");

    // Bonus is unchecked by default
    setGrantBonus(false);
    setModalFeedback(null);
  };

  const handleCloseReview = () => {
    if (modalBusy) return;
    setSelectedSub(null);
    setModalFeedback(null);
  };

  // Approve Submission
  const handleApprove = async () => {
    if (!selectedSub) return;
    if (selectedSub.status === "rejected") {
      setModalFeedback({
        type: "error",
        message:
          "This submission has been rejected. It must be reopened before it can be re-evaluated or approved.",
      });
      return;
    }
    if (evalScore < 0 || evalScore > 100) {
      setModalFeedback({ type: "error", message: "Score must be between 0 and 100." });
      return;
    }

    setModalBusy(true);
    setModalFeedback(null);

    const alreadyAwarded = bonusHistory.some((b) => b.submission_id === selectedSub.id);
    const shouldAward = grantBonus && !alreadyAwarded;

    const res = await approveSubmission(selectedSub.id, evalScore, judgeNotes.trim(), shouldAward);
    setModalBusy(false);

    if (res.success) {
      setModalFeedback({ type: "success", message: "Solution approved and scored successfully!" });
      void loadData(true);
      void refreshScoring();
      setTimeout(() => {
        setSelectedSub(null);
      }, 1500);
    } else {
      setModalFeedback({ type: "error", message: res.error || "Failed to approve solution." });
    }
  };

  // Reject Submission
  const handleReject = async () => {
    if (!selectedSub) return;
    if (!judgeNotes.trim()) {
      setModalFeedback({
        type: "error",
        message: "Please provide a reason in Judge Notes explaining why this submission is rejected.",
      });
      return;
    }

    setModalBusy(true);
    setModalFeedback(null);

    const res = await rejectSubmission(selectedSub.id, judgeNotes.trim());
    setModalBusy(false);

    if (res.success) {
      setModalFeedback({ type: "success", message: "Submission marked rejected." });
      void loadData(true);
      void refreshScoring();
      setTimeout(() => {
        setSelectedSub(null);
      }, 1500);
    } else {
      setModalFeedback({ type: "error", message: res.error || "Failed to reject submission." });
    }
  };

  // Reopen Submission
  const handleReopen = async () => {
    if (!selectedSub) return;
    setModalBusy(true);
    setModalFeedback(null);

    const res = await reopenSubmission(selectedSub.id, judgeNotes.trim());
    setModalBusy(false);

    if (res.success) {
      setModalFeedback({ type: "success", message: "Submission reopened for participant edits." });
      void loadData(true);
      setTimeout(() => {
        setSelectedSub(null);
      }, 1500);
    } else {
      setModalFeedback({ type: "error", message: res.error || "Failed to reopen submission." });
    }
  };

  // Filter & Sort submissions
  const filteredSubmissions = useMemo(() => {
    return submissions
      .filter((sub) => {
        if (statusFilter !== "all" && sub.status !== statusFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTeam = sub.team_name.toLowerCase().includes(q);
          const matchTopic = sub.topic_title.toLowerCase().includes(q);
          return matchTeam || matchTopic;
        }
        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.submitted_at).getTime();
        const timeB = new Date(b.submitted_at).getTime();
        return sortOrder === "newest" ? timeB - timeA : timeA - timeB;
      });
  }, [submissions, statusFilter, searchQuery, sortOrder]);

  // Ranked Leaderboard
  const rankedTeams = useMemo(() => {
    if (!snapshot?.teams) return [];
    return [...snapshot.teams]
      .map((t) => ({
        ...t,
        totalScore: t.score + t.projectedBonusPoints,
      }))
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        if (b.score !== a.score) return b.score - a.score;
        return b.remainingBudget - a.remainingBudget;
      });
  }, [snapshot]);

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white flex flex-col font-sans select-none">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Submissions & Eval"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        <AdminSubnav currentSection="submissions" />

        {/* Header & Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <span>Submissions &amp; Evaluation</span>
              <span className="text-xs font-mono font-bold bg-[#fe5102]/20 text-[#fe5102] border border-[#fe5102]/30 px-3 py-1 rounded-full">
                {submissions.length} Total
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Review code repositories, grade solutions, manage bonus time, and monitor official scores.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-[#16171b] border border-white/10 rounded-xl p-1 flex items-center">
              <button
                type="button"
                onClick={() => setActiveTab("submissions")}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  activeTab === "submissions"
                    ? "bg-[#fe5102] text-white shadow-md shadow-orange-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Submissions ({submissions.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("leaderboard")}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "leaderboard"
                    ? "bg-[#fe5102] text-white shadow-md shadow-orange-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Trophy className="w-3.5 h-3.5" />
                <span>Scores &amp; Leaderboard</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void loadData(true)}
              disabled={refreshing}
              className="p-2.5 rounded-xl border border-white/10 bg-[#16171b] text-slate-400 hover:text-white hover:border-white/20 transition-all cursor-pointer disabled:opacity-50"
              title="Refresh submissions"
              aria-label="Refresh submissions"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-[#fe5102]" : ""}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-950/80 border border-red-500/30 text-red-300 text-xs font-semibold flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 1: SUBMISSIONS MANAGEMENT                             */}
        {/* ========================================================= */}
        {activeTab === "submissions" && (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="bg-[#16171b] border border-white/10 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by team name or problem title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#111215] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-[#fe5102] transition-colors"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs text-slate-400 font-semibold">Status:</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="bg-[#111215] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#fe5102] transition-colors cursor-pointer"
                  >
                    <option value="all">All Statuses</option>
                    <option value="submitted">Submitted (In Review)</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-semibold">Sort:</span>
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as any)}
                    className="bg-[#111215] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#fe5102] transition-colors cursor-pointer"
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Submissions Table / Cards */}
            {loading ? (
              <div className="p-16 text-center bg-[#16171b] border border-white/10 rounded-2xl flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-[#fe5102]" />
                <p className="text-xs text-slate-400">Loading submissions...</p>
              </div>
            ) : filteredSubmissions.length === 0 ? (
              <div className="p-16 text-center bg-[#16171b] border border-white/10 rounded-2xl space-y-2">
                <Clock className="w-8 h-8 text-slate-500 mx-auto" />
                <h3 className="text-sm font-bold text-white">No submissions found</h3>
                <p className="text-xs text-slate-400">
                  {submissions.length === 0
                    ? "No teams have submitted solutions yet."
                    : "No submissions match your active filter or search query."}
                </p>
              </div>
            ) : (
              <div className="bg-[#16171b] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-5 py-3.5">Team</th>
                        <th className="px-5 py-3.5">Problem Statement</th>
                        <th className="px-5 py-3.5">Links</th>
                        <th className="px-5 py-3.5">Submitted</th>
                        <th className="px-5 py-3.5">Status</th>
                        <th className="px-5 py-3.5">Judge Score</th>
                        <th className="px-5 py-3.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-sans">
                      {filteredSubmissions.map((sub) => {
                        const hasBonus = bonusHistory.some((b) => b.submission_id === sub.id);
                        return (
                          <tr key={sub.id} className="hover:bg-white/5 transition-colors">
                            <td className="px-5 py-4 font-bold text-white whitespace-nowrap">
                              <div>{sub.team_name}</div>
                              <div className="text-[10px] text-slate-500 font-mono font-normal">
                                ID: {sub.team_id.slice(0, 8)}...
                              </div>
                            </td>

                            <td className="px-5 py-4 max-w-xs">
                              <div className="font-semibold text-slate-200 truncate">
                                {sub.topic_title}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                Round {sub.round}
                              </div>
                            </td>

                            <td className="px-5 py-4 whitespace-nowrap space-y-1">
                              {sub.repository_url ? (
                                <a
                                  href={sub.repository_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#fe5102] hover:underline flex items-center gap-1 font-mono text-[11px]"
                                >
                                  <Code2 className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate max-w-[160px]">
                                    {sub.repository_url.replace(/^https?:\/\//, "")}
                                  </span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              ) : (
                                <span className="text-slate-500 italic">No repo</span>
                              )}

                              {sub.live_url && (
                                <a
                                  href={sub.live_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
                                >
                                  <Globe className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate max-w-[160px]">
                                    {sub.live_url.replace(/^https?:\/\//, "")}
                                  </span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              )}
                            </td>

                            <td className="px-5 py-4 whitespace-nowrap text-slate-400 text-[11px]">
                              {new Date(sub.submitted_at).toLocaleDateString()}{" "}
                              {new Date(sub.submitted_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>

                            <td className="px-5 py-4 whitespace-nowrap">
                              <span
                                className={`text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1 ${
                                  sub.status === "approved"
                                    ? "bg-emerald-950/60 text-emerald-300 border-emerald-500/40"
                                    : sub.status === "rejected"
                                    ? "bg-rose-950/60 text-rose-300 border-rose-500/40"
                                    : "bg-amber-950/60 text-amber-300 border-amber-500/40"
                                }`}
                              >
                                {sub.status === "approved" && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                                {sub.status === "rejected" && <AlertTriangle className="w-3 h-3 text-rose-400" />}
                                {sub.status === "submitted" && <Clock className="w-3 h-3 text-amber-400" />}
                                <span>{sub.status}</span>
                              </span>
                              {hasBonus && (
                                <div className="text-[10px] text-emerald-400/90 font-mono mt-0.5">
                                  +60s bonus
                                </div>
                              )}
                            </td>

                            <td className="px-5 py-4 whitespace-nowrap font-mono text-xs">
                              {sub.evaluation ? (
                                <span className="font-bold text-white bg-white/5 px-2 py-1 rounded-md border border-white/5">
                                  {sub.evaluation.score} / 100
                                </span>
                              ) : (
                                <span className="text-slate-500 italic">Not graded</span>
                              )}
                            </td>

                            <td className="px-5 py-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleOpenReview(sub)}
                                className="px-3.5 py-1.5 rounded-lg bg-[#fe5102] hover:bg-[#d94502] text-white font-bold text-xs transition-all shadow-sm cursor-pointer"
                              >
                                {sub.status === "approved" ? "Edit Score" : "Review & Grade"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Bonus History Card */}
            {bonusHistory.length > 0 && (
              <div className="bg-[#16171b] border border-white/10 rounded-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-400" />
                  <span>Auction Bonus Time Granted ({bonusHistory.length})</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {bonusHistory.map((item) => (
                    <div
                      key={item.id}
                      className="bg-[#111215] border border-white/5 rounded-xl p-3 flex items-center justify-between text-xs font-sans"
                    >
                      <span className="font-semibold text-white truncate max-w-[150px]">
                        {item.team_name}
                      </span>
                      <span className="font-mono text-emerald-400 font-bold">
                        +{item.bonus_seconds}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: COMPETITION SCORES & LEADERBOARD                   */}
        {/* ========================================================= */}
        {activeTab === "leaderboard" && (
          <div className="space-y-6">
            <div className="bg-[#16171b] border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    <span>Official Competition Leaderboard</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Rule Book §9.8: Presentation Score + Bonus Points from unspent auction budget (1 pt per 3 unspent coins).
                  </p>
                </div>
                <div className="text-right text-[11px] text-slate-400 font-mono">
                  {snapshot?.generatedAt && (
                    <span>Last synced: {new Date(snapshot.generatedAt).toLocaleTimeString()}</span>
                  )}
                </div>
              </div>

              {scoringLoading ? (
                <div className="p-12 text-center flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-[#fe5102]" />
                  <p className="text-xs text-slate-400">Calculating standings...</p>
                </div>
              ) : rankedTeams.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs italic">
                  No scores recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse font-sans">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-3">Rank</th>
                        <th className="px-4 py-3">Team</th>
                        <th className="px-4 py-3 text-center">Questions Solved</th>
                        <th className="px-4 py-3 text-right">Presentation Score</th>
                        <th className="px-4 py-3 text-right">Unspent Coins</th>
                        <th className="px-4 py-3 text-right">§9.8 Bonus Pts</th>
                        <th className="px-4 py-3 text-right">Total Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {rankedTeams.map((team, idx) => (
                        <tr
                          key={team.teamId}
                          className={`hover:bg-white/5 transition-colors ${
                            idx === 0
                              ? "bg-amber-500/5 font-semibold"
                              : idx === 1
                              ? "bg-slate-400/5"
                              : idx === 2
                              ? "bg-orange-500/5"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-3.5 font-bold font-mono">
                            {idx === 0 ? (
                              <span className="text-amber-400 flex items-center gap-1">
                                <Award className="w-4 h-4" /> #1
                              </span>
                            ) : idx === 1 ? (
                              <span className="text-slate-300 flex items-center gap-1">
                                <Award className="w-4 h-4" /> #2
                              </span>
                            ) : idx === 2 ? (
                              <span className="text-orange-400 flex items-center gap-1">
                                <Award className="w-4 h-4" /> #3
                              </span>
                            ) : (
                              <span className="text-slate-500">#{idx + 1}</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-bold text-white">{team.teamName}</td>
                          <td className="px-4 py-3.5 text-center text-slate-300 font-mono">
                            {team.solvedQuestions}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-white">
                            {team.score.toFixed(1)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-slate-300 flex items-center justify-end gap-1">
                            <Coins className="w-3.5 h-3.5 text-amber-400" />
                            <span>{team.remainingBudget}</span>
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-emerald-400">
                            +{team.projectedBonusPoints} pts
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono font-extrabold text-sm text-[#fe5102]">
                            {team.totalScore.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* REVIEW & EVALUATION MODAL                                 */}
        {/* ========================================================= */}
        {selectedSub && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
            <div className="bg-[#18191c] border border-white/10 rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-5 max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <span className="text-[10px] uppercase font-mono font-bold text-[#fe5102]">
                    Round {selectedSub.round} Evaluation
                  </span>
                  <h2 className="text-lg font-bold text-white mt-0.5">
                    {selectedSub.team_name}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Problem: <span className="text-white font-medium">{selectedSub.topic_title}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCloseReview}
                  disabled={modalBusy}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                  aria-label="Close review modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Links & Submissions preview */}
              <div className="bg-[#111215] border border-white/5 rounded-xl p-4 space-y-2.5 font-sans">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Project Deliverables
                </span>
                <div className="space-y-1.5 font-mono text-xs">
                  {selectedSub.repository_url ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-sans">GitHub Repo:</span>
                      <a
                        href={selectedSub.repository_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#fe5102] hover:underline flex items-center gap-1 truncate max-w-xs"
                      >
                        <span className="truncate">{selectedSub.repository_url}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    </div>
                  ) : (
                    <span className="text-slate-500 italic">No repository provided</span>
                  )}

                  {selectedSub.live_url && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-sans">Live Deployment:</span>
                      <a
                        href={selectedSub.live_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:underline flex items-center gap-1 truncate max-w-xs"
                      >
                        <span className="truncate">{selectedSub.live_url}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500 pt-1 font-sans">
                    Submitted: {new Date(selectedSub.submitted_at).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Evaluation Form */}
              <div className="space-y-4">
                <div>
                  <label htmlFor="evalScoreInput" className="text-xs font-bold text-slate-200 block mb-1.5">
                    Judge Presentation Score (0 – 100 pts) <span className="text-[#fe5102]">*</span>
                  </label>
                  <input
                    id="evalScoreInput"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={evalScore}
                    onChange={(e) => setEvalScore(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                    disabled={modalBusy}
                    className="w-full bg-[#111215] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-sm outline-none focus:border-[#fe5102] transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Points awarded for technical completeness, architecture, and code quality.
                  </span>
                </div>

                <div>
                  <label htmlFor="judgeNotesInput" className="text-xs font-bold text-slate-200 block mb-1.5">
                    Judge Notes / Feedback
                  </label>
                  <textarea
                    id="judgeNotesInput"
                    rows={3}
                    value={judgeNotes}
                    onChange={(e) => setJudgeNotes(e.target.value)}
                    disabled={modalBusy}
                    placeholder="Evaluation feedback, areas for improvement, or rejection reason..."
                    className="w-full bg-[#111215] border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-500 outline-none focus:border-[#fe5102] transition-colors leading-relaxed"
                  />
                </div>

                {/* Bonus Time Option */}
                <div className="bg-[#111215] border border-white/5 rounded-xl p-3.5 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-white block">
                      Grant Auction Bonus Time (+60s)
                    </span>
                    <span className="text-[11px] text-slate-400 block">
                      Extends the active auction clock when approving solution.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    id="grantBonusCheckbox"
                    checked={grantBonus}
                    onChange={(e) => setGrantBonus(e.target.checked)}
                    disabled={modalBusy || bonusHistory.some((b) => b.submission_id === selectedSub.id)}
                    className="w-4 h-4 accent-[#fe5102] rounded cursor-pointer"
                  />
                </div>
              </div>

              {/* Modal Feedback Banner */}
              {modalFeedback && (
                <div
                  className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                    modalFeedback.type === "success"
                      ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/30"
                      : "bg-red-950/80 text-red-300 border-red-500/30"
                  }`}
                >
                  {modalFeedback.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span>{modalFeedback.message}</span>
                </div>
              )}

              {/* Rejection Notice Banner */}
              {selectedSub.status === "rejected" && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>
                    This submission was rejected by judges. Click &quot;Reopen for Edits&quot; to allow participant revision before evaluating again.
                  </span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={handleCloseReview}
                  disabled={modalBusy}
                  className="px-4 py-2 text-xs font-semibold rounded-full border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedSub.status === "rejected" ? (
                    <button
                      type="button"
                      onClick={handleReopen}
                      disabled={modalBusy}
                      className="px-4 py-2 text-xs font-bold rounded-full bg-amber-600 hover:bg-amber-500 text-white transition-all cursor-pointer shadow-sm"
                    >
                      {modalBusy ? "Reopening..." : "Reopen for Edits"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleReject}
                      disabled={modalBusy || selectedSub.status === "approved"}
                      className="px-4 py-2 text-xs font-bold rounded-full bg-rose-600/80 hover:bg-rose-600 text-white transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {modalBusy ? "Rejecting..." : "Reject"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={modalBusy || selectedSub.status === "rejected"}
                    className="px-6 py-2 text-xs font-bold rounded-full bg-emerald-600 hover:bg-emerald-500 text-white transition-all cursor-pointer shadow-md shadow-emerald-500/20 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {modalBusy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{selectedSub.status === "approved" ? "Update Score" : "Approve Solution"}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AdminSubmissionsPage() {
  return (
    <AdminAuthGuard>
      <SubmissionsDashboardContent />
    </AdminAuthGuard>
  );
}
