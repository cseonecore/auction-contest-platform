"use client";

import React, { useEffect, useState } from "react";
import { Award } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchBonusHistory } from "@/features/admin/services/adminAuctionService";

interface SubmissionRow {
  id: string;
  team_id: string;
  slot_id: string;
  repository_url: string | null;
  status: string;
  submitted_at: string;
  team_name?: string;
}

interface BonusApprovalProps {
  pending: string | null;
  onApprove: (submissionId: string, score: number, notes: string, grantBonus: boolean) => void;
}

/**
 * Solution review and bonus approval.
 *
 * Approving a solution records the judge score (competition scoring)
 * and, when requested, awards the auction bonus time. The backend
 * links the approval to the submission, the team and the question, and
 * refuses to award the same bonus twice.
 */
export function BonusApproval({ pending, onApprove }: BonusApprovalProps) {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [bonusHistory, setBonusHistory] = useState<
    Array<{
      id: string;
      team_name: string;
      bonus_seconds: number;
      submission_id: string;
    }>
  >([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const { data } = await supabase
        .from("submissions")
        .select("id, team_id, slot_id, repository_url, status, submitted_at, team:teams(name)")
        .order("submitted_at", { ascending: false })
        .limit(25);

      if (cancelled) return;

      const rows = (data ?? []).map((row) => {
        const relation = row.team as unknown as
          | { name: string }
          | { name: string }[]
          | null;
        const team = Array.isArray(relation) ? relation[0] : relation;
        return {
          id: row.id as string,
          team_id: row.team_id as string,
          slot_id: row.slot_id as string,
          repository_url: row.repository_url as string | null,
          status: row.status as string,
          submitted_at: row.submitted_at as string,
          team_name: team?.name ?? "Unknown team",
        } as SubmissionRow;
      });

      setSubmissions(rows);

      const bonus = await fetchBonusHistory();
      if (!cancelled && bonus.success && Array.isArray(bonus.data)) {
        setBonusHistory(
          bonus.data as Array<{
            id: string;
            team_name: string;
            bonus_seconds: number;
            submission_id: string;
          }>
        );
      }

      if (!cancelled) setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const btn =
    "px-3 py-2 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 shadow-xl space-y-4">
      <h3 className="text-base font-bold text-white flex items-center gap-2">
        <Award className="w-5 h-5 text-emerald-400" /> Solutions &amp; bonus time
      </h3>

      {loading ? (
        <p className="text-xs text-zinc-500 italic">Loading submissions...</p>
      ) : submissions.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No solutions have been submitted yet.</p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {submissions.map((submission) => {
            const alreadyAwarded = bonusHistory.some(
              (entry) => entry.submission_id === submission.id
            );

            return (
              <div
                key={submission.id}
                className="rounded-lg border border-zinc-800 bg-[#16171b] p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-white truncate">
                    {submission.team_name}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                      submission.status === "approved"
                        ? "border-emerald-500/40 text-emerald-300 bg-emerald-950/40"
                        : "border-zinc-700 text-zinc-400"
                    }`}
                  >
                    {submission.status}
                  </span>
                </div>

                {submission.repository_url && (
                  <a
                    href={submission.repository_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[11px] font-mono text-[#fe5102] truncate hover:underline"
                  >
                    {submission.repository_url}
                  </a>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={scores[submission.id] ?? 0}
                    onChange={(e) =>
                      setScores((prev) => ({ ...prev, [submission.id]: Number(e.target.value) || 0 }))
                    }
                    className="w-20 bg-zinc-800 border border-zinc-700 text-[11px] rounded-lg px-2 py-1.5 text-zinc-200"
                    aria-label={`Score for ${submission.team_name}`}
                  />
                  <input
                    value={notes[submission.id] ?? ""}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [submission.id]: e.target.value }))
                    }
                    placeholder="Judge notes"
                    className="flex-1 min-w-[150px] bg-zinc-800 border border-zinc-700 text-[11px] rounded-lg px-2.5 py-1.5 text-zinc-200 placeholder:text-zinc-600"
                    aria-label={`Notes for ${submission.team_name}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onApprove(
                        submission.id,
                        scores[submission.id] ?? 0,
                        notes[submission.id] ?? "",
                        !alreadyAwarded
                      )
                    }
                    disabled={!!pending || alreadyAwarded}
                    className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
                  >
                    {alreadyAwarded ? "Bonus awarded" : "Approve + bonus"}
                  </button>
                </div>

                {alreadyAwarded && (
                  <p className="text-[10px] text-emerald-400/80">
                    Bonus time already granted for this solution.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {bonusHistory.length > 0 && (
        <div className="border-t border-zinc-800 pt-3">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
            Bonus history
          </h4>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {bonusHistory.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-[11px] text-zinc-400">
                <span className="truncate">{entry.team_name}</span>
                <span className="font-mono text-emerald-300">+{entry.bonus_seconds}s</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
