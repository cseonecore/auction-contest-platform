'use client';

/**
 * SlotQueueTable Component
 * Bid2Build (Auction Contest Platform) — Phase 4B.2
 *
 * Full-featured Slot Queue and Management interface:
 *  - Filter by Round (All, Round 1, Round 2)
 *  - Filter by Status (All, Pending, Open, Sold, Skipped)
 *  - Search by topic title, description, and slot ID
 *  - Sort by ID, Round, Status, Current Bid
 *  - Client pagination with configurable page size (10, 20, 50)
 *  - Direct contextual actions (Open, Close, Skip) with confirmation
 *  - Inspection modal trigger for complete topic specifications
 */

import React, { useState, useMemo } from 'react';
import type {
  AdminSlotWithDetails,
  SlotStatusFilter,
  SlotRoundFilter,
  SlotSortField,
  SortDirection,
} from '../../types/auctionAdmin';
import type { AuctionActionType } from './AuctionActionModal';

interface SlotQueueTableProps {
  slots: AdminSlotWithDetails[];
  isLoading: boolean;
  onSelectSlot: (slot: AdminSlotWithDetails) => void;
  onRequestAction: (slot: AdminSlotWithDetails, action: AuctionActionType) => void;
  isActionInProgress: boolean;
  onRequestReset?: () => void;
  onRequestAddTopic?: () => void;
}

