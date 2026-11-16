'use client';

/**
 * SlotDetailsModal Component
 * Bid2Build (Auction Contest Platform)
 *
 * Provides a comprehensive modal for contest administrators to inspect:
 *  - Full slot metadata (ID, Round, Status, Timestamps)
 *  - Topic details (Title, Level, Criterion, Description)
 *  - Leading and winning team details
 *  - Direct contextual action triggers (Open, Close, Skip)
 */

import React from 'react';
import type { AdminSlotWithDetails } from '../../types/auctionAdmin';
import type { AuctionActionType } from './AuctionActionModal';

interface SlotDetailsModalProps {
  slot: AdminSlotWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onRequestAction: (slot: AdminSlotWithDetails, action: AuctionActionType) => void;
  isActionInProgress: boolean;
}

function formatCriterion(criterion: unknown): string {
  if (!criterion) return '';
  if (typeof criterion === 'string') return criterion;
  try {
    return JSON.stringify(criterion, null, 2);
  } catch {
    return String(criterion);
  }
}

export function SlotDetailsModal({
  slot,
  isOpen,
  onClose,
  onRequestAction,
  isActionInProgress,
}: SlotDetailsModalProps) {
  if (!isOpen || !slot) return null;

  const getStatusBadge = () => {
    switch (slot.status) {
      case 'open':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            LIVE OPEN
          </span>
        );
      case 'sold':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            SOLD
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
            SKIPPED
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            PENDING
          </span>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              {getStatusBadge()}
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                Round {slot.round} ({slot.round === 1 ? 'Easy / 10 Topics' : 'Hard / 10 Topics'})
              </span>
              <span className="text-xs font-mono text-zinc-400">
                ID: {slot.id}
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight">
              {slot.topic?.title ?? 'Auction Topic Details'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-2xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Topic Specification Details */}
        <div className="space-y-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
              Description
            </span>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed bg-zinc-50 dark:bg-zinc-800/40 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
              {slot.topic?.description || 'No description provided for this topic.'}
            </p>
          </div>

          {slot.topic?.criterion && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                Evaluation Criterion &amp; Deliverables
              </span>
              <div className="text-xs text-zinc-700 dark:text-zinc-300 bg-amber-50/60 dark:bg-amber-950/20 p-3.5 rounded-xl border border-amber-200/80 dark:border-amber-800/40 whitespace-pre-wrap leading-relaxed font-mono">
                {formatCriterion(slot.topic.criterion)}
              </div>
            </div>
          )}

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                Current / Winning Bid
              </span>
              <span className="text-base font-extrabold font-mono text-amber-600 dark:text-amber-400 mt-1 block">
                {slot.current_bid} pts
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                Bid Count
              </span>
              <span className="text-base font-extrabold font-mono text-zinc-800 dark:text-zinc-200 mt-1 block">
                {slot.bid_count} bids
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                Leader Team
              </span>
              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mt-1 block truncate">
                {slot.leader_team ? slot.leader_team.name : '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                Winner Team
              </span>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1 block truncate">
                {slot.winner_team ? slot.winner_team.name : '—'}
              </span>
            </div>
          </div>

          {/* Timestamps & Scheduling */}
          {slot.end_time && (
            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
              <span className="text-zinc-500 font-medium">Bidding End Time:</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200">
                {new Date(slot.end_time).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">
            {slot.status === 'pending' && 'Slot is in queue. Admin can initiate 10s bidding window.'}
            {slot.status === 'open' && 'Slot is actively receiving bids from registered teams.'}
            {slot.status === 'sold' && 'Slot has concluded. Winning points deducted from wallet.'}
            {slot.status === 'skipped' && 'Slot concluded with no winning bid.'}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {slot.status === 'pending' && (
              <>
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={() => onRequestAction(slot, 'skip')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-300 text-rose-700 dark:border-rose-900/60 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
                >
                  Skip
                </button>
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={() => onRequestAction(slot, 'open')}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 shadow-2xs"
                >
                  Open Slot for Bidding
                </button>
              </>
            )}

            {slot.status === 'open' && (
              <>
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={() => onRequestAction(slot, 'skip')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-300 text-rose-700 dark:border-rose-900/60 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
                >
                  Skip Slot
                </button>
                <button
                  type="button"
                  disabled={isActionInProgress}
                  onClick={() => onRequestAction(slot, 'close')}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 shadow-2xs"
                >
                  Close &amp; Finalize Slot
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Close Window
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
