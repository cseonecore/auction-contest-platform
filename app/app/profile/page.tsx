"use client";

import React, { useEffect, useState, useId, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  X,
  CheckCircle2,
  BookOpen,
  Send,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { B2BLogo } from "@/components/shared/B2BLogo";

interface Member {
  id?: string;
  name: string;
  email: string;
  usn: string;
  branch: string;
  semester: string;
  phone: string;
  isCaptain: boolean;
}

interface AssignedProblem {
  id: string;
  number: number;
  questionNumber?: number;
  title: string;
  statement: string;
  description: string;
  difficulty?: string;
  winningBid?: number;
  baseDevSeconds?: number;
  addOnSeconds?: number;
  totalDevSeconds?: number;
  status?: string;
  round?: number;
  submission?: {
    id: string;
    repository_url?: string;
    repo_url?: string;
    live_url?: string | null;
    status?: string;
    submitted_at: string;
    approved_at?: string | null;
    judge_notes?: string | null;
  } | null;
}

function formatDevTime(seconds?: number): string {
  if (seconds == null || isNaN(seconds) || seconds <= 0) return "0 min";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins} min`;
}

interface Submission {
  id: string;
  repo_url?: string;
  repository_url?: string;
  live_url?: string | null;
  status?: string;
  submitted_at: string;
  approved_at?: string | null;
  judge_notes?: string | null;
}

interface TeamData {
  id: string;
  name: string;
  locked?: boolean;
  balance: number;
  members: Member[];
  assignedProblems: AssignedProblem[];
  isAuctionLive: boolean;
  submission?: Submission | null;
  characterIndex: number;
}

export default function ProfilePage() {
  const router = useRouter();

  // Team state
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal dialog states
  const [showAuctionNotStartedModal, setShowAuctionNotStartedModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);

  // Load Team Profile
  const loadProfile = useCallback(
    async (silent = false) => {
      try {
        // A quiet background refresh must never flash the spinner or
        // wipe an error the participant is reading.
        if (!silent) {
          setLoading(true);
          setError(null);
        }

        let storedTeamName = "";
        let storedTeamId = "";

        if (typeof window !== "undefined") {
          const raw = localStorage.getItem("b2b_logged_in_team");
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              storedTeamName = parsed.name || "";
              storedTeamId = parsed.id || "";
            } catch {
              // ignore parse errors
            }
          }
        }

        // No team in localStorage — not authenticated
        if (!storedTeamName && !storedTeamId) {
          router.replace("/login");
          return;
        }

        const res = await fetch(
          `/api/team/profile?${storedTeamId ? `id=${storedTeamId}` : `name=${encodeURIComponent(storedTeamName)}`}`
        );
        const data = await res.json();

        if (res.ok && data.team) {
          setTeam(data.team);
        } else if (!silent) {
          setError(data.error || "Failed to load team profile.");
        }
      } catch {
        if (!silent) {
          setError("Network error. Please check your connection and try again.");
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [router]
  );

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Quiet background refresh: the Enter Auction gate must open as soon
  // as the host starts (or restarts) the auction, without the
  // participant having to reload the page. Realtime-style polling at a
  // gentle 15s cadence, plus an immediate refresh when the tab regains
  // focus or becomes visible.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const quietRefresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadProfile(true);
    };

    const interval = window.setInterval(quietRefresh, 15000);
    window.addEventListener("focus", quietRefresh);
    document.addEventListener("visibilitychange", quietRefresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", quietRefresh);
      document.removeEventListener("visibilitychange", quietRefresh);
    };
  }, [loadProfile]);

  const handleLogout = () => {
    // Best-effort server sign-out (invalidates the single-device
    // session and clears the httpOnly cookie).
    void fetch("/api/logout", { method: "POST" }).catch(() => {});
    if (typeof window !== "undefined") {
      localStorage.removeItem("b2b_logged_in_team");
    }
    router.push("/login");
  };

  const handleEnterAuction = () => {
    if (!team?.isAuctionLive) {
      setShowAuctionNotStartedModal(true);
    } else {
      router.push("/auction");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#141518] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#fe5102]" />
          <p className="text-xs text-slate-400">Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#141518] text-white flex items-center justify-center p-6">
        <div className="bg-[#22242a] border border-white/10 rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-red-400/60 flex items-center justify-center mx-auto text-red-400 font-bold text-xl">!</div>
          <h2 className="text-base font-bold text-white">Could not load profile</h2>
          <p className="text-xs text-slate-400 leading-relaxed">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => loadProfile()}
              className="bg-[#fe5102] hover:bg-[#d94502] text-white text-xs font-semibold px-5 py-2 rounded-full transition-all cursor-pointer"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="bg-[#374151] hover:bg-[#4b5563] text-white text-xs font-semibold px-5 py-2 rounded-full transition-all cursor-pointer"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!team) return null;

  const isSubmitted = !!team.submission;
  const captainMember = team.members.find((m) => m.isCaptain);
  const characterIndex = team.characterIndex ?? 0;

  return (
    <div className="min-h-screen bg-[#141518] text-white selection:bg-[#fe5102] selection:text-white flex flex-col justify-between p-4 sm:p-8 md:p-12 font-sans select-none">
      <div className="max-w-6xl w-full mx-auto space-y-8">
        {/* ========================================================= */}
        {/* TOP NAVBAR                                                 */}
        {/* ========================================================= */}
        <header className="flex items-center justify-between pt-2 pb-4">
          <B2BLogo variant="dark" height={30} />
          <div className="flex items-center gap-6 text-sm">
            <button
              type="button"
              onClick={() => setShowRulesModal(true)}
              className="text-white/90 hover:text-white transition-colors cursor-pointer font-medium"
            >
              Contest Rules
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="text-white/90 hover:text-red-400 transition-colors cursor-pointer font-medium"
            >
              Log out
            </button>
          </div>
        </header>

        {/* ========================================================= */}
        {/* SECTION 1: TEAM OVERVIEW & STATUS BAR                     */}
        {/* ========================================================= */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 pt-2">
          {/* LEFT: Team Avatar, Name & Badges */}
          <div className="flex items-center gap-4 sm:gap-5">
            {/* Character Avatar */}
            <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-white flex items-center justify-center shrink-0 border-2 border-slate-700/60 shadow-xl relative overflow-hidden">
              <Image
                src={`/characters/Character-0${characterIndex}.png`}
                alt="Team Character"
                fill
                sizes="(max-width: 640px) 72px, 80px"
                className="object-contain p-1"
                priority
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "/characters/Character-01.png";
                }}
              />
            </div>

            {/* Team Info & Badges */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {team.name}
                </h1>
                <span className="w-5 h-5 rounded-full bg-[#38bdf8] text-white flex items-center justify-center text-xs font-bold shadow-xs flex-shrink-0">
                  ✓
                </span>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="bg-[#dcfce7] text-[#15803d] font-semibold text-xs px-3 py-1 rounded-full shadow-2xs">
                  Coin Balance: {team.balance}
                </span>
                <span className="bg-[#ffedd5] text-[#9a3412] font-semibold text-xs px-3 py-1 rounded-full shadow-2xs">
                  Problem{team.assignedProblems.length !== 1 ? "s" : ""} Assigned: {team.assignedProblems.length}
                </span>
                {captainMember && (
                  <span className="bg-[#e0e7ff] text-[#3730a3] font-semibold text-xs px-3 py-1 rounded-full shadow-2xs">
                    Captain: {captainMember.name.split(" ")[0]}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Status Card */}
          <div className="bg-[#22242a] rounded-2xl p-4 sm:p-5 border border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-lg lg:min-w-[320px]">
            <div className="space-y-2.5 text-xs font-medium">
              <div className="flex items-center gap-2.5">
                <span className="text-slate-300">Auction Status</span>
                {team.isAuctionLive ? (
                  <span className="bg-[#dcfce7] text-[#15803d] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
                    <span className="w-2 h-2 rounded-full bg-[#15803d] animate-pulse" />
                    Live
                  </span>
                ) : (
                  <span className="bg-[#fef9c3] text-[#854d0e] font-bold px-2.5 py-0.5 rounded-full shadow-2xs">
                    Upcoming
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-slate-300">Submission</span>
                {isSubmitted ? (
                  <span className="bg-[#dcfce7] text-[#15803d] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
                    <CheckCircle2 className="w-3 h-3" />
                    Submitted
                  </span>
                ) : (
                  <span className="bg-[#ffe4e6] text-[#be123c] font-bold px-2.5 py-0.5 rounded-full shadow-2xs">
                    Not Submitted
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* SECTION 2: TEAM MEMBERS                                   */}
        {/* ========================================================= */}
        <section className="space-y-3 pt-2">
          <h2 className="text-sm font-semibold text-slate-400 tracking-wide uppercase">
            Team Members
          </h2>

          {team.members.length === 0 ? (
            <div className="bg-[#22242a] rounded-2xl p-6 border border-white/5 max-w-sm">
              <p className="text-xs text-slate-400">No member information available.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {team.members.map((member, index) => (
                <div
                  key={member.id || index}
                  className="bg-[#22242a] rounded-2xl p-5 border border-white/5 space-y-2 shadow-md hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2.5">
                    <h3 className="text-base font-bold text-white tracking-tight">
                      {member.name}
                    </h3>
                    {member.isCaptain && (
                      <span className="bg-[#bbf7d0] text-[#14532d] text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-2xs flex-shrink-0">
                        Captain
                      </span>
                    )}
                  </div>

                  <div className="text-xs space-y-1 text-slate-300">
                    <p>
                      <span className="text-slate-400">USN: </span>
                      <span className="font-mono text-white">{member.usn}</span>
                    </p>
                    <p>
                      <span className="text-slate-400">Branch: </span>
                      <span>{member.branch || "—"}</span>
                    </p>
                    <p>
                      <span className="text-slate-400">Semester: </span>
                      <span>{member.semester || "—"}</span>
                    </p>
                    <p>
                      <span className="text-slate-400">Phone: </span>
                      <span className="font-mono">
                        {member.phone && member.phone !== "+91 00000 00000" && member.phone !== "+91 12345 67890"
                          ? member.phone
                          : "—"}
                      </span>
                    </p>
                    <p className="truncate">
                      <span className="text-slate-400">Email: </span>
                      <span className="font-mono text-slate-300">{member.email}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ========================================================= */}
        {/* SECTION 3: ASSIGNED PROBLEMS                              */}
        {/* ========================================================= */}
        <section className="space-y-3 pt-2">
          <h2 className="text-sm font-semibold text-slate-400 tracking-wide uppercase">
            Assigned Problems
          </h2>

          {team.assignedProblems.length === 0 ? (
            <div className="bg-[#22242a] rounded-2xl p-6 border border-white/5 max-w-md shadow-md space-y-1.5">
              <h3 className="text-base font-bold text-white tracking-tight">
                No Problems Selected
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Once you bid and win a problem statement it will appear here
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl">
              {team.assignedProblems.map((prob) => {
                const subStatus = prob.submission?.status;
                return (
                  <div
                    key={prob.id}
                    className="bg-[#22242a] rounded-2xl p-5 border border-white/5 space-y-3 shadow-md hover:border-white/10 transition-colors flex flex-col justify-between"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2 border-b border-white/5 pb-2.5">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                            Slot #{String(prob.questionNumber ?? prob.number).padStart(2, "0")} · Round {prob.round ?? 1}
                          </span>
                          <h3 className="text-base font-bold text-white tracking-tight mt-0.5">
                            {prob.title || `Problem ${prob.number}`}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          <span
                            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                              prob.difficulty?.toLowerCase() === "hard"
                                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            }`}
                          >
                            {prob.difficulty || "Easy"}
                          </span>
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            {prob.status === "sold" ? "Acquired" : prob.status}
                          </span>
                          {subStatus && (
                            <span
                              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                                subStatus === "approved"
                                  ? "border-emerald-500/40 text-emerald-300 bg-emerald-950/40"
                                  : subStatus === "rejected"
                                  ? "border-rose-500/40 text-rose-300 bg-rose-950/40"
                                  : "border-amber-500/40 text-amber-300 bg-amber-950/40"
                              }`}
                            >
                              {subStatus}
                            </span>
                          )}
                        </div>
                      </div>

                      {prob.statement && prob.statement !== prob.title && (
                        <p className="text-xs font-semibold text-slate-300">
                          {prob.statement}
                        </p>
                      )}

                      {prob.description && (
                        <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                          {prob.description}
                        </p>
                      )}

                      {/* Dev time & Financials breakdown */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/5 text-[11px]">
                        <div className="bg-[#1a1b20] p-2 rounded-xl">
                          <span className="text-slate-400 block text-[10px]">Winning Bid</span>
                          <span className="font-mono font-bold text-amber-400">
                            {prob.winningBid ?? 0} pts
                          </span>
                        </div>
                        <div className="bg-[#1a1b20] p-2 rounded-xl">
                          <span className="text-slate-400 block text-[10px]">Base Dev Time</span>
                          <span className="font-mono font-bold text-slate-200">
                            {formatDevTime(prob.baseDevSeconds)}
                          </span>
                        </div>
                        <div className="bg-[#1a1b20] p-2 rounded-xl">
                          <span className="text-slate-400 block text-[10px]">Add-on Time</span>
                          <span className="font-mono font-bold text-emerald-400">
                            +{formatDevTime(prob.addOnSeconds)}
                          </span>
                        </div>
                        <div className="bg-[#1a1b20] p-2 rounded-xl">
                          <span className="text-slate-400 block text-[10px]">Total Dev Time</span>
                          <span className="font-mono font-black text-emerald-300">
                            {formatDevTime(prob.totalDevSeconds)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs mt-2">
                      <span className="text-slate-500 text-[11px]">
                        {subStatus ? "Submission recorded" : "Pending solution"}
                      </span>
                      <Link
                        href="/submit"
                        className="text-[#fe5102] hover:text-[#ff7836] font-semibold text-[11px] flex items-center gap-1 transition-colors"
                      >
                        <span>{subStatus ? "View / Edit" : "Submit now"}</span>
                        <span>&rarr;</span>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Submission status display (if already submitted) */}
        {isSubmitted && team.submission && (
          <section className="pt-2">
            <div className="bg-[#18191c] border border-white/10 rounded-2xl p-5 max-w-xl space-y-3 shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-bold">Team Submission Status</span>
                </div>
                <span
                  className={`text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full border ${
                    team.submission.status === "approved"
                      ? "border-emerald-500/40 text-emerald-300 bg-emerald-950/40"
                      : team.submission.status === "rejected"
                      ? "border-rose-500/40 text-rose-300 bg-rose-950/40"
                      : "border-amber-500/40 text-amber-300 bg-amber-950/40"
                  }`}
                >
                  {team.submission.status || "Submitted"}
                </span>
              </div>

              <div className="text-xs space-y-1.5 text-slate-300 font-mono">
                {(team.submission.repo_url || team.submission.repository_url) && (
                  <p className="flex items-center gap-2 truncate">
                    <span className="text-slate-500 font-sans">Repository:</span>
                    <a
                      href={team.submission.repo_url || team.submission.repository_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#fe5102] hover:underline flex items-center gap-1 truncate"
                    >
                      {team.submission.repo_url || team.submission.repository_url}
                      <ExternalLink className="w-3 h-3 inline shrink-0" />
                    </a>
                  </p>
                )}
                {team.submission.live_url && (
                  <p className="flex items-center gap-2 truncate">
                    <span className="text-slate-500 font-sans">Live Demo:</span>
                    <a
                      href={team.submission.live_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#fe5102] hover:underline flex items-center gap-1 truncate"
                    >
                      {team.submission.live_url}
                      <ExternalLink className="w-3 h-3 inline shrink-0" />
                    </a>
                  </p>
                )}
                {team.submission.judge_notes && (
                  <p className="font-sans text-[11px] text-amber-300/90 pt-1 border-t border-white/5">
                    <span className="text-slate-500 font-bold">Judge Feedback: </span>
                    {team.submission.judge_notes}
                  </p>
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <Link
                  href="/submit"
                  className="text-xs font-semibold text-[#fe5102] hover:text-[#ff7836] flex items-center gap-1 transition-colors"
                >
                  <span>Open Submission Portal</span>
                  <span>&rarr;</span>
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================= */}
        {/* SECTION 4: ACTION BUTTONS                                 */}
        {/* ========================================================= */}
        <div className="flex flex-wrap items-center gap-4 pt-4 pb-6">
          <button
            type="button"
            onClick={handleEnterAuction}
            className="bg-[#ffedd5] hover:bg-[#fed7aa] active:scale-95 text-[#7c2d12] font-semibold text-xs sm:text-sm px-7 py-2.5 rounded-full transition-all shadow-sm cursor-pointer"
          >
            Enter Auction
          </button>

          <Link
            href="/submit"
            className="bg-[#fe5102] hover:bg-[#d94502] active:scale-95 text-white font-semibold text-xs sm:text-sm px-8 py-2.5 rounded-full transition-all shadow-md shadow-orange-500/25 cursor-pointer inline-flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            <span>{isSubmitted ? "Manage Submissions" : "Submit Solution"}</span>
          </Link>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL 1: Auction Not Started                              */}
      {/* ========================================================= */}
      {showAuctionNotStartedModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-[#22242a] border border-white/10 rounded-2xl p-7 max-w-sm w-full mx-auto text-center shadow-2xl relative animate-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => setShowAuctionNotStartedModal(false)}
              className="absolute right-3.5 top-3.5 text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-full border-2 border-white flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold">
              !
            </div>

            <h2 className="text-lg font-bold text-white mb-2">
              Auction not yet started!
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed mb-6">
              Please wait for the host to start live auctioning. You will be able to enter once the auction goes live.
            </p>

            <button
              type="button"
              onClick={() => setShowAuctionNotStartedModal(false)}
              className="bg-[#374151] hover:bg-[#4b5563] text-white text-xs font-semibold px-6 py-2 rounded-full cursor-pointer transition-all"
            >
              Okay, got it
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: Contest Rules                                    */}
      {/* ========================================================= */}
      {showRulesModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-[#22242a] border border-white/10 rounded-2xl p-6 sm:p-7 max-w-lg w-full mx-auto text-left shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowRulesModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4 text-[#fe5102]">
              <BookOpen className="w-5 h-5" />
              <h2 className="text-lg font-bold text-white">Bid2Build Contest Rules</h2>
            </div>

            <div className="text-xs text-slate-300 space-y-3.5 leading-relaxed">
              <div>
                <h4 className="font-bold text-white text-sm mb-1">1. Auction Structure</h4>
                <p>
                  • Two consecutive bidding rounds. Each team starts with a unified <strong>100 Coins</strong> wallet.
                  <br />
                  • Bids are placed in real-time. Losing bids cost 0 coins; coins are only deducted upon winning a slot.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm mb-1">2. Problem Statement Assignment</h4>
                <p>
                  • Winning a slot awards your team that problem statement for development.
                  <br />
                  • You must build a functional prototype within the designated contest time limit.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm mb-1">3. Bidding Rules</h4>
                <p>
                  • Opening bid minimum: 10 coins. Minimum raise: 10 coins above the current bid.
                  <br />
                  • A team cannot re-bid while already leading a slot.
                  <br />
                  • Each team may win at most one slot per round.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-white text-sm mb-1">4. Submission Criteria</h4>
                <p>
                  • Submit your public GitHub repository and optional live demo URL before the countdown reaches zero.
                  <br />
                  • Submissions are evaluated on implementation depth, UI fidelity, and code quality.
                  <br />
                  • Unspent coins after the auction convert to bonus evaluation points.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10 text-right">
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="bg-[#fe5102] hover:bg-[#d94502] text-white text-xs font-semibold px-6 py-2 rounded-full cursor-pointer transition-all"
              >
                Close Rules
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center text-[11px] text-slate-700 pt-8 max-w-6xl mx-auto w-full">
        © 2026 Bid2Build · CSEONECORE
      </footer>
    </div>
  );
}
