'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { AdminSubnav } from '@/features/admin/components/AdminSubnav';
import { AdminAuthGuard } from '@/features/admin/components/AdminAuthGuard';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';
import {
  RegisteredTeamWithRelations,
  RegistrationLockFilter,
  RegistrationControlSettings,
} from '@/features/admin/types/registration';
import {
  fetchRegisteredTeams,
  calculateRegistrationStats,
  fetchRegistrationControlSettings,
  updateRegistrationOpenStatus,
  updateMaxTeamsCapacity,
  updateSelectedTeamsLockStatus,
  fetchDeletedTeamsCount,
  deleteTeams,
} from '@/features/admin/services/registrationService';
import { RegistrationStats } from '@/features/admin/components/registration/RegistrationStats';
import { TeamsTable } from '@/features/admin/components/registration/TeamsTable';
import { TeamDetailsModal } from '@/features/admin/components/registration/TeamDetailsModal';
import { TeamDeleteModal } from '@/features/admin/components/registration/TeamDeleteModal';
import { exportTeamDetailsToExcel } from '@/features/admin/services/registrationExportService';

interface ControlConfirmModalState {
  isOpen: boolean;
  type: 'toggle_status' | 'update_capacity';
  targetStatus?: boolean;
  targetCapacity?: number;
  currentCapacity?: number;
  registeredCount?: number;
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

  const [actionFeedback, setActionFeedback] = useState<ActionFeedbackState | null>(null);

  // Registration control and capacity states (Phase 3A)
  const [controlSettings, setControlSettings] = useState<RegistrationControlSettings>({
    isRegistrationOpen: true,
    maxTeams: 60,
  });
  const [isEditingCapacity, setIsEditingCapacity] = useState(false);
  const [capacityInputValue, setCapacityInputValue] = useState('60');
  const [isUpdatingControl, setIsUpdatingControl] = useState(false);
  const [controlConfirmModal, setControlConfirmModal] = useState<ControlConfirmModalState | null>(null);

