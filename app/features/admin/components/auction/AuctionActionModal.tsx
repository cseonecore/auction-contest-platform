'use client';

/**
 * AuctionActionModal Component
 * Bid2Build (Auction Contest Platform)
 *
 * Universal confirmation modal for admin auction lifecycle operations:
 *  - openSlot: Starts 10-second opening bidding window (Rule Book §5.1)
 *  - closeSlot: Finalizes bidding, assigns winner, deducts points (Rule Book §5.2)
 *  - skipSlot: Bypasses slot without allocation (Admin override)
 */

import React from 'react';
import type { AdminSlotWithDetails } from '../../types/auctionAdmin';

export type AuctionActionType = 'open' | 'close' | 'skip';

export interface AuctionActionModalState {
  isOpen: boolean;
  action: AuctionActionType;
  slot: AdminSlotWithDetails;
}

interface AuctionActionModalProps {
  state: AuctionActionModalState | null;
  onClose: () => void;
  onConfirm: (slotId: string, action: AuctionActionType) => Promise<void>;
  isExecuting: boolean;
}

export function AuctionActionModal({
  state,
  onClose,
  onConfirm,
  isExecuting,
}: AuctionActionModalProps) {
  if (!state || !state.isOpen) return null;

  const { action, slot } = state;

  const getActionConfig = () => {
    switch (action) {
      case 'open':
        return {
          title: `Open Slot #${slot.id.slice(0, 8)} for Bidding?`,
          badge: 'Open Slot',
          badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
          confirmText: 'Confirm & Open Slot',
          confirmBg: 'bg-emerald-600 hover:bg-emerald-700 text-white',
          description: (
            <>
              Opening this slot initiates the <strong className="text-zinc-900 dark:text-zinc-100">10-second live bidding window</strong>. Teams may submit bids starting at 10 points.
            </>
          ),
          notes: 'Only one slot may be active in the contest at any time.',
        };
      case 'close':
        return {
          title: `Close Slot #${slot.id.slice(0, 8)}?`,
          badge: 'Close Slot',
          badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
          confirmText: 'Confirm & Close Slot',
          confirmBg: 'bg-blue-600 hover:bg-blue-700 text-white',
          description: slot.leader_team ? (
            <>
              Closing this slot will award topic <strong className="text-zinc-900 dark:text-zinc-100 font-semibold">{slot.topic?.title}</strong> to winning team{' '}
              <strong className="text-blue-600 dark:text-blue-400 font-bold">{slot.leader_team.name}</strong> for{' '}
              <strong className="text-amber-600 dark:text-amber-400 font-bold">{slot.current_bid} points</strong>.
            </>
          ) : (
            <>
              No bids were placed on this slot. Closing will automatically mark this slot as{' '}
              <strong className="text-zinc-900 dark:text-zinc-100">SKIPPED</strong>.
            </>
          ),
          notes: slot.leader_team
            ? 'Winning points will be automatically deducted from the team wallet in database.'
            : 'Unsold slots are safely recorded as skipped in the audit log.',
        };
      case 'skip':
        return {
          title: `Skip Slot #${slot.id.slice(0, 8)}?`,
          badge: 'Skip Slot',
          badgeColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
          confirmText: 'Confirm & Skip Slot',
          confirmBg: 'bg-rose-600 hover:bg-rose-700 text-white',
          description: (
            <>
              Are you sure you want to manually skip <strong className="text-zinc-900 dark:text-zinc-100">{slot.topic?.title}</strong>? No team will be awarded this topic, and current bids will be discarded without charge.
            </>
          ),
          notes: 'This action is permanent and cannot be undone once logged.',
        };
    }
  };

  const config = getActionConfig();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (!isExecuting) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${config.badgeColor}`}>
                {config.badge}
              </span>
              <span className="text-xs font-mono text-zinc-400">
                Round {slot.round} ({slot.round === 1 ? 'Easy' : 'Hard'})
              </span>
            </div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              {config.title}
            </h3>
          </div>

          <button
            type="button"
            disabled={isExecuting}
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none disabled:opacity-50"
          >
            &times;
          </button>
        </div>

        {/* Slot Summary Card */}
        <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 text-xs space-y-2">
          <div className="flex justify-between items-start gap-2">
            <div>
              <span className="text-zinc-400 block text-[10px] uppercase font-sans">Topic</span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm">
                {slot.topic?.title ?? 'Unknown Topic'}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 shrink-0">
              {slot.topic?.level ?? 'easy'}
            </span>
          </div>

          {slot.topic?.description && (
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-2">
              {slot.topic.description}
            </p>
          )}

          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between font-mono text-xs">
            <div>
              <span className="text-zinc-400 text-[10px] uppercase block font-sans">Current Bid</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">
                {slot.current_bid} pts
              </span>
            </div>
            <div>
              <span className="text-zinc-400 text-[10px] uppercase block font-sans">Leader</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {slot.leader_team ? slot.leader_team.name : 'None'}
              </span>
            </div>
            <div>
              <span className="text-zinc-400 text-[10px] uppercase block font-sans">Total Bids</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {slot.bid_count}
              </span>
            </div>
          </div>
        </div>

        {/* Description & Rules */}
        <div className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          <p>{config.description}</p>
          <p className="text-[11px] text-zinc-500 italic">
            Note: {config.notes}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            disabled={isExecuting}
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isExecuting}
            onClick={() => void onConfirm(slot.id, action)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${config.confirmBg}`}
          >
            {isExecuting && (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            <span>{config.confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
