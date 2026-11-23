'use client';

import { useEffect } from 'react';
import { RegisteredTeamWithRelations } from '../../types/registration';

interface TeamDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: RegisteredTeamWithRelations | null;
}

export function TeamDetailsModal({
  isOpen,
  onClose,
  team,
}: TeamDetailsModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !team) return null;

  const captain = team.captain;
  const teammates = team.members.filter((m) => m.id !== team.captain_id);
  const formattedDate = new Date(team.created_at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between bg-zinc-50/50 dark:bg-zinc-800/20">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">
                {team.name}
              </h2>
              {team.locked ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Unlocked
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              <span>Registered on: {formattedDate}</span>
              <span>•</span>
              <span className="font-mono text-[10px]">ID: {team.id.substring(0, 8)}...</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {/* Quick Stats: Wallet & Member count */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block font-medium">
                Wallet Points
              </span>
              <span className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-50">
                {team.wallet?.balance ?? 100} Coins
              </span>
            </div>
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block font-medium">
                Team Size
              </span>
              <span className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-50">
                {team.members.length} Members
              </span>
            </div>
          </div>

          {/* Captain Card */}
          <div>
            <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2.5">
              Team Captain
            </h3>
            {captain ? (
              <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-900 dark:text-zinc-100 text-base">
                        {captain.member.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-600 text-white">
                        Captain
                      </span>
                    </div>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                      {captain.member.email}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md bg-white dark:bg-zinc-900 font-mono text-xs font-bold border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300">
                      USN: {captain.usn}
                    </span>
                  </div>
                </div>

                {/* Additional parsed metadata */}
                <div className="pt-2 border-t border-blue-200/60 dark:border-blue-900/40 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">Semester: </span>
                    <strong className="text-zinc-800 dark:text-zinc-200">
                      {captain.semester ? `Semester ${captain.semester}` : 'Not Specified'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">Phone: </span>
                    <strong className="text-zinc-800 dark:text-zinc-200 font-mono">
                      {captain.phone || 'Not Provided'}
                    </strong>
                  </div>
                  <div className="sm:col-span-2 text-zinc-500 dark:text-zinc-400 text-[11px]">
                    College: <span className="text-zinc-700 dark:text-zinc-300">{captain.collegeName}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic">No captain assigned.</p>
            )}
          </div>

          {/* Teammates List */}
          <div>
            <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2.5">
              Teammates ({teammates.length})
            </h3>
            {teammates.length > 0 ? (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900">
                {teammates.map((tm, idx) => (
                  <div
                    key={tm.id}
                    className="p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                        <span className="text-xs text-zinc-400">#{idx + 2}</span>
                        <span>{tm.name}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                        <span>{tm.email}</span>
                        <span>•</span>
                        <span>Phone: <strong className="font-semibold text-zinc-700 dark:text-zinc-300 font-mono">{tm.phone?.trim() || 'Not Provided'}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-xs text-zinc-700 dark:text-zinc-300 font-medium">
                        USN: {tm.parsedUsn}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500">
                This team does not have additional teammates registered.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 flex items-center justify-between">
          <div />

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-black text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
}