  // Phase 5: Selection, Bulk Actions, and Safe Team Deletion States
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [deletedTeamsCount, setDeletedTeamsCount] = useState<number>(0);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeletingTeams, setIsDeletingTeams] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  // Excel export state
  const [isExporting, setIsExporting] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [teamsRes, settingsRes, deletedCountRes] = await Promise.all([
      fetchRegisteredTeams(),
      fetchRegistrationControlSettings(),
      fetchDeletedTeamsCount(),
    ]);

    if (!teamsRes.success) {
      setError(teamsRes.error || 'Failed to fetch registered teams.');
    } else {
      setTeams(teamsRes.data || []);
    }

    if (settingsRes.success && settingsRes.data) {
      setControlSettings(settingsRes.data);
      setCapacityInputValue(settingsRes.data.maxTeams.toString());
    }

    if (deletedCountRes.success && typeof deletedCountRes.data === 'number') {
      setDeletedTeamsCount(deletedCountRes.data);
    }

    setIsLoading(false);
  }, []);

  // Effect to load teams and registration settings on mount without synchronous setState
  useEffect(() => {
    let isMounted = true;

    async function init() {
      const [teamsRes, settingsRes, deletedCountRes] = await Promise.all([
        fetchRegisteredTeams(),
        fetchRegistrationControlSettings(),
        fetchDeletedTeamsCount(),
      ]);
      if (!isMounted) return;

      if (!teamsRes.success) {
        setError(teamsRes.error || 'Failed to fetch registered teams.');
      } else {
        setTeams(teamsRes.data || []);
      }

      if (settingsRes.success && settingsRes.data) {
        setControlSettings(settingsRes.data);
        setCapacityInputValue(settingsRes.data.maxTeams.toString());
      }

      if (deletedCountRes.success && typeof deletedCountRes.data === 'number') {
        setDeletedTeamsCount(deletedCountRes.data);
      }

      setIsLoading(false);
    }

    void init();

    return () => {
      isMounted = false;
    };
  }, []);

  // Compute stats dynamically from the actual teams array, control settings, and deleted teams count
  const stats = useMemo(
    () => calculateRegistrationStats(teams, controlSettings, deletedTeamsCount),
    [teams, controlSettings, deletedTeamsCount]
  );

  // Unified concurrency flag: true when ANY control, deletion, or export operation is in flight
  const isAnyUpdating = isUpdatingControl || isDeletingTeams || isExporting;

  // Phase 5: Selection Handlers
  const handleToggleSelectTeam = useCallback((teamId: string) => {
    setSelectedTeamIds((prev) =>
      prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId]
    );
  }, []);

  const handleSelectAll = useCallback((teamIds: string[]) => {
    setSelectedTeamIds(teamIds);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedTeamIds([]);
  }, []);

  // Lock or unlock teams and verify the change persisted.
  const applySelectedLock = useCallback(
    async (targetLocked: boolean, teamIds?: string[]) => {
      const ids = teamIds ?? selectedTeamIds;
      if (ids.length === 0 || isDeletingTeams) return;

      setActionFeedback(null);
      setIsDeletingTeams(true);

      const result = await updateSelectedTeamsLockStatus(ids, targetLocked);

      if (!result.success) {
        setActionFeedback({
          type: 'error',
          message: result.error || `Failed to ${targetLocked ? 'lock' : 'unlock'} selected teams.`,
        });
        setIsDeletingTeams(false);
        return;
      }

      // Re-read from the database so the table shows the persisted state.
      const refreshed = await fetchRegisteredTeams();

      if (!refreshed.success || !refreshed.data) {
        await loadData();
        setActionFeedback({
          type: 'error',
          message:
            refreshed.error ||
            `Teams were ${targetLocked ? 'locked' : 'unlocked'}, but reloading them failed. Refresh the page.`,
        });
        setIsDeletingTeams(false);
        return;
      }

      setTeams(refreshed.data);

      const idSet = new Set(ids);
      const notPersisted = refreshed.data.filter(
        (t) => idSet.has(t.id) && t.locked !== targetLocked
      ).length;

      if (notPersisted > 0) {
        setActionFeedback({
          type: 'error',
          message: `${targetLocked ? 'Lock' : 'Unlock'} did not persist for ${notPersisted} team(s): the database is still re-locking them automatically. Run migration 034_manual_team_locks.sql in Supabase, then try again.`,
        });
      } else {
        const count = result.data?.updatedCount ?? ids.length;
        setActionFeedback({
          type: 'success',
          message: targetLocked
            ? `Locked ${count} team(s). They are now protected from deletion.`
            : `Unlocked ${count} team(s). They are now deletable.`,
        });
      }

      setIsDeletingTeams(false);
    },
    [selectedTeamIds, isDeletingTeams, loadData]
  );

  const handleUnlockSelectedTeams = useCallback(
    (teamIds?: string[]) => applySelectedLock(false, teamIds),
    [applySelectedLock]
  );

  const handleLockSelectedTeams = useCallback(
    (teamIds?: string[]) => applySelectedLock(true, teamIds),
    [applySelectedLock]
  );

  // Open Delete Confirmation Modal
  // Locking rules: `locked` is an admin-controlled flag. Locked teams are
  // protected from deletion; unlock them first to delete.
  const handleRequestOpenDeleteModal = useCallback(() => {
    if (selectedTeamIds.length === 0 || isAnyUpdating) return;

    const idSet = new Set(selectedTeamIds);
    const targetTeams = teams.filter((t) => idSet.has(t.id));
    const lockedTeams = targetTeams.filter((t) => t.locked);

    if (lockedTeams.length > 0) {
      setActionFeedback({
        type: 'error',
        message: `Cannot delete locked teams. ${lockedTeams.length} selected team(s) are still locked — use "Unlock Selected Teams" first.`,
      });
      return;
    }

    setDeleteErrorMessage(null);
    setIsDeleteModalOpen(true);
  }, [selectedTeamIds, isAnyUpdating, teams]);

  // Phase 5: Execute Permanent Deletion through RPC
  const handleConfirmDelete = useCallback(async () => {
    if (selectedTeamIds.length === 0 || isDeletingTeams) return;

    setIsDeletingTeams(true);
    setDeleteErrorMessage(null);

    const result = await deleteTeams(selectedTeamIds);

    if (!result.success) {
      setDeleteErrorMessage(result.error || 'Failed to delete selected teams.');
      setIsDeletingTeams(false);
      return;
    }

    const deletedCount = result.data?.deleted_count ?? selectedTeamIds.length;

    // Close modal, clear selections, and reset loading state
    setIsDeleteModalOpen(false);
    setSelectedTeamIds([]);
    setIsDeletingTeams(false);

    // Refresh database records (teams, control settings, deleted teams count)
    await loadData();

    setActionFeedback({
      type: 'success',
      message: `Deleted ${deletedCount} team(s) in a single operation. Audit records have been preserved in public.audit_log.`,
    });
  }, [selectedTeamIds, isDeletingTeams, loadData]);

  // Excel Export Handler (Task 1)
  const handleExportTeamDetails = useCallback(async () => {
    if (isExporting || isLoading) return;

    if (teams.length === 0) {
      setActionFeedback({
        type: 'error',
        message: 'No active registered teams available for export.',
      });
      return;
    }

    setIsExporting(true);
    setActionFeedback(null);

    try {
      const result = await exportTeamDetailsToExcel(teams);

      if (!result.success) {
        setActionFeedback({
          type: 'error',
          message: result.error || 'Failed to export team details to Excel.',
        });
      } else {
        setActionFeedback({
          type: 'success',
          message: `Successfully generated and downloaded "${result.filename}" (${result.totalRows} team(s) with up to ${result.maxMembersInAnyTeam} members).`,
        });
      }
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred during Excel export.',
      });
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, isLoading, teams]);

  // Request to open or close registration (opens confirmation dialog)
  const handleRequestToggleStatus = useCallback(() => {
    if (isAnyUpdating) return;
    setActionFeedback(null);

    setControlConfirmModal({
      isOpen: true,
      type: 'toggle_status',
      targetStatus: !controlSettings.isRegistrationOpen,
    });
  }, [isAnyUpdating, controlSettings.isRegistrationOpen]);

  // Request to update maximum team capacity (validates and opens confirmation dialog)
  const handleRequestSaveCapacity = useCallback(() => {
    if (isAnyUpdating) return;
    setActionFeedback(null);

    const parsed = parseInt(capacityInputValue.trim(), 10);

    if (isNaN(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      setActionFeedback({
        type: 'error',
        message: 'Maximum team capacity must be a positive whole number.',
      });
      return;
    }

    if (parsed < stats.totalTeams) {
      setActionFeedback({
        type: 'error',
        message: `Maximum capacity (${parsed}) cannot be lower than the ${stats.totalTeams} teams already registered.`,
      });
      return;
    }

    if (parsed === controlSettings.maxTeams) {
      setIsEditingCapacity(false);
      return;
    }

    setControlConfirmModal({
      isOpen: true,
      type: 'update_capacity',
      targetCapacity: parsed,
      currentCapacity: controlSettings.maxTeams,
      registeredCount: stats.totalTeams,
    });
  }, [
    isAnyUpdating,
    capacityInputValue,
    stats.totalTeams,
    controlSettings.maxTeams,
  ]);

  // Execute confirmed registration control action (status or capacity)
  const handleExecuteControlConfirm = useCallback(async () => {
    if (!controlConfirmModal || isUpdatingControl) return;

    setIsUpdatingControl(true);
    setActionFeedback(null);

    if (controlConfirmModal.type === 'toggle_status') {
      const targetStatus = controlConfirmModal.targetStatus ?? false;
      const res = await updateRegistrationOpenStatus(targetStatus);

      if (!res.success) {
        setActionFeedback({
          type: 'error',
          message:
            res.error ||
            `Failed to ${targetStatus ? 'open' : 'close'} team registration.`,
        });
        setIsUpdatingControl(false);
        setControlConfirmModal(null);
        return;
      }

      setControlSettings((prev) => ({
        ...prev,
        isRegistrationOpen: targetStatus,
      }));

      setActionFeedback({
        type: 'success',
        message: targetStatus
          ? 'Team registration is now OPEN. Participants can submit new registrations.'
          : 'Team registration is now CLOSED. Prospective registrations are halted.',
      });
    } else if (controlConfirmModal.type === 'update_capacity') {
      const targetCap = controlConfirmModal.targetCapacity ?? controlSettings.maxTeams;
      const res = await updateMaxTeamsCapacity(targetCap, stats.totalTeams);

      if (!res.success) {
        setActionFeedback({
          type: 'error',
          message: res.error || 'Failed to update maximum team capacity.',
        });
        setIsUpdatingControl(false);
        setControlConfirmModal(null);
        return;
      }

      setControlSettings((prev) => ({
        ...prev,
        maxTeams: targetCap,
      }));
      setCapacityInputValue(targetCap.toString());
      setIsEditingCapacity(false);

      setActionFeedback({
        type: 'success',
        message: `Maximum team capacity successfully updated to ${targetCap} teams.`,
      });
    }

    setIsUpdatingControl(false);
    setControlConfirmModal(null);
  }, [controlConfirmModal, isUpdatingControl, controlSettings.maxTeams, stats.totalTeams]);

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
            onClick={loadData}
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

      {/* Global Registration Status & Capacity Management (Phase 3A) */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Global Registration &amp; Capacity Control
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {controlSettings.isRegistrationOpen ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Registration is OPEN
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                Registration is CLOSED
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Left: Open / Close Registration Action */}
          <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between gap-3">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block">
                Registration Gateway
              </span>
            </div>

            <div>
              {controlSettings.isRegistrationOpen ? (
                <button
                  type="button"
                  disabled={isAnyUpdating || isLoading}
                  onClick={handleRequestToggleStatus}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-rose-600 hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                    />
                  </svg>
                  <span>Close Registration</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isAnyUpdating || isLoading}
                  onClick={handleRequestToggleStatus}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                    />
                  </svg>
                  <span>Open Registration</span>
                </button>
              )}
            </div>
          </div>

          {/* Right: Maximum Team Capacity Configuration */}
          <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Maximum Contest Capacity
                </span>
                <span className="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">
                  Current: {controlSettings.maxTeams} Teams
                </span>
              </div>
            </div>

            <div>
              {isEditingCapacity ? (
                <div className="flex items-center gap-2">
                  <div className="relative max-w-[130px]">
                    <input
                      type="number"
                      min={stats.totalTeams}
                      step={1}
                      value={capacityInputValue}
                      onChange={(e) => setCapacityInputValue(e.target.value)}
                      disabled={isAnyUpdating}
                      placeholder="Capacity"
                      className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={isAnyUpdating}
                    onClick={handleRequestSaveCapacity}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 shadow-xs"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={isAnyUpdating}
                    onClick={() => {
                      setCapacityInputValue(controlSettings.maxTeams.toString());
                      setIsEditingCapacity(false);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isAnyUpdating || isLoading}
                  onClick={() => {
                    setCapacityInputValue(controlSettings.maxTeams.toString());
                    setIsEditingCapacity(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                >
                  <svg
                    className="w-3.5 h-3.5 text-zinc-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                  <span>Edit Capacity Limit</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Teams Table with Search, Filtering, Lock Status, and Phase 5 Bulk Selection */}
      <TeamsTable
        teams={teams}
        onSelectTeam={(team) => setSelectedTeam(team)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        lockFilter={lockFilter}
        onLockFilterChange={setLockFilter}
        onRefresh={loadData}
        isLoading={isLoading}
        selectedTeamIds={selectedTeamIds}
        onToggleSelectTeam={handleToggleSelectTeam}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        onRequestDelete={handleRequestOpenDeleteModal}
        onUnlockSelectedTeams={handleUnlockSelectedTeams}
        onLockSelectedTeams={handleLockSelectedTeams}
        onExport={handleExportTeamDetails}
        isExporting={isExporting}
      />

      {/* Team Details Modal */}
      <TeamDetailsModal
        isOpen={selectedTeam !== null}
        onClose={() => setSelectedTeam(null)}
        team={selectedTeam}
      />

      {/* Phase 5B: Team Delete Confirmation Modal */}
      <TeamDeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          if (!isDeletingTeams) {
            setIsDeleteModalOpen(false);
            setDeleteErrorMessage(null);
          }
        }}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeletingTeams}
        selectedTeams={teams.filter((t) => selectedTeamIds.includes(t.id))}
        errorMessage={deleteErrorMessage}
      />

      {/* Registration Control & Capacity Confirmation Modal (Phase 3A) */}
      {controlConfirmModal?.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => {
            if (!isUpdatingControl) setControlConfirmModal(null);
          }}
        >
          <div
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  controlConfirmModal.type === 'toggle_status'
                    ? controlConfirmModal.targetStatus
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                    : 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                }`}
              >
                {controlConfirmModal.type === 'toggle_status' ? (
                  controlConfirmModal.targetStatus ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                      />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                      />
                    </svg>
                  )
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                )}
              </div>

              <div className="flex-1">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                  {controlConfirmModal.type === 'toggle_status'
                    ? controlConfirmModal.targetStatus
                      ? 'Open Team Registration?'
                      : 'Close Team Registration?'
                    : 'Update Maximum Team Capacity?'}
                </h3>

                <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-2 leading-relaxed">
                  {controlConfirmModal.type === 'toggle_status' ? (
                    controlConfirmModal.targetStatus ? (
                      <p>
                        Are you sure you want to{' '}
                        <strong className="text-emerald-600 dark:text-emerald-400">OPEN</strong>{' '}
                        registration? Prospective teams will be allowed to submit new registrations up
                        to the contest capacity limit of {controlSettings.maxTeams} teams.
                      </p>
                    ) : (
                      <p>
                        Are you sure you want to{' '}
                        <strong className="text-rose-600 dark:text-rose-400">CLOSE</strong>{' '}
                        registration? When closed, prospective teams will be blocked from submitting new
                        registrations.
                      </p>
                    )
                  ) : (
                    <p>
                      Are you sure you want to change maximum team capacity from{' '}
                      <span className="line-through text-zinc-500 font-mono">
                        {controlConfirmModal.currentCapacity}
                      </span>{' '}
                      to{' '}
                      <strong className="text-blue-600 dark:text-blue-400 font-bold font-mono">
                        {controlConfirmModal.targetCapacity} teams
                      </strong>
                      ?
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isUpdatingControl}
                onClick={() => {
                  if (!isUpdatingControl) setControlConfirmModal(null);
                }}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdatingControl}
                onClick={() => void handleExecuteControlConfirm()}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs ${
                  controlConfirmModal.type === 'toggle_status'
                    ? controlConfirmModal.targetStatus
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isUpdatingControl && (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                <span>
                  {controlConfirmModal.type === 'toggle_status'
                    ? controlConfirmModal.targetStatus
                      ? 'Confirm Open Registration'
                      : 'Confirm Close Registration'
                    : 'Confirm & Save Capacity'}
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
    <div className="min-h-screen bg-[#0d0d0d] text-white flex flex-col font-sans select-none">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Registration"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        <AdminSubnav currentSection="registration" />

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
          </div>
        </div>

        <AdminAuthGuard>
          <AdminRegistrationContent />
        </AdminAuthGuard>
      </main>
    </div>
  );
}
