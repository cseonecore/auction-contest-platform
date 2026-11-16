'use client';

/**
 * AuctionResetModal Component
 * Bid2Build (Auction Contest Platform) — Feature 2: Full Auction Reset
 *
 * Destructive operation confirmation modal:
 *  - Displays explicit warning of full auction reset consequences.
 *  - Explains that all bids will be deleted, all slots returned to Pending,
 *    and team wallets restored to starting balance (100 pts per settings).
 *  - Enforces two-step confirmation: requires typing "RESET" before confirming.
 *  - Triggers the atomic server-side reset_auction RPC.
 */

import React, { useState } from 'react';

interface AuctionResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isExecuting: boolean;
}

export function AuctionResetModal({
  isOpen,
  onClose,
  onConfirm,
  isExecuting,
}: AuctionResetModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [prevIsOpen, setPrevIsOpen] = useState(false);

  // Clear input when opened/closed without useEffect cascading render
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setConfirmText('');
    }
  }

  if (!isOpen) return null;

  const isConfirmed = confirmText.trim().toUpperCase() === 'RESET';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (!isExecuting) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-zinc-900 border-2 border-rose-300 dark:border-rose-900/80 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Warning Header */}
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <div className="flex-1">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
              Destructive Operation
            </span>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mt-1">
              Reset All Topics &amp; Auction State?
            </h2>
          </div>

          <button
            type="button"
            disabled={isExecuting}
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Warning Callout Box */}
        <div className="p-4 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-900 dark:text-rose-200 space-y-2 leading-relaxed">
          <p className="font-bold">
            Full auction reset will delete all auction bids, reset every topic to Pending, and restore all team wallets to their original starting balances. This action cannot be undone.
          </p>
          <ul className="list-disc list-inside space-y-1 text-[11px] text-rose-800 dark:text-rose-300 pt-1">
            <li>Every auction slot/topic returns to <strong className="font-semibold">Pending</strong> status.</li>
            <li>All active countdown timers and currently open slots are cleared.</li>
            <li>All recorded auction bids in <code className="font-mono">public.bids</code> will be permanently deleted.</li>
            <li>Every team&apos;s wallet balance is restored to its starting budget (100 pts per contest settings).</li>
            <li>Team registrations, rosters, profiles, and code submissions will remain untouched.</li>
          </ul>
        </div>

        {/* Typing Confirmation Requirement */}
        <div className="space-y-2">
          <label htmlFor="resetConfirmInput" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 block">
            To proceed, type <span className="font-mono font-bold text-rose-600 dark:text-rose-400">RESET</span> in capital letters below:
          </label>
          <input
            id="resetConfirmInput"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={isExecuting}
            placeholder="Type RESET to confirm..."
            autoComplete="off"
            className="w-full px-3.5 py-2 text-xs font-mono font-bold rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100 dark:border-zinc-800">
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
            disabled={!isConfirmed || isExecuting}
            onClick={() => void onConfirm()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isExecuting && (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            <span>{isExecuting ? 'Resetting Auction...' : 'Confirm Full Reset'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