export function SlotQueueTable({
  slots,
  isLoading,
  onSelectSlot,
  onRequestAction,
  isActionInProgress,
  onRequestReset,
  onRequestAddTopic,
}: SlotQueueTableProps) {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SlotStatusFilter>('all');
  const [roundFilter, setRoundFilter] = useState<SlotRoundFilter>('all');

  // Sorting
  const [sortField, setSortField] = useState<SlotSortField>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Pagination
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Status counters for badge chips
  const counts = useMemo(() => {
    return {
      all: slots.length,
      pending: slots.filter((s) => s.status === 'pending').length,
      open: slots.filter((s) => s.status === 'open').length,
      sold: slots.filter((s) => s.status === 'sold').length,
      skipped: slots.filter((s) => s.status === 'skipped').length,
      round1: slots.filter((s) => s.round === 1).length,
      round2: slots.filter((s) => s.round === 2).length,
    };
  }, [slots]);

  // Filter & Search
  const filteredSlots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return slots.filter((slot) => {
      if (statusFilter !== 'all' && slot.status !== statusFilter) {
        return false;
      }
      if (roundFilter !== 'all' && slot.round !== roundFilter) {
        return false;
      }
      if (q) {
        const matchesTitle = slot.topic?.title?.toLowerCase().includes(q) ?? false;
        const matchesDesc = slot.topic?.description?.toLowerCase().includes(q) ?? false;
        const matchesId = slot.id.toLowerCase().includes(q);
        const matchesLeader = slot.leader_team?.name.toLowerCase().includes(q) ?? false;
        const matchesWinner = slot.winner_team?.name.toLowerCase().includes(q) ?? false;

        if (!matchesTitle && !matchesDesc && !matchesId && !matchesLeader && !matchesWinner) {
          return false;
        }
      }
      return true;
    });
  }, [slots, statusFilter, roundFilter, searchQuery]);

  // Sorting
  const sortedSlots = useMemo(() => {
    return [...filteredSlots].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'id':
          comparison = a.id.localeCompare(b.id);
          break;
        case 'round':
          comparison = a.round - b.round;
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'bid':
          comparison = a.current_bid - b.current_bid;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredSlots, sortField, sortDirection]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(sortedSlots.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedSlots = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return sortedSlots.slice(start, start + pageSize);
  }, [sortedSlots, safeCurrentPage, pageSize]);

  const handleSortChange = (field: SlotSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const renderSortIndicator = (field: SlotSortField) => {
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
          1. Filter & Search Controls Bar with Admin Action Buttons
      ────────────────────────────────────────────────────────────── */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-3">
        {/* Top Action Bar: Count + Add Topic & Reset All Topics */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Contest Queue Controls
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono font-semibold">
              {filteredSlots.length} of {slots.length} slots
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {onRequestAddTopic && (
              <button
                type="button"
                onClick={onRequestAddTopic}
                disabled={isActionInProgress || isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition-colors disabled:opacity-50"
                title="Add a new topic to the auction contest"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Add Topic</span>
              </button>
            )}

            {onRequestReset && (
              <button
                type="button"
                onClick={onRequestReset}
                disabled={isActionInProgress || isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 shadow-2xs transition-colors disabled:opacity-50"
                title="Reset all auction slots to pending, clear bids, and restore team wallets"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Reset All Topics</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by topic title, description, or slot ID..."
              className="w-full pl-9 pr-8 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-sm leading-none"
              >
                &times;
              </button>
            )}
          </div>

          {/* Round Filter Tabs */}
          <div className="flex items-center gap-1.5 self-start md:self-auto">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mr-1">Round:</span>
            {(['all', 1, 2] as const).map((r) => {
              const active = roundFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRoundFilter(r);
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {r === 'all' ? `All (${counts.all})` : r === 1 ? `Round 1 (${counts.round1})` : `Round 2 (${counts.round2})`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mr-1">Status:</span>
          {(
            [
              { id: 'all', label: 'All Slots', count: counts.all },
              { id: 'pending', label: 'Pending', count: counts.pending },
              { id: 'open', label: 'Open (Live)', count: counts.open },
              { id: 'sold', label: 'Sold', count: counts.sold },
              { id: 'skipped', label: 'Skipped', count: counts.skipped },
            ] as const
          ).map((s) => {
            const active = statusFilter === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setStatusFilter(s.id);
                  setCurrentPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  active
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                <span>{s.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${active ? 'bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. Slot Table
      ────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold">
              <tr>
                <th
                  scope="col"
                  onClick={() => handleSortChange('id')}
                  className="py-3 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 select-none"
                >
                  Slot ID {renderSortIndicator('id')}
                </th>
                <th scope="col" className="py-3 px-4">
                  Topic &amp; Level
                </th>
                <th
                  scope="col"
                  onClick={() => handleSortChange('round')}
                  className="py-3 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 select-none text-center"
                >
                  Round {renderSortIndicator('round')}
                </th>
                <th
                  scope="col"
                  onClick={() => handleSortChange('status')}
                  className="py-3 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 select-none"
                >
                  Status {renderSortIndicator('status')}
                </th>
                <th
                  scope="col"
                  onClick={() => handleSortChange('bid')}
                  className="py-3 px-4 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 select-none text-right"
                >
                  Current Bid {renderSortIndicator('bid')}
                </th>
                <th scope="col" className="py-3 px-4">
                  Leader / Winner
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {isLoading && slots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">
                    <span className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin inline-block mr-2" />
                    Loading auction slot queue...
                  </td>
                </tr>
              ) : paginatedSlots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">
                    No auction slots match the current filters.
                  </td>
                </tr>
              ) : (
                paginatedSlots.map((slot) => {
                  const isOpen = slot.status === 'open';
                  const isSold = slot.status === 'sold';
                  const isSkipped = slot.status === 'skipped';
                  const isPending = slot.status === 'pending';

                  return (
                    <tr
                      key={slot.id}
                      className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors ${
                        isOpen ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''
                      }`}
                    >
                      {/* Slot ID */}
                      <td className="py-3.5 px-4 font-mono text-zinc-500 text-[11px]">
                        <span title={slot.id}>#{slot.id.slice(0, 8)}</span>
                      </td>

                      {/* Topic Title & Level */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onSelectSlot(slot)}
                            className="font-semibold text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 text-left transition-colors max-w-xs truncate"
                            title={slot.topic?.title}
                          >
                            {slot.topic?.title ?? 'Unknown Topic'}
                          </button>
                          <span
                            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              slot.topic?.level === 'easy'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                            }`}
                          >
                            {slot.topic?.level ?? 'easy'}
                          </span>
                        </div>
                      </td>

                      {/* Round */}
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                          R{slot.round}
                        </span>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-4">
                        {isOpen ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            OPEN
                          </span>
                        ) : isSold ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            SOLD
                          </span>
                        ) : isSkipped ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            SKIPPED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            PENDING
                          </span>
                        )}
                      </td>

                      {/* Current Bid & Bid Count */}
                      <td className="py-3.5 px-4 text-right font-mono">
                        <div className="font-bold text-amber-600 dark:text-amber-400 text-xs">
                          {slot.current_bid} pts
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          {slot.bid_count} {slot.bid_count === 1 ? 'bid' : 'bids'}
                        </div>
                      </td>

                      {/* Leader / Winner */}
                      <td className="py-3.5 px-4">
                        {isSold && slot.winner_team ? (
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400 truncate block max-w-[140px]" title={slot.winner_team.name}>
                            ★ {slot.winner_team.name}
                          </span>
                        ) : isOpen && slot.leader_team ? (
                          <span className="font-semibold text-amber-600 dark:text-amber-400 truncate block max-w-[140px]" title={slot.leader_team.name}>
                            ● {slot.leader_team.name}
                          </span>
                        ) : (
                          <span className="text-zinc-400 text-[11px]">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          {/* Inspect Modal Trigger */}
                          <button
                            type="button"
                            onClick={() => onSelectSlot(slot)}
                            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            title="Inspect Topic Criteria"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>

                          {/* Quick Lifecycle Actions */}
                          {isPending && (
                            <>
                              <button
                                type="button"
                                disabled={isActionInProgress}
                                onClick={() => onRequestAction(slot, 'open')}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 disabled:opacity-50"
                                title="Open slot for bidding"
                              >
                                Open
                              </button>
                              <button
                                type="button"
                                disabled={isActionInProgress}
                                onClick={() => onRequestAction(slot, 'skip')}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                                title="Skip slot"
                              >
                                Skip
                              </button>
                            </>
                          )}

                          {isOpen && (
                            <>
                              <button
                                type="button"
                                disabled={isActionInProgress}
                                onClick={() => onRequestAction(slot, 'close')}
                                className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-2xs disabled:opacity-50"
                                title="Close slot and finalize winner"
                              >
                                Close
                              </button>
                              <button
                                type="button"
                                disabled={isActionInProgress}
                                onClick={() => onRequestAction(slot, 'skip')}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                                title="Skip slot"
                              >
                                Skip
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            3. Pagination & Count Footer
        ────────────────────────────────────────────────────────────── */}
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-zinc-500">
          <div className="flex items-center gap-3">
            <span>
              Showing {sortedSlots.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1} -{' '}
              {Math.min(safeCurrentPage * pageSize, sortedSlots.length)} of {sortedSlots.length} slots
            </span>

            <div className="flex items-center gap-1.5">
              <span>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 text-xs focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1 self-end sm:self-auto">
            <button
              type="button"
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-2 font-mono text-zinc-700 dark:text-zinc-300">
              {safeCurrentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
