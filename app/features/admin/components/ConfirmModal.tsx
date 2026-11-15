'use client';

import { SettingChangeDiff } from '../types/settings';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSaving: boolean;
  changes: SettingChangeDiff[];
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isSaving,
  changes,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl max-w-lg w-full p-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Confirm Contest Settings Update
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              These changes directly affect live contest rules, timers, and wallet calculations.
            </p>
          </div>
        </div>

        <div className="my-4 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-3 py-2 font-semibold">Setting</th>
                <th className="px-3 py-2 font-semibold">Current Value</th>
                <th className="px-3 py-2 font-semibold text-emerald-600 dark:text-emerald-400">New Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
              {changes.map((change) => (
                <tr key={change.key} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                  <td className="px-3 py-2.5 font-sans font-medium text-zinc-900 dark:text-zinc-100">
                    {change.label}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500 line-through">
                    {change.oldValue} {change.unit}
                  </td>
                  <td className="px-3 py-2.5 font-bold text-emerald-600 dark:text-emerald-400">
                    {change.newValue} {change.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Saving to Database...</span>
              </>
            ) : (
              <span>Confirm &amp; Update Settings</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
