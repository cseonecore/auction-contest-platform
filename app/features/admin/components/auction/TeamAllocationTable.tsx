'use client';

/**
 * TeamAllocationTable Component
 * Bid2Build (Auction Contest Platform) — Phase 4B.4B
 *
 * Tracks team quota completion and wallet economy per Rule Book §5.3 & §9.8:
 *  - Both Round 1 and Round 2 won topics
 *  - Wallet balance and total points spent (only deducted upon winning)
 *  - Projected evaluation bonus points: Math.floor(wallet_balance / 10)
 *  - Quota completion status (Both Won, 1 Won, None Won)
 *  - Search by team name or topic title
 *  - Filter by quota status
 *  - Sort by Team Name, Balance, Spent, or Status
 */

import React, { useState, useMemo } from 'react';
import type {
  AdminTeamAuctionAllocation,
  AllocationFilter,
  AllocationSortField,
  SortDirection,
} from '../../types/auctionAdmin';

interface TeamAllocationTableProps {
  allocations: AdminTeamAuctionAllocation[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
}

export function TeamAllocationTable({
  allocations,
  isLoading,
  onRefresh,
}: TeamAllocationTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AllocationFilter>('all');
  const [sortField, setSortField] = useState<AllocationSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Quota summary counts
  const counts = useMemo(() => {
    return {
      all: allocations.length,
      completed: allocations.filter((t) => t.allocation_completed).length,
      partial: allocations.filter((t) => (t.round1_won && !t.round2_won) || (!t.round1_won && t.round2_won)).length,
      none: allocations.filter((t) => !t.round1_won && !t.round2_won).length,
    };
  }, [allocations]);

  // Filtering
  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return allocations.filter((team) => {
      // Status filter
      if (statusFilter === 'completed' && !team.allocation_completed) return false;
      if (
        statusFilter === 'partial' &&
        !(
          (team.round1_won && !team.round2_won) ||
          (!team.round1_won && team.round2_won)
        )
      ) {
        return false;
      }
      if (statusFilter === 'none' && (team.round1_won || team.round2_won)) return false;

      // Search query
      if (q) {
        const matchesName = team.team_name.toLowerCase().includes(q);
        const matchesR1Topic = team.round1_slot?.topic_title.toLowerCase().includes(q) ?? false;
        const matchesR2Topic = team.round2_slot?.topic_title.toLowerCase().includes(q) ?? false;

        if (!matchesName && !matchesR1Topic && !matchesR2Topic) {
          return false;
        }
      }

      return true;
    });
  }, [allocations, statusFilter, searchQuery]);

  // Sorting
  const sortedTeams = useMemo(() => {
    return [...filteredTeams].sort((a, b) => {
      let comp = 0;
      switch (sortField) {
        case 'name':
          comp = a.team_name.localeCompare(b.team_name);
          break;
        case 'balance':
          comp = a.wallet_balance - b.wallet_balance;
          break;
        case 'spent':
          comp = a.total_spent - b.total_spent;
          break;
        case 'status': {
          const aVal = a.allocation_completed ? 2 : a.round1_won || a.round2_won ? 1 : 0;
          const bVal = b.allocation_completed ? 2 : b.round1_won || b.round2_won ? 1 : 0;
          comp = aVal - bVal;
          break;
        }
      }
      return sortDirection === 'asc' ? comp : -comp;
    });
  }, [filteredTeams, sortField, sortDirection]);

  const handleSortChange = (field: AllocationSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortIndicator = (field: AllocationSortField) => {
    if (sortField !== field) {
      return (
        <svg className="w-3 h-3 text-zinc-300 dark:text-zinc-600 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg className="w-3 h-3 text-blue-600 dark:text-blue-400 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 text-blue-600 dark:text-blue-400 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  return (
    <div className="space-y-4">
      {/* ─────────────────────────────────────────────────────────────
          1. Filter & Search Controls
      ────────────────────────────────────────────────────────────── */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <svg
            className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search teams or won topics..."
            className="w-full pl-9 pr-8 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-sm leading-none"
            >
              &times;
            </button>
          )}
        </div>

        {/* Status Filters */}
        <div className="flex items-center gap-1.5 flex-wrap self-start md:self-auto">
          {(
            [
              { id: 'all', label: 'All Teams', count: counts.all },
              { id: 'completed', label: 'Quota Complete (2/2)', count: counts.completed },
              { id: 'partial', label: 'Partial (1/2)', count: counts.partial },
              { id: 'none', label: 'None (0/2)', count: counts.none },
            ] as const
          ).map((filter) => {
            const active = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatusFilter(filter.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-2xs'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                <span>{filter.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  active ? 'bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                }`}>
                  {filter.count}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors shadow-2xs ml-1"
            title="Refresh allocations from database"
          >
            {isLoading ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. Allocation Table
      ────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold">
              <tr>
                <th
                  scope="col"
                  onClick={() => handleSortChange('name')}
                  className="py-3 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 select-none"
                >
                  Team Name {renderSortIndicator('name')}
                </th>
                <th scope="col" className="py-3 px-4">
                  Round 1 Won Topic (Easy)
                </th>
                <th scope="col" className="py-3 px-4">
                  Round 2 Won Topic (Hard)
                </th>
                <th
                  scope="col"
                  onClick={() => handleSortChange('spent')}
                  className="py-3 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 select-none text-right font-mono"
                >
                  Spent {renderSortIndicator('spent')}
                </th>
                <th
                  scope="col"
                  onClick={() => handleSortChange('balance')}
                  className="py-3 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 select-none text-right font-mono"
                >
                  Balance {renderSortIndicator('balance')}
                </th>
                <th scope="col" className="py-3 px-4 text-center font-mono" title="Math.floor(balance / 10) per Rule Book §9.8">
                  Bonus Pts (§9.8)
                </th>
                <th
                  scope="col"
                  onClick={() => handleSortChange('status')}
                  className="py-3 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 select-none text-center"
                >
                  Quota Status {renderSortIndicator('status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {isLoading && allocations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">
                    <span className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin inline-block mr-2" />
                    Loading team auction allocations...
                  </td>
                </tr>
              ) : sortedTeams.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">
                    No teams found matching current filters.
                  </td>
                </tr>
              ) : (
                sortedTeams.map((team) => {
                  return (
                    <tr
                      key={team.team_id}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      {/* Team Name */}
                      <td className="py-3.5 px-4 font-bold text-zinc-900 dark:text-zinc-100">
                        <div>
                          <span>{team.team_name}</span>
                          <span className="text-[10px] text-zinc-400 font-mono block font-normal">
                            #{team.team_id.slice(0, 8)}
                          </span>
                        </div>
                      </td>

                      {/* Round 1 Won Slot */}
                      <td className="py-3.5 px-4">
                        {team.round1_slot ? (
                          <div className="space-y-0.5">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-300 block max-w-xs truncate" title={team.round1_slot.topic_title}>
                              {team.round1_slot.topic_title}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-400">
                              Won for {team.round1_slot.winning_bid} pts (Slot #{team.round1_slot.slot_id.slice(0, 8)})
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-400 text-xs italic">Not won yet</span>
                        )}
                      </td>

                      {/* Round 2 Won Slot */}
                      <td className="py-3.5 px-4">
                        {team.round2_slot ? (
                          <div className="space-y-0.5">
                            <span className="font-semibold text-purple-700 dark:text-purple-300 block max-w-xs truncate" title={team.round2_slot.topic_title}>
                              {team.round2_slot.topic_title}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-400">
                              Won for {team.round2_slot.winning_bid} pts (Slot #{team.round2_slot.slot_id.slice(0, 8)})
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-400 text-xs italic">Not won yet</span>
                        )}
                      </td>

                      {/* Total Spent */}
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-zinc-700 dark:text-zinc-300">
                        {team.total_spent} pts
                      </td>

                      {/* Wallet Balance */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                        {team.wallet_balance} pts
                      </td>

                      {/* Projected Rule Book §9.8 Bonus Points */}
                      <td className="py-3.5 px-4 text-center font-mono">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          +{team.projected_bonus_points} pts
                        </span>
                      </td>

                      {/* Quota Completion Status */}
                      <td className="py-3.5 px-4 text-center">
                        {team.allocation_completed ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            ★ Both Won (2/2)
                          </span>
                        ) : team.round1_won || team.round2_won ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                            {team.round1_won ? 'Round 1 Only (1/2)' : 'Round 2 Only (1/2)'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            None Won (0/2)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info note */}
        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span>
            Showing {sortedTeams.length} of {allocations.length} registered teams.
          </span>
          <span className="text-[11px] text-zinc-400 font-mono">
            Rule Book §9.8 Bonus: floor(remaining wallet balance / 10) added to final presentation score.
          </span>
        </div>
      </div>
    </div>
  );
}
