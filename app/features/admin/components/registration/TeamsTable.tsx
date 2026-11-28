'use client';

import { useState, useMemo } from 'react';
import {
  RegisteredTeamWithRelations,
  RegistrationLockFilter,
} from '../../types/registration';

interface TeamsTableProps {
  teams: RegisteredTeamWithRelations[];
  onSelectTeam: (team: RegisteredTeamWithRelations) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  lockFilter: RegistrationLockFilter;
  onLockFilterChange: (f: RegistrationLockFilter) => void;
  onRefresh: () => void;
  isLoading: boolean;

  // Selection & Bulk Action Props (Phase 5)
  selectedTeamIds?: string[];
  onToggleSelectTeam?: (teamId: string) => void;
  onSelectAll?: (teamIds: string[]) => void;
  onClearSelection?: () => void;
  onRequestDelete?: () => void;

  onUnlockSelectedTeams?: (teamIds: string[]) => void | Promise<unknown>;
  onLockSelectedTeams?: (teamIds: string[]) => void | Promise<unknown>;

  // Excel Export Props
  onExport?: () => void;
  isExporting?: boolean;
}

export function TeamsTable({
  teams,
  onSelectTeam,
  searchQuery,
  onSearchChange,
  lockFilter,
  onLockFilterChange,
  onRefresh,
  isLoading,
  selectedTeamIds = [],
  onToggleSelectTeam,
  onSelectAll,
  onClearSelection,
  onRequestDelete,
  onUnlockSelectedTeams,
  onLockSelectedTeams,
  onExport,
  isExporting = false,
}: TeamsTableProps) {
  // Pagination states (default: 25 items per page)
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Track in-flight bulk lock / unlock operations
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false);
  const [isLocking, setIsLocking] = useState<boolean>(false);

  const isAnyUpdating = false;

  // Filtered and searched teams
  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      // 1. Lock filter
      if (lockFilter === 'locked' && !team.locked) return false;
      if (lockFilter === 'unlocked' && team.locked) return false;

      // 2. Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();

      const teamNameMatch = team.name.toLowerCase().includes(q);
      const captainNameMatch = team.captain?.member.name.toLowerCase().includes(q);
      const captainUsnMatch = team.captain?.usn.toLowerCase().includes(q);
      const membersMatch = team.members.some(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.parsedUsn.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q)
      );

      return teamNameMatch || captainNameMatch || captainUsnMatch || membersMatch;
    });
  }, [teams, lockFilter, searchQuery]);

  // Reset to page 1 whenever filters or search query changes without cascading renders
  const filterKey = `${searchQuery}::${lockFilter}::${pageSize}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setCurrentPage(1);
  }

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredTeams.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedTeams = useMemo(() => {
    const startIdx = (safeCurrentPage - 1) * pageSize;
    return filteredTeams.slice(startIdx, startIdx + pageSize);
  }, [filteredTeams, safeCurrentPage, pageSize]);

  // Counts for filter pills
  const counts = useMemo(() => {
    return {
      all: teams.length,
      unlocked: teams.filter((t) => !t.locked).length,
      locked: teams.filter((t) => t.locked).length,
    };
  }, [teams]);

  // Selection analysis for selected teams
  const selectedTeamsList = useMemo(() => {
    const idSet = new Set(selectedTeamIds);
    return teams.filter((t) => idSet.has(t.id));
  }, [teams, selectedTeamIds]);

  const selectedCount = selectedTeamIds.length;
  const lockedSelectedIds = selectedTeamsList.filter((t) => t.locked).map((t) => t.id);
  const unlockedSelectedIds = selectedTeamsList.filter((t) => !t.locked).map((t) => t.id);
  const lockedSelectedCount = lockedSelectedIds.length;
  const unlockedSelectedCount = unlockedSelectedIds.length;
  // Locked teams are protected from deletion until an admin unlocks them.
  const hasLockedSelected = lockedSelectedCount > 0;
  const hasUnlockedSelected = unlockedSelectedCount > 0;
  const isLockBusy = isLocking || isUnlocking;

  // Check if all paginated teams on current page are selected
  const paginatedIds = useMemo(() => paginatedTeams.map((t) => t.id), [paginatedTeams]);
  const isAllPaginatedSelected =
    paginatedIds.length > 0 && paginatedIds.every((id) => selectedTeamIds.includes(id));
  const isSomePaginatedSelected =
    paginatedIds.some((id) => selectedTeamIds.includes(id)) && !isAllPaginatedSelected;

  const handleToggleSelectAllPage = () => {
    if (!onSelectAll) return;
    if (isAllPaginatedSelected) {
      // Deselect page items
      const newSelected = selectedTeamIds.filter((id) => !paginatedIds.includes(id));
      onSelectAll(newSelected);
    } else {
      // Add page items to selection
      const newSelectedSet = new Set([...selectedTeamIds, ...paginatedIds]);
      onSelectAll(Array.from(newSelectedSet));
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls Bar: Search & Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by team name, captain, or USN..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <svg
            className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-2 text-zinc-400 hover:text-zinc-600 text-sm"
            >
              &times;
            </button>
          )}
        </div>

        {/* Filter Pills, Export Button & Refresh */}
        <div className="flex items-center flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 p-0.5 bg-zinc-100 dark:bg-zinc-800 text-xs">
            <button
              type="button"
              onClick={() => onLockFilterChange('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                lockFilter === 'all'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              All ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => onLockFilterChange('unlocked')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                lockFilter === 'unlocked'
                  ? 'bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              Unlocked ({counts.unlocked})
            </button>
            <button
              type="button"
              onClick={() => onLockFilterChange('locked')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                lockFilter === 'locked'
                  ? 'bg-white dark:bg-zinc-900 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              Locked ({counts.locked})
            </button>
          </div>

          {/* Download Team Details (.xlsx) Button */}
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              disabled={isExporting || isLoading || teams.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
              title="Download all registered teams and members as an Excel file (.xlsx)"
            >
              {isExporting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-emerald-600 dark:border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  <span>Exporting...</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span>Download Team Details (.xlsx)</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
            title="Refresh Teams"
          >
            <svg
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Selected Teams Bulk Actions Bar (Phase 5) */}
      {selectedCount > 0 && (
        <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 flex flex-col md:flex-row md:items-center md:justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center flex-wrap gap-2.5">
            <span className="font-bold text-zinc-900 dark:text-zinc-100 text-xs">
              {selectedCount} {selectedCount === 1 ? 'team' : 'teams'} selected
            </span>

            {/* Deletion eligibility pill (locked ⇒ not deletable) */}
            {hasLockedSelected ? (
              <span
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
                title="Locked teams cannot be deleted."
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                {lockedSelectedCount} locked — unlock to delete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                All {selectedCount} unlocked — Deletable
              </span>
            )}

            {/* Lock Selected Teams Button */}
            {hasUnlockedSelected && (
              <button
                type="button"
                disabled={isAnyUpdating || isLockBusy}
                onClick={() => {
                  setIsLocking(true);
                  Promise.resolve(onLockSelectedTeams?.(unlockedSelectedIds)).finally(() =>
                    setIsLocking(false)
                  );
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shadow-xs ${isLocking ? 'opacity-50 not-allowed' : 'bg-amber-600 text-white hover:bg-amber-700 cursor-pointer'}`}
                title="Lock selected teams (protect them from deletion)"
              >
                {isLocking ? (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                )}
                <span>Lock Selected Teams ({unlockedSelectedCount})</span>
              </button>
            )}

            {/* Unlock Selected Teams Button */}
            {hasLockedSelected && (
              <button
                type="button"
                disabled={isAnyUpdating || isLockBusy}
                onClick={() => {
                  setIsUnlocking(true);
                  Promise.resolve(onUnlockSelectedTeams?.(lockedSelectedIds)).finally(() =>
                    setIsUnlocking(false)
                  );
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shadow-xs ${isUnlocking ? 'opacity-50 not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer'}`}
                title="Unlock selected teams (make them deletable)"
              >
                {isUnlocking ? (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                    />
                  </svg>
                )}
                <span>Unlock Selected Teams ({lockedSelectedCount})</span>
              </button>
            )}

            {onClearSelection && (
              <button
                type="button"
                onClick={onClearSelection}
                disabled={isAnyUpdating}
                className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline underline-offset-2 ml-1"
              >
                Deselect all
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center flex-wrap gap-2">
            {/* Delete Selected Teams Button */}
            {onRequestDelete && (
              <button
                type="button"
                disabled={hasLockedSelected || isAnyUpdating || isLockBusy}
                onClick={onRequestDelete}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors shadow-xs ${
                  !hasLockedSelected && !isAnyUpdating && !isLockBusy
                    ? 'bg-rose-600 text-white hover:bg-rose-700 cursor-pointer'
                    : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed border border-zinc-300 dark:border-zinc-700'
                }`}
                title={
                  hasLockedSelected
                    ? 'Deletion disabled: locked teams cannot be deleted. Unlock them first.'
                    : `Permanently delete ${selectedCount} unlocked team(s)`
                }
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                <span>Delete Selected Teams ({selectedCount})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table Container */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                {/* Checkbox column */}
                <th className="w-10 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={isAllPaginatedSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomePaginatedSelected;
                    }}
                    onChange={handleToggleSelectAllPage}
                    disabled={paginatedTeams.length === 0 || isAnyUpdating}
                    className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                    title="Select all teams on this page"
                  />
                </th>
                <th className="px-4 py-3">Team Name &amp; ID</th>
                <th className="px-4 py-3">Captain Name</th>
                <th className="px-4 py-3">Captain USN</th>
                <th className="px-4 py-3 text-center">Members</th>
                <th className="px-4 py-3">Registration Date</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {paginatedTeams.length > 0 ? (
                paginatedTeams.map((team) => {
                  const isSelected = selectedTeamIds.includes(team.id);
                  const regDate = new Date(team.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  });

                  return (
                    <tr
                      key={team.id}
                      onClick={() => onSelectTeam(team)}
                      className={`hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/40 dark:bg-blue-950/20'
                          : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td
                        className="w-10 px-4 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelectTeam && onToggleSelectTeam(team.id)}
                          disabled={isAnyUpdating}
                          className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                        />
                      </td>

                      {/* Team Name & ID */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {team.name}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-400">
                            ID: {team.id.substring(0, 8)}...
                          </span>
                        </div>
                      </td>

                      {/* Captain Name */}
                      <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                        {team.captain ? (
                          <span className="font-medium">{team.captain.member.name}</span>
                        ) : (
                          <span className="text-zinc-400 italic">Unassigned</span>
                        )}
                      </td>

                      {/* Captain USN */}
                      <td className="px-4 py-3 font-mono text-zinc-600 dark:text-zinc-400">
                        {team.captain ? (
                          <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-800 dark:text-zinc-200 text-[11px]">
                            {team.captain.usn}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      {/* Member Count */}
                      <td className="px-4 py-3 text-center font-mono">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium">
                          {team.members.length} / 4
                        </span>
                      </td>

                      {/* Registration Date */}
                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                        {regDate}
                      </td>

                      {/* Lock Status */}
                      <td className="px-4 py-3 text-center">
                        {team.locked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Locked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Unlocked
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectTeam(team);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-md transition-colors whitespace-nowrap"
                          >
                            View Roster &rarr;
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-zinc-500 dark:text-zinc-400">
                    {teams.length === 0 ? (
                      <div className="space-y-1">
                        <p className="font-semibold text-zinc-700 dark:text-zinc-300">
                          No teams registered yet
                        </p>
                        <p className="text-xs text-zinc-400">
                          Participant registrations will automatically appear here once submitted.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="font-semibold text-zinc-700 dark:text-zinc-300">
                          No matching teams found
                        </p>
                        <p className="text-xs text-zinc-400">
                          Try adjusting your search query or lock status filter.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {filteredTeams.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
            {/* Range info */}
            <div>
              Showing{' '}
              <strong className="text-zinc-900 dark:text-zinc-100">
                {Math.min(filteredTeams.length, (safeCurrentPage - 1) * pageSize + 1)}
              </strong>{' '}
              to{' '}
              <strong className="text-zinc-900 dark:text-zinc-100">
                {Math.min(filteredTeams.length, safeCurrentPage * pageSize)}
              </strong>{' '}
              of{' '}
              <strong className="text-zinc-900 dark:text-zinc-100">
                {filteredTeams.length}
              </strong>{' '}
              teams
            </div>

            {/* Page Size & Page Navigation */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px]">Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="px-2 py-1 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>

              {/* Navigation buttons */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  &larr; Prev
                </button>

                <span className="px-2 font-mono text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                  {safeCurrentPage} / {totalPages}
                </span>

                <button
                  type="button"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next &rarr;
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
