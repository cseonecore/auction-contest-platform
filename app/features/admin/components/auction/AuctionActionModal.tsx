'use client';

/**
 * AuctionActionModal Component
 * Bid2Build (Auction Contest Platform)
 *
 * Universal confirmation and configuration modal for admin auction operations:
 *  - open: Configures starting bid points and initiates 10s bidding window (Rule Book §5.1)
 *  - close: Finalizes bidding, assigns winner, deducts points (Rule Book §5.2)
 *  - skip: Bypasses slot without allocation (Admin override)
 */

import React, { useState } from 'react';
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
  onConfirm: (slotId: string, action: AuctionActionType, startingBid?: number) => Promise<void>;
  isExecuting: boolean;
}

export function AuctionActionModal({
  state,
  onClose,
  onConfirm,
  isExecuting,
}: AuctionActionModalProps) {
  const slot = state?.slot;
  const action = state?.action;

  // Track previous slot state to reset inputs without useEffect cascading render
  const [prevSlotKey, setPrevSlotKey] = useState<string | null>(null);
  const [startingBidInput, setStartingBidInput] = useState<string>('10');
  const [validationError, setValidationError] = useState<string | null>(null);

  const currentSlotKey = state?.isOpen ? `${state.action}-${state.slot.id}` : null;
  if (currentSlotKey !== prevSlotKey) {
    setPrevSlotKey(currentSlotKey);
    if (state?.isOpen && state.action === 'open') {
      const defaultBid = state.slot.min_bid || 10;
      setStartingBidInput(defaultBid.toString());
      setValidationError(null);
    }
  }

  if (!state || !state.isOpen || !slot || !action) return null;

  const parsedStartingBid = parseInt(startingBidInput.trim(), 10);

  const handleValidateAndConfirm = () => {
    if (action === 'open') {
      if (!startingBidInput.trim() || isNaN(parsedStartingBid) || parsedStartingBid <= 0) {
        setValidationError('Starting bid points must be a valid positive whole number.');
        return;
      }
      setValidationError(null);
      void onConfirm(slot.id, 'open', parsedStartingBid);
    } else {
      void onConfirm(slot.id, action);
    }
  };

  const getActionConfig = () => {
    switch (action) {
      case 'open':
        return {
          title: `Configure & Open Slot #${slot.id.slice(0, 8)}`,
          badge: 'Open Slot',
          badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
          confirmText: isExecuting
            ? 'Opening Slot...'
            : `Confirm & Open Slot (${isNaN(parsedStartingBid) || parsedStartingBid <= 0 ? 10 : parsedStartingBid} pts)`,
          confirmBg: 'bg-emerald-600 hover:bg-emerald-700 text-white',
          description: (
            <>
              Opening this slot initiates the <strong className="text-zinc-900 dark:text-zinc-100">10-second live bidding window</strong>. Teams can submit opening bids starting at the configured minimum points below.
            </>
          ),
          notes: 'Only one slot may be active in the contest at any time (enforced on database level).',
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
              <span className="text-zinc-400 block text-[10px] uppercase font-sans">Topic Name</span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm">
                {slot.topic?.title ?? 'Unknown Topic'}
              </span>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
              slot.round === 1
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
            }`}>
              Round {slot.round} • {slot.topic?.level?.toUpperCase() ?? (slot.round === 1 ? 'EASY' : 'HARD')}
            </span>
          </div>

          {slot.topic?.description && (
            <div>
              <span className="text-zinc-400 block text-[10px] uppercase font-sans">Description</span>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                {slot.topic.description}
              </p>
            </div>
          )}

          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between font-mono text-xs">
            <div>
              <span className="text-zinc-400 text-[10px] uppercase block font-sans">Status</span>
              <span className="font-bold uppercase text-zinc-700 dark:text-zinc-300">
                {slot.status}
              </span>
            </div>
            <div>
              <span className="text-zinc-400 text-[10px] uppercase block font-sans">Leader</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {slot.leader_team ? slot.leader_team.name : 'None'}
              </span>
            </div>
            <div>
              <span className="text-zinc-400 text-[10px] uppercase block font-sans">Base Points</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {slot.min_bid ?? 10} pts
              </span>
            </div>
          </div>
        </div>

        {/* Feature 1: Starting Points Configuration Input (When Opening Slot) */}
        {action === 'open' && (
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="startingBidInput" className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Configure Starting / Minimum Bid Points:
              </label>
              <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                Default: 10 pts
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  id="startingBidInput"
                  type="number"
                  min={1}
                  step={1}
                  value={startingBidInput}
                  onChange={(e) => {
                    setStartingBidInput(e.target.value);
                    setValidationError(null);
                  }}
                  disabled={isExecuting}
                  placeholder="Enter starting bid..."
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-zinc-400">
                  PTS
                </span>
              </div>

              {/* Preset buttons */}
              <div className="flex items-center gap-1">
                {[10, 20, 30].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setStartingBidInput(preset.toString());
                      setValidationError(null);
                    }}
                    disabled={isExecuting}
                    className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {validationError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                {validationError}
              </p>
            )}

            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              The first valid bid submitted by any team captain must be at or above this amount.
            </p>
          </div>
        )}

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
            onClick={handleValidateAndConfirm}
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
