'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { AdminAuthGuard } from '@/features/admin/components/AdminAuthGuard';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';
import {
  RegisteredTeamWithRelations,
  RegistrationLockFilter,
} from '@/features/admin/types/registration';
import {
  fetchRegisteredTeams,
  calculateRegistrationStats,
  updateTeamLockStatus,
  updateAllTeamsLockStatus,
} from '@/features/admin/services/registrationService';
import { RegistrationStats } from '@/features/admin/components/registration/RegistrationStats';
import { TeamsTable } from '@/features/admin/components/registration/TeamsTable';
import { TeamDetailsModal } from '@/features/admin/components/registration/TeamDetailsModal';

interface GlobalConfirmState {
  isOpen: boolean;
  action: 'lock' | 'unlock';
  affectedCount: number;
}

interface ActionFeedbackState {
  type: 'success' | 'error';
  message: string;
}

function AdminRegistrationContent() {
  const [teams, setTeams] = useState<RegisteredTeamWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [lockFilter, setLockFilter] = useState<RegistrationLockFilter>('all');
  const [selectedTeam, setSelectedTeam] = useState<RegisteredTeamWithRelations | null>(null);

  // Lock management states
  const [updatingLockTeamId, setUpdatingLockTeamId] = useState<string | null>(null);
  const [isGlobalUpdating, setIsGlobalUpdating] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedbackState | null>(null);
  const [globalConfirmModal, setGlobalConfirmModal] = useState<GlobalConfirmState | null>(null);

  const loadTeams = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const result = await fetchRegisteredTeams();
    if (!result.success) {
      setError(result.error || 'Failed to fetch registered teams.');
      setIsLoading(false);
      return;
    }

    setTeams(result.data || []);
    setIsLoading(false);
  }, []);

  // Effect to load teams on mount without synchronous setState
  useEffect(() => {
    let isMounted = true;

    async function init() {
      const result = await fetchRegisteredTeams();
      if (!isMounted) return;

      if (!result.success) {
        setError(result.error || 'Failed to fetch registered teams.');
        setIsLoading(false);
        return;
      }

      setTeams(result.data || []);
      setIsLoading(false);
    }

    void init();

    return () => {
      isMounted = false;
    };
  }, []);

  // Compute stats dynamically from the actual teams array
  const stats = useMemo(() => calculateRegistrationStats(teams), [teams]);

  // Unified concurrency flag: true when ANY lock operation is in flight
  const isAnyUpdating = updatingLockTeamId !== null || isGlobalUpdating;

  // Handler for individual team lock / unlock
  const handleToggleTeamLock = useCallback(
    async (teamId: string, currentLocked: boolean) => {
      // Concurrency guard: reject if any update is already running
      if (updatingLockTeamId !== null || isGlobalUpdating) return;

      setUpdatingLockTeamId(teamId);
      setActionFeedback(null);

      const targetLocked = !currentLocked;
      const result = await updateTeamLockStatus(teamId, targetLocked);

      if (!result.success) {
        setActionFeedback({
          type: 'error',
          message: result.error || 'Failed to update team lock status.',
        });
        setUpdatingLockTeamId(null);
        return;
      }

      // Update local state reactively
      setTeams((prev) =>
        prev.map((t) => (t.id === teamId ? { ...t, locked: targetLocked } : t))
      );

      // Keep open modal in sync if it represents this team
      setSelectedTeam((prev) =>
        prev && prev.id === teamId ? { ...prev, locked: targetLocked } : prev
      );

      const targetTeam = teams.find((t) => t.id === teamId);
      const teamName = targetTeam ? targetTeam.name : 'Team';
      setActionFeedback({
        type: 'success',
        message: `Team "${teamName}" was ${targetLocked ? 'locked' : 'unlocked'} successfully.`,
      });

      setUpdatingLockTeamId(null);
    },
    [updatingLockTeamId, isGlobalUpdating, teams]
  );

  // Open global confirmation modal after validating affected count and concurrency
  const handleOpenGlobalConfirm = useCallback(
    (action: 'lock' | 'unlock') => {
      // Concurrency guard: reject if any update is in flight
      if (updatingLockTeamId !== null || isGlobalUpdating) return;

      const affectedCount =
        action === 'lock'
          ? teams.filter((t) => !t.locked).length
          : teams.filter((t) => t.locked).length;

      if (affectedCount === 0) {
        setActionFeedback({
          type: 'error',
          message:
            action === 'lock'
              ? 'All teams are already locked.'
              : 'All teams are already unlocked.',
        });
        return;
      }

      setGlobalConfirmModal({
        isOpen: true,
        action,
        affectedCount,
      });
    },
    [teams, updatingLockTeamId, isGlobalUpdating]
  );

  // Execute global lock / unlock with double-submit and concurrency guards
  const handleExecuteGlobalLockUnlock = useCallback(async () => {
    // Concurrency guard: prevent duplicate submission or execution while busy
    if (!globalConfirmModal || isGlobalUpdating || updatingLockTeamId !== null) return;

    const targetLocked = globalConfirmModal.action === 'lock';
    setIsGlobalUpdating(true);
    setActionFeedback(null);

    const result = await updateAllTeamsLockStatus(targetLocked);

    if (!result.success) {
      setActionFeedback({
        type: 'error',
        message: result.error || `Failed to ${targetLocked ? 'lock' : 'unlock'} all teams.`,
      });
      setIsGlobalUpdating(false);
      setGlobalConfirmModal(null);
      return;
    }

    const count = result.data?.updatedCount ?? 0;

    // Reactively update all teams in state
    setTeams((prev) => prev.map((t) => ({ ...t, locked: targetLocked })));

    // Keep open modal in sync
    setSelectedTeam((prev) => (prev ? { ...prev, locked: targetLocked } : null));

    setActionFeedback({
      type: 'success',
      message: `Successfully ${targetLocked ? 'locked' : 'unlocked'} ${count} team(s).`,
    });

    setIsGlobalUpdating(false);
    setGlobalConfirmModal(null);
  }, [globalConfirmModal, isGlobalUpdating, updatingLockTeamId]);

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl text-xs text-red-800 dark:text-red-300 flex items-start justify-between">
          <div>
            <strong className="font-bold">Error Loading Teams: </strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadTeams}
            className="text-xs underline hover:text-red-900 ml-4 shrink-0 font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Action Feedback Banner (Success / Error) */}
      {actionFeedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs transition-all ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionFeedback.type === 'success' ? (
              <svg
                className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
            <span className="font-medium">{actionFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="text-xs font-semibold opacity-70 hover:opacity-100 ml-4 text-base leading-none"
          >
            &times;
          </button>
        </div>
      )}

      {/* KPI Stats Bar */}
      <RegistrationStats stats={stats} />

      {/* Global Team Lock Actions Toolbar */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-zinc-900 dark:text-zinc-100 text-sm">
              Global Registration Lock Actions
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
              Admin Only
            </span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Lock or unlock all registered teams in a single batch operation. Requires explicit confirmation.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Lock All Teams Button */}
          <button
            type="button"
            disabled={stats.unlockedTeams === 0 || isAnyUpdating || isLoading}
            onClick={() => handleOpenGlobalConfirm('lock')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              updatingLockTeamId
                ? 'Individual team update in progress'
                : isGlobalUpdating
                ? 'Global update in progress'
                : stats.unlockedTeams === 0
                ? 'All teams are already locked'
                : `Lock ${stats.unlockedTeams} unlocked teams`
            }
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
              />
            </svg>
            <span>Lock All ({stats.unlockedTeams})</span>
          </button>

          {/* Unlock All Teams Button */}
          <button
            type="button"
            disabled={stats.lockedTeams === 0 || isAnyUpdating || isLoading}
            onClick={() => handleOpenGlobalConfirm('unlock')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              updatingLockTeamId
                ? 'Individual team update in progress'
                : isGlobalUpdating
                ? 'Global update in progress'
                : stats.lockedTeams === 0
                ? 'All teams are already unlocked'
                : `Unlock ${stats.lockedTeams} locked teams`
            }
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
              />
            </svg>
            <span>Unlock All ({stats.lockedTeams})</span>
          </button>
        </div>
      </div>

      {/* Teams Table with Search, Filtering, and Inline Lock Actions */}
      <TeamsTable
        teams={teams}
        onSelectTeam={(team) => setSelectedTeam(team)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        lockFilter={lockFilter}
        onLockFilterChange={setLockFilter}
        onRefresh={loadTeams}
        isLoading={isLoading}
        onToggleLock={handleToggleTeamLock}
        updatingLockTeamId={updatingLockTeamId}
        isGlobalUpdating={isGlobalUpdating}
      />

      {/* Team Details Modal with Lock Action */}
      <TeamDetailsModal
        isOpen={selectedTeam !== null}
        onClose={() => {
          if (!updatingLockTeamId && !isGlobalUpdating) {
            setSelectedTeam(null);
          }
        }}
        team={selectedTeam}
        onToggleLock={handleToggleTeamLock}
        isUpdatingLock={updatingLockTeamId === selectedTeam?.id}
        isGlobalUpdating={isGlobalUpdating}
        isAnyUpdating={isAnyUpdating}
      />

      {/* Global Confirmation Modal */}
      {globalConfirmModal?.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => {
            if (!isGlobalUpdating) setGlobalConfirmModal(null);
          }}
        >
          <div
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  globalConfirmModal.action === 'lock'
                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                    : 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                }`}
              >
                {globalConfirmModal.action === 'lock' ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </div>

              <div className="flex-1">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                  {globalConfirmModal.action === 'lock' ? 'Lock All Teams?' : 'Unlock All Teams?'}
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                  {globalConfirmModal.action === 'lock' ? (
                    <>
                      This action will update{' '}
                      <strong className="text-zinc-900 dark:text-zinc-100 font-bold">
                        {globalConfirmModal.affectedCount} currently unlocked team(s)
                      </strong>{' '}
                      to <span className="font-semibold text-amber-600 dark:text-amber-400">Locked</span>.
                    </>
                  ) : (
                    <>
                      This action will update{' '}
                      <strong className="text-zinc-900 dark:text-zinc-100 font-bold">
                        {globalConfirmModal.affectedCount} currently locked team(s)
                      </strong>{' '}
                      to <span className="font-semibold text-emerald-600 dark:text-emerald-400">Unlocked</span>.
                    </>
                  )}
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">
                  Are you sure you want to proceed with this batch update?
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isGlobalUpdating}
                onClick={() => {
                  if (!isGlobalUpdating) setGlobalConfirmModal(null);
                }}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isGlobalUpdating || updatingLockTeamId !== null}
                onClick={() => void handleExecuteGlobalLockUnlock()}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  globalConfirmModal.action === 'lock'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isGlobalUpdating && (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                <span>
                  {globalConfirmModal.action === 'lock' ? 'Confirm Lock All' : 'Confirm Unlock All'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminRegistrationPage() {
  const { user, role, signOut } = useAdminAuth();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Registration"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight">
                Registration Management
              </h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                Monitor registered teams, inspect student rosters, and supervise contest capacity.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                Phase 2: Lock Management
              </span>
            </div>
          </div>
        </div>

        <AdminAuthGuard>
          <AdminRegistrationContent />
        </AdminAuthGuard>
      </main>
    </div>
  );
}
