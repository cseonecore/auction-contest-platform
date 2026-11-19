"use client";

import React, { useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";

interface TeamEliminationControlProps {
  teams: Array<{
    id: string;
    name: string;
    eliminated: boolean;
    reason?: string;
    eliminated_at?: string;
  }>;
  pending: string | null;
  onEliminate: (teamId: string, reason: string) => void;
  onRestore: (teamId: string) => void;
}

/**
 * Elimination control.
 *
 * The reason is mandatory: the backend refuses to eliminate a team
 * without one, and the record is kept forever in
 * `public.team_eliminations`.
 */
export function TeamEliminationControl({
  teams,
  pending,
  onEliminate,
  onRestore,
}: TeamEliminationControlProps) {
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const btn =
    "px-3 py-2 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 shadow-xl space-y-4">
      <h3 className="text-base font-bold text-white flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-amber-400" /> Participation
      </h3>

      {teams.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No teams have registered yet.</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {teams.map((team) => (
            <div
              key={team.id}
              className={`rounded-lg border p-3 ${
                team.eliminated
                  ? "border-rose-500/40 bg-rose-950/30"
                  : "border-zinc-800 bg-[#16171b]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-white truncate">{team.name}</span>
                {team.eliminated ? (
                  <span className="text-[10px] uppercase font-bold text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded-full">
                    Eliminated
                  </span>
                ) : (
                  <span className="text-[10px] uppercase font-bold text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                    Active
                  </span>
                )}
              </div>

              {team.eliminated && team.reason && (
                <p className="text-[11px] text-rose-300/80 mt-1">
                  {team.reason}
                  {team.eliminated_at && (
                    <span className="text-rose-300/50">
                      {" · "}
                      {new Date(team.eliminated_at).toLocaleString()}
                    </span>
                  )}
                </p>
              )}

              {team.eliminated ? (
                <button
                  type="button"
                  onClick={() => onRestore(team.id)}
                  disabled={!!pending}
                  className={`${btn} mt-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 inline-flex items-center gap-1.5`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" /> Restore team
                </button>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={reasons[team.id] ?? ""}
                    onChange={(e) =>
                      setReasons((prev) => ({ ...prev, [team.id]: e.target.value }))
                    }
                    placeholder="Reason for elimination (required)"
                    className="flex-1 min-w-[180px] bg-zinc-800 border border-zinc-700 text-[11px] rounded-lg px-2.5 py-1.5 text-zinc-200 placeholder:text-zinc-600"
                    aria-label={`Elimination reason for ${team.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => onEliminate(team.id, reasons[team.id]?.trim() ?? "")}
                    disabled={!!pending || !(reasons[team.id] ?? "").trim()}
                    className={`${btn} bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-500/40`}
                  >
                    Eliminate
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
