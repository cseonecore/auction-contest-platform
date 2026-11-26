'use client';

/**
 * TeamDeleteModal Component
 * Bid2Build (Auction Contest Platform) — Phase 5B: Safe Team Deletion
 *
 * Destructive operation confirmation modal:
 *  - Displays list of selected teams (Name, Team ID, Member count).
 *  - Explicitly warns of permanent cascading removal of rosters and wallets.
 *  - Warns that auction bids are deleted and slot leader/winner links are cleared.
 *  - Deletes every selected team together in one operation, with a single confirm button.
 *  - Displays transactional database error feedback if rejected.
 */

import React from 'react';
import { RegisteredTeamWithRelations } from '../../types/registration';

interface TeamDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
  selectedTeams: RegisteredTeamWithRelations[];
  errorMessage?: string | null;
}

export function TeamDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
  selectedTeams,
  errorMessage,
}: TeamDeleteModalProps) {
  if (!isOpen) return null;

  const totalMembersAffected = selectedTeams.reduce(
    (acc, t) => acc + (t.members?.length || 0),
    0
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (!isDeleting) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-zinc-900 border-2 border-rose-300 dark:border-rose-900/80 rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3.5 shrink-0">
          <div className="w-11 h-11 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                Destructive Action
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                {selectedTeams.length} {selectedTeams.length === 1 ? 'Team' : 'Teams'} Selected
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mt-1">
              Delete Selected Teams?
            </h2>
          </div>

          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Database Error Banner if previous attempt failed */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-rose-100/80 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs shrink-0 flex items-start gap-2.5">
            <svg className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="font-bold">Deletion Rejected by Database:</p>
              <p className="mt-0.5 text-[11px] leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Warning Callout Box */}
        <div className="p-4 rounded-xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-900 dark:text-rose-200 space-y-2 leading-relaxed shrink-0">
          <p className="font-bold">
            Permanent team deletion cannot be undone.
          </p>
          <ul className="list-disc list-inside space-y-1 text-[11px] text-rose-800 dark:text-rose-300">
            <li>
              All <strong className="font-semibold">{selectedTeams.length}</strong> selected {selectedTeams.length === 1 ? 'team' : 'teams'} ({totalMembersAffected} participant records) and their point wallets will be deleted together in one operation.
            </li>
            <li>
              <strong className="font-semibold">Auction bids</strong> placed by these teams are deleted, and <strong className="font-semibold">slot leader/winner links</strong> are cleared. <strong className="font-semibold">Submissions</strong> and <strong className="font-semibold">challenge solves</strong> belonging to these teams are also deleted.
            </li>
            <li>
              An unalterable audit log entry (<code className="font-mono text-[10px]">team_deleted</code>) will be recorded for each deleted team before removal.
            </li>
          </ul>
        </div>

        {/* Selected Teams List */}
        <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-medium">
            <span>Teams to be deleted:</span>
            <span className="font-mono text-[11px]">{selectedTeams.length} teams ({totalMembersAffected} members)</span>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden overflow-y-auto max-h-48 divide-y divide-zinc-100 dark:divide-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-800/30">
            {selectedTeams.map((team) => (
              <div key={team.id} className="p-3 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      {team.name}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                        team.locked
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      }`}
                    >
                      {team.locked ? 'Locked' : 'Unlocked'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono mt-0.5">
                    <span>ID: {team.id}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[11px] font-mono font-medium text-zinc-700 dark:text-zinc-300">
                    {team.members.length} {team.members.length === 1 ? 'member' : 'members'}
                  </span>
                  {team.captain && (
                    <span className="block text-[10px] text-zinc-400">
                      Captain: {team.captain.usn}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Confirmation prompt */}
        <div className="shrink-0 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Click <strong className="font-semibold text-rose-600 dark:text-rose-400">Delete All {selectedTeams.length} {selectedTeams.length === 1 ? 'Team' : 'Teams'}</strong> to remove the entire selection from the database at once — no further confirmation is required.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs"
          >
            {isDeleting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Deleting {selectedTeams.length} Teams...</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                <span>Delete All {selectedTeams.length} {selectedTeams.length === 1 ? 'Team' : 'Teams'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
