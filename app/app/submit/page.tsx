"use client";

import React, { useState, useEffect, useId, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Send,
  Loader2,
  ArrowLeft,
  ExternalLink,
  Code2,
  Globe,
  Clock,
  Lock,
  AlertTriangle,
  Info,
} from "lucide-react";
import { B2BLogo } from "@/components/shared/B2BLogo";
import { supabase } from "@/lib/supabase";

interface AssignedProblem {
  id: string;
  number: number;
  round: number;
  title: string;
  statement: string;
  description: string;
  winningBid?: number;
  soldAt?: string | null;
  submission: {
    id: string;
    repository_url: string | null;
    live_url: string | null;
    status: string;
    submitted_at: string;
    approved_at: string | null;
    judge_notes?: string | null;
  } | null;
}

interface TeamData {
  id: string;
  name: string;
  balance: number;
  assignedProblems: AssignedProblem[];
}

/**
 * Submission portal.
 *
 * A solution belongs to the question the team won in the auction.
 * The team selects the assigned question and submits public GitHub and deployment URLs.
 * Once approved by judges in the admin console, the submission is permanently locked against changes.
 */
export default function SubmitPage() {
  const router = useRouter();

  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeProblemId, setActiveProblemId] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const repoInputId = useId();
  const liveInputId = useId();

  const loadTeamAndSubmission = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      let storedTeam: { id?: string; name?: string } | null = null;
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem("b2b_logged_in_team");
        if (raw) {
          try {
            storedTeam = JSON.parse(raw);
          } catch {
            // ignore JSON parse error
          }
        }
      }

      // Check current session token from Supabase Auth
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!storedTeam?.id && !storedTeam?.name && !token) {
        router.replace("/login");
        return;
      }

      const idParam = storedTeam?.id
        ? `id=${storedTeam.id}`
        : storedTeam?.name
        ? `name=${encodeURIComponent(storedTeam.name)}`
        : "";

      const res = await fetch(`/api/team/profile?${idParam}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();

      if (!res.ok || !data.team) {
        router.replace("/login");
        return;
      }

      setTeam(data.team);

      const problems: AssignedProblem[] = data.team.assignedProblems ?? [];
      const firstWithSubmission = problems.find((p) => p.submission);
      const selected = firstWithSubmission ?? problems[0];
      if (selected) {
        setActiveProblemId((prev) => prev || selected.id);
        const currentSelected = problems.find((p) => p.id === (activeProblemId || selected.id)) || selected;
        setRepoUrl(currentSelected.submission?.repository_url ?? "");
        setLiveUrl(currentSelected.submission?.live_url ?? "");
      }
    } catch {
      setErrorMsg("Failed to load team data. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [router, activeProblemId]);

  useEffect(() => {
    void loadTeamAndSubmission();
  }, [loadTeamAndSubmission]);

  const activeProblem = team?.assignedProblems?.find((p) => p.id === activeProblemId) ?? null;
  const existingSubmission = activeProblem?.submission ?? null;
  const isApproved = existingSubmission?.status === "approved";
  const isRejected = existingSubmission?.status === "rejected";
  const isLocked = isApproved || isRejected;

  const handleSelectProblem = (problem: AssignedProblem) => {
    setActiveProblemId(problem.id);
    setRepoUrl(problem.submission?.repository_url ?? "");
    setLiveUrl(problem.submission?.live_url ?? "");
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team) return;

    if (!activeProblemId) {
      setErrorMsg("Choose the question you are answering.");
      return;
    }

    if (!repoUrl.trim()) {
      setErrorMsg("GitHub repository URL is required.");
      return;
    }

    // Client-side URL format check
    try {
      const parsed = new URL(repoUrl.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setErrorMsg("GitHub URL must start with http:// or https://");
        return;
      }
    } catch {
      setErrorMsg("Please enter a valid GitHub repository URL.");
      return;
    }

    if (liveUrl.trim()) {
      try {
        const parsed = new URL(liveUrl.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          setErrorMsg("Live URL must start with http:// or https://");
          return;
        }
      } catch {
        setErrorMsg("Please enter a valid live deployment URL.");
        return;
      }
    }

    if (isLocked) {
      setErrorMsg(
        isApproved
          ? "This submission has been approved by judges and is locked against modifications."
          : "This submission was rejected by judges. Resubmission requires judge authorization."
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // Pass Bearer token so server route can verify the session cryptographically
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch("/api/submission", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          slotId: activeProblemId,
          repoUrl: repoUrl.trim(),
          liveUrl: liveUrl.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessMsg(
          data.isUpdate
            ? "Submission updated successfully!"
            : "Solution submitted successfully!"
        );
        void loadTeamAndSubmission();
      } else {
        setErrorMsg(data.error || "Failed to submit. Please check your links and try again.");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("b2b_logged_in_team");
    }
    void supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#141518] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#fe5102]" />
          <p className="text-xs text-slate-400">Loading submission portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141518] text-white flex flex-col justify-between p-4 sm:p-8 md:p-12 font-sans select-none">
      <div className="max-w-3xl w-full mx-auto space-y-8">
        {/* Navigation */}
        <header className="flex items-center justify-between pt-2 pb-4">
          <B2BLogo variant="dark" height={30} />
          <div className="flex items-center gap-6 text-sm">
            <Link
              href="/profile"
              className="text-white/90 hover:text-white transition-colors cursor-pointer font-medium flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Profile</span>
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="text-white/90 hover:text-red-400 transition-colors cursor-pointer font-medium"
            >
              Log out
            </button>
          </div>
        </header>

        {/* Header */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Submit Your Solution
            </h1>
            {existingSubmission && (
              <span
                className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1.5 ${
                  existingSubmission.status === "approved"
                    ? "bg-emerald-950 text-emerald-300 border-emerald-500/40"
                    : existingSubmission.status === "rejected"
                    ? "bg-rose-950 text-rose-300 border-rose-500/40"
                    : "bg-amber-950 text-amber-300 border-amber-500/40"
                }`}
              >
                {existingSubmission.status === "approved" ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Approved</span>
                  </>
                ) : existingSubmission.status === "rejected" ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>Rejected</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Submitted (In Review)</span>
                  </>
                )}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400">
            Submitting for Team: <span className="text-white font-bold">{team?.name}</span>
          </p>
        </div>

        {/* Assigned problems */}
        {team && team.assignedProblems.length > 0 ? (
          <div className="bg-[#22242a] border border-white/5 rounded-2xl p-5 space-y-3 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Your Assigned Problem Statements ({team.assignedProblems.length})
              </h2>
              <span className="text-[11px] text-slate-500">
                Click a problem statement to submit or view solution
              </span>
            </div>

            <div className="space-y-2.5">
              {team.assignedProblems.map((problem) => {
                const isActive = problem.id === activeProblemId;
                const subStatus = problem.submission?.status;
                return (
                  <button
                    key={problem.id}
                    type="button"
                    onClick={() => handleSelectProblem(problem)}
                    className={`w-full text-left rounded-xl p-4 border transition-all ${
                      isActive
                        ? "border-[#fe5102] bg-[#fe5102]/10 shadow-md ring-1 ring-[#fe5102]/30"
                        : "border-white/5 bg-[#18191c] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-slate-400">
                          #{problem.number}
                        </span>
                        <h3 className="text-sm font-bold text-white">{problem.title}</h3>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] uppercase font-bold text-slate-400 bg-white/5 px-2 py-0.5 rounded-md">
                          Round {problem.round}
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
                    {problem.description && (
                      <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                        {problem.description}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-[#22242a] border border-amber-500/20 rounded-2xl p-6 flex items-start gap-3.5 shadow-lg">
            <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-white mb-1">No Problem Statements Assigned</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your team does not own a problem statement yet. Problem statements are awarded
                when you win an auction item in the arena. Check back after winning your slot.
              </p>
              <div className="pt-3">
                <Link
                  href="/profile"
                  className="text-xs text-[#fe5102] hover:underline font-semibold"
                >
                  Return to Profile &rarr;
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Submission form */}
        {activeProblem && (
          <div className="bg-[#22242a] border border-white/10 rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
            <div className="border-b border-white/10 pb-4">
              <span className="text-[10px] uppercase font-mono font-bold text-[#fe5102]">
                Answering Round {activeProblem.round} · Problem #{activeProblem.number}
              </span>
              <h2 className="text-lg font-bold text-white mt-1">{activeProblem.title}</h2>
            </div>

            {/* Locked alert for approved solution */}
            {isApproved && (
              <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs flex items-start gap-3">
                <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Submission Approved and Locked</p>
                  <p className="text-emerald-300/80 leading-relaxed">
                    This solution has been evaluated and approved by the judges. Links are now
                    read-only and cannot be modified.
                  </p>
                </div>
              </div>
            )}

            {/* Alert for rejected solution */}
            {isRejected && (
              <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Submission Rejected</p>
                  <p className="text-rose-300/90 leading-relaxed">
                    {existingSubmission.judge_notes
                      ? `Judge Feedback: "${existingSubmission.judge_notes}"`
                      : "This solution was marked rejected by contest judges."}
                  </p>
                  <p className="text-[11px] text-rose-400/80 pt-1">
                    Contact the organizers if you believe this was an error. Resubmission requires
                    judge authorization.
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor={repoInputId}
                  className="text-xs font-bold text-slate-200 mb-1.5 flex items-center gap-1.5"
                >
                  <Code2 className="w-4 h-4 text-slate-400" />
                  <span>GitHub Repository URL</span>
                  <span className="text-[#fe5102]">*</span>
                </label>
                <input
                  id={repoInputId}
                  type="url"
                  required
                  disabled={isLocked || submitting}
                  placeholder="https://github.com/username/project"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full bg-[#18191c] border border-white/15 text-white text-sm px-4 py-3 rounded-xl outline-none focus:border-[#fe5102] transition-colors font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Ensure the repository is public or accessible to the judging panel.
                </span>
              </div>

              <div>
                <label
                  htmlFor={liveInputId}
                  className="text-xs font-bold text-slate-200 mb-1.5 flex items-center gap-1.5"
                >
                  <Globe className="w-4 h-4 text-slate-400" />
                  <span>Live Deployment URL</span>
                  <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <input
                  id={liveInputId}
                  type="url"
                  disabled={isLocked || submitting}
                  placeholder="https://your-project.vercel.app"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  className="w-full bg-[#18191c] border border-white/15 text-white text-sm px-4 py-3 rounded-xl outline-none focus:border-[#fe5102] transition-colors font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  A deployed web preview on Vercel, Netlify, or another cloud host.
                </span>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-red-950/80 text-red-300 border border-red-500/30 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-3">
                <Link
                  href="/profile"
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </Link>

                <button
                  type="submit"
                  disabled={isLocked || submitting}
                  className="bg-[#fe5102] hover:bg-[#d94502] text-white font-bold text-sm px-8 py-3 rounded-full transition-all cursor-pointer shadow-lg shadow-orange-500/25 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : isApproved ? (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>Approved (Locked)</span>
                    </>
                  ) : isRejected ? (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>Rejected (Locked)</span>
                    </>
                  ) : existingSubmission ? (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Update Submission</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Submit Solution</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Recorded Submission Card */}
            {existingSubmission && (
              <div className="bg-[#18191c] border border-white/10 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-[#fe5102]" />
                    <span>Recorded Solution Details</span>
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Status: {existingSubmission.status}
                  </span>
                </div>

                <div className="text-xs text-slate-300 space-y-1.5 font-mono">
                  <p className="flex items-center gap-2 truncate">
                    <span className="text-slate-500 font-sans">Repository:</span>
                    <a
                      href={existingSubmission.repository_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#fe5102] hover:underline flex items-center gap-1 truncate"
                    >
                      {existingSubmission.repository_url}
                      <ExternalLink className="w-3 h-3 inline shrink-0" />
                    </a>
                  </p>
                  {existingSubmission.live_url && (
                    <p className="flex items-center gap-2 truncate">
                      <span className="text-slate-500 font-sans">Live Demo:</span>
                      <a
                        href={existingSubmission.live_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#fe5102] hover:underline flex items-center gap-1 truncate"
                      >
                        {existingSubmission.live_url}
                        <ExternalLink className="w-3 h-3 inline shrink-0" />
                      </a>
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 font-sans pt-1">
                    Submitted on:{" "}
                    {new Date(existingSubmission.submitted_at).toLocaleString()}
                  </p>
                  {existingSubmission.judge_notes && (
                    <div className="font-sans text-[11px] bg-white/5 p-3 rounded-xl border border-white/5 mt-2">
                      <span className="text-slate-400 font-bold block mb-1">Judge Notes:</span>
                      <p className="text-slate-200">{existingSubmission.judge_notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="text-center text-[11px] text-slate-700 pt-8 max-w-3xl mx-auto w-full">
        © 2026 Bid2Build · CSEONECORE
      </footer>
    </div>
  );
}
