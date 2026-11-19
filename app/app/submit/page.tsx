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
} from "lucide-react";
import { B2BLogo } from "@/components/shared/B2BLogo";

interface AssignedProblem {
  id: string;
  number: number;
  round: number;
  title: string;
  statement: string;
  description: string;
  winningBid: number;
  soldAt: string | null;
  submission: {
    id: string;
    repository_url: string | null;
    live_url: string | null;
    status: string;
    submitted_at: string;
    approved_at: string | null;
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
 * A solution belongs to the question the team won, so the team picks
 * the assigned question and the submission is recorded against that
 * auction item. The judge approves the solution in the admin console,
 * which is what triggers the bonus time.
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
            // ignore
          }
        }
      }

      if (!storedTeam?.id && !storedTeam?.name) {
        router.replace("/login");
        return;
      }

      const idParam = storedTeam.id
        ? `id=${storedTeam.id}`
        : `name=${encodeURIComponent(storedTeam.name!)}`;

      const res = await fetch(`/api/team/profile?${idParam}`);
      const data = await res.json();

      if (!res.ok || !data.team) {
        router.replace("/login");
        return;
      }

      setTeam(data.team);

      const problems = data.team.assignedProblems ?? [];
      const firstWithSubmission = problems.find((p: AssignedProblem) => p.submission);
      const selected = firstWithSubmission ?? problems[0];
      if (selected) {
        setActiveProblemId(selected.id);
        setRepoUrl(selected.submission?.repository_url ?? "");
        setLiveUrl(selected.submission?.live_url ?? "");
      }
    } catch {
      setErrorMsg("Failed to load team data. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadTeamAndSubmission();
  }, [loadTeamAndSubmission]);

  const activeProblem = team?.assignedProblems?.find((p) => p.id === activeProblemId) ?? null;
  const existingSubmission = activeProblem?.submission ?? null;

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

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          <B2BLogo variant="light" height={28} />
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
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Submit Your Solution
            </h1>
            {existingSubmission && (
              <span className="bg-emerald-950 text-emerald-300 text-xs font-bold px-3 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {existingSubmission.status === "approved"
                  ? "Approved"
                  : "Submitted"}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400">
            Team: <span className="text-white font-bold">{team?.name}</span>
          </p>
        </div>

        {/* Assigned problems */}
        {team && team.assignedProblems.length > 0 ? (
          <div className="bg-[#22242a] border border-white/5 rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Your Assigned Problem Statements
            </h2>
            <div className="space-y-2">
              {team.assignedProblems.map((problem) => {
                const isActive = problem.id === activeProblemId;
                return (
                  <button
                    key={problem.id}
                    type="button"
                    onClick={() => handleSelectProblem(problem)}
                    className={`w-full text-left rounded-xl p-4 border transition-colors ${
                      isActive
                        ? "border-[#fe5102]/60 bg-[#fe5102]/10"
                        : "border-white/5 bg-[#18191c] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-bold text-white">{problem.title}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-slate-500">
                          Round {problem.round}
                        </span>
                        {problem.submission && (
                          <span
                            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                              problem.submission.status === "approved"
                                ? "border-emerald-500/40 text-emerald-300"
                                : "border-amber-500/40 text-amber-300"
                            }`}
                          >
                            {problem.submission.status}
                          </span>
                        )}
                      </div>
                    </div>
                    {problem.description && (
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        {problem.description}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-[#22242a] border border-amber-500/20 rounded-2xl p-5 flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300">
              Your team does not own a problem statement yet. Submit once you have won an
              auction item.
            </p>
          </div>
        )}

        {/* Submission form */}
        {activeProblem && (
          <div className="bg-[#22242a] border border-white/10 rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor={repoInputId}
                  className="block text-xs font-bold text-slate-200 mb-1.5 flex items-center gap-1.5"
                >
                  <Code2 className="w-4 h-4 text-slate-400" />
                  <span>GitHub Repository URL</span>
                  <span className="text-[#fe5102]">*</span>
                </label>
                <input
                  id={repoInputId}
                  type="url"
                  required
                  placeholder="https://github.com/username/project"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full bg-[#18191c] border border-white/15 text-white text-sm px-4 py-3 rounded-xl outline-none focus:border-[#fe5102] transition-colors font-mono"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Ensure the repository is public or accessible to organizers.
                </span>
              </div>

              <div>
                <label
                  htmlFor={liveInputId}
                  className="block text-xs font-bold text-slate-200 mb-1.5 flex items-center gap-1.5"
                >
                  <Globe className="w-4 h-4 text-slate-400" />
                  <span>Live Deployment URL</span>
                  <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <input
                  id={liveInputId}
                  type="url"
                  placeholder="https://your-project.vercel.app"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  className="w-full bg-[#18191c] border border-white/15 text-white text-sm px-4 py-3 rounded-xl outline-none focus:border-[#fe5102] transition-colors font-mono"
                />
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-red-950/80 text-red-300 border border-red-500/30 text-xs font-semibold">
                  {errorMsg}
                </div>
              )}

              {successMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Link href="/profile" className="text-xs text-slate-400 hover:text-white transition-colors">
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-[#fe5102] hover:bg-[#d94502] text-white font-bold text-sm px-8 py-3 rounded-full transition-all cursor-pointer shadow-lg shadow-orange-500/25 flex items-center gap-2 disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>{existingSubmission ? "Update Submission" : "Submit Solution"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {existingSubmission && (
              <div className="bg-[#18191c] border border-emerald-500/20 rounded-2xl p-5 space-y-2">
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  Recorded Submission
                </h3>
                <div className="text-xs text-slate-300 space-y-1 font-mono">
                  <p className="flex items-center gap-2 truncate">
                    <span className="text-slate-500 font-sans">Repo:</span>
                    <a
                      href={existingSubmission.repository_url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#fe5102] hover:underline flex items-center gap-1 truncate"
                    >
                      {existingSubmission.repository_url}
                      <ExternalLink className="w-3 h-3 inline" />
                    </a>
                  </p>
                  {existingSubmission.live_url && (
                    <p className="flex items-center gap-2 truncate">
                      <span className="text-slate-500 font-sans">Live:</span>
                      <a
                        href={existingSubmission.live_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#fe5102] hover:underline flex items-center gap-1 truncate"
                      >
                        {existingSubmission.live_url}
                        <ExternalLink className="w-3 h-3 inline" />
                      </a>
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 font-sans pt-1">
                    Submitted on: {new Date(existingSubmission.submitted_at).toLocaleString()}
                  </p>
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
