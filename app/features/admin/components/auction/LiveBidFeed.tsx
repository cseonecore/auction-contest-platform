'use client';

/**
 * LiveBidFeed Component
 * Bid2Build (Auction Contest Platform) — Phase 4B.4A
 *
 * Real-time monitoring feed of contest bidding activity:
 *  - Authoritative bid log sorted newest-first
 *  - Displays bid amount, team, slot ID, topic title, round, and timestamp
 *  - Identifies highest / leading bids
 *  - Search by team name or topic title
 *  - Filter by Round (All, Round 1, Round 2)
 *  - Empty and loading states
 */

import React, { useState, useMemo } from 'react';
import type {
  AdminBidWithTeam,
  SlotRoundFilter,
} from '../../types/auctionAdmin';

interface LiveBidFeedProps {
  bids: AdminBidWithTeam[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
}

function formatRelativeTime(timestamp: string, now: number): string {
  try {
    const past = new Date(timestamp).getTime();
    const diffSec = Math.max(0, Math.floor((now - past) / 1000));

    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    return new Date(timestamp).toLocaleDateString();
  } catch {
    return timestamp;
  }
}

export function LiveBidFeed({ bids, isLoading, onRefresh }: LiveBidFeedProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roundFilter, setRoundFilter] = useState<SlotRoundFilter>('all');
  const [now, setNow] = useState<number>(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const filteredBids = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return bids.filter((bid) => {
      // Round filter
      if (roundFilter !== 'all' && bid.slot?.round !== roundFilter) {
        return false;
      }

      // Search filter
      if (q) {
        const matchesTeam = bid.team.name.toLowerCase().includes(q);
        const matchesTopic = bid.slot?.topic?.title.toLowerCase().includes(q) ?? false;
        const matchesSlotId = bid.slot_id.toLowerCase().includes(q);
        const matchesAmount = bid.amount.toString().includes(q);

        if (!matchesTeam && !matchesTopic && !matchesSlotId && !matchesAmount) {
          return false;
        }
      }

      return true;
    });
  }, [bids, roundFilter, searchQuery]);

  return (
    <div className="space-y-4">
      {/* ─────────────────────────────────────────────────────────────
          1. Header & Filtering Controls
      ────────────────────────────────────────────────────────────── */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Search */}
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
            placeholder="Search bids by team, topic, or amount..."
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

        {/* Round Filter & Refresh */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
            {(['all', 1, 2] as const).map((r) => {
              const active = roundFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoundFilter(r)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    active
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  {r === 'all' ? 'All Rounds' : `Round ${r}`}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors shadow-2xs"
            title="Refresh Bid Feed"
          >
            {isLoading ? 'Syncing...' : 'Sync Feed'}
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. Live Bids Log Feed
      ────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Contest Bid Stream
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Newest bids placed across all active and completed auction rounds.
            </p>
          </div>
          <span className="text-xs font-mono font-semibold text-zinc-500">
            {filteredBids.length} bids
          </span>
        </div>

        {filteredBids.length === 0 ? (
          <div className="py-16 text-center text-zinc-400 text-xs space-y-2">
            <svg className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>No bids have been recorded yet matching your filter criteria.</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {filteredBids.map((bid, index) => {
              return (
                <div
                  key={bid.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                >
                  {/* Left: Team and Topic Information */}
                  <div className="flex items-start gap-3">
                    <span className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold text-xs flex items-center justify-center shrink-0 font-mono mt-0.5">
                      #{index + 1}
                    </span>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                          {bid.team.name}
                        </span>
                        {bid.slot?.round && (
                          <span className="text-[10px] font-semibold px-2 py-0.2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                            Round {bid.slot.round}
                          </span>
                        )}
                        {bid.slot?.topic?.level && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                            {bid.slot.topic.level}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">
                          {bid.slot?.topic?.title ?? 'Auction Slot'}
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-700">•</span>
                        <span className="font-mono text-zinc-400 text-[11px]">
                          Slot #{bid.slot_id.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Bid Amount & Timestamps */}
                  <div className="flex items-center sm:flex-col sm:items-end justify-between gap-1 shrink-0 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black text-amber-600 dark:text-amber-400">
                        {bid.amount} pts
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <span title={new Date(bid.server_time).toLocaleString()}>
                        {formatRelativeTime(bid.server_time, now)}
                      </span>
                      <span>•</span>
                      <span>{new Date(bid.server_time).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
