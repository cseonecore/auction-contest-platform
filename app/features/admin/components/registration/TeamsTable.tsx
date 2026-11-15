'use client';

import { useMemo } from 'react';
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
}: TeamsTableProps) {
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

  const counts = useMemo(() => {
    return {
      all: teams.length,
      unlocked: teams.filter((t) => !t.locked).length,
      locked: teams.filter((t) => t.locked).length,
    };
  }, [teams]);

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

        {/* Filter Pills & Refresh */}
        <div className="flex items-center gap-2">
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

      {/* Table Container */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Team Name</th>
                <th className="px-4 py-3">Captain Name</th>
                <th className="px-4 py-3">Captain USN</th>
                <th className="px-4 py-3 text-center">Members</th>
                <th className="px-4 py-3">Registration Date</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredTeams.length > 0 ? (
                filteredTeams.map((team) => {
                  const regDate = new Date(team.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  });

                  return (
                    <tr
                      key={team.id}
                      onClick={() => onSelectTeam(team)}
                      className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 cursor-pointer transition-colors"
                    >
                      {/* Team Name */}
                      <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                        <div className="flex items-center gap-1.5">
                          <span>{team.name}</span>
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
                          {team.members.length}
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
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTeam(team);
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-md transition-colors"
                        >
                          View Roster &rarr;
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-zinc-500 dark:text-zinc-400">
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
      </div>
    </div>
  );
}
