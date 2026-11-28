import React from "react";
import { TeamSize } from "../types";

interface TeamSizeSelectorProps {
  value: TeamSize;
  onChange: (size: TeamSize) => void;
}

export const TeamSizeSelector: React.FC<TeamSizeSelectorProps> = ({
  value,
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex justify-between items-baseline">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Total Team Members <span className="text-red-500">*</span>
        </label>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          (Includes Team Leader)
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 3 Members Option */}
        <button
          type="button"
          onClick={() => onChange(3)}
          className={`flex items-start justify-between p-4 rounded-xl border-2 text-left transition-all duration-150 cursor-pointer ${
            value === 3
              ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-500 shadow-xs"
              : "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-slate-300 dark:hover:border-zinc-700"
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">
                3 Members
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                Trio
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Team Leader + 2 Teammates
            </p>
          </div>
          <div
            className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors shrink-0 mt-0.5 ${
              value === 3
                ? "border-indigo-600 bg-indigo-600 dark:border-indigo-500 dark:bg-indigo-500 text-white"
                : "border-slate-300 dark:border-zinc-700"
            }`}
          >
            {value === 3 && (
              <svg
                className="w-3 h-3"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        </button>

        {/* 4 Members Option */}
        <button
          type="button"
          onClick={() => onChange(4)}
          className={`flex items-start justify-between p-4 rounded-xl border-2 text-left transition-all duration-150 cursor-pointer ${
            value === 4
              ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-500 shadow-xs"
              : "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-slate-300 dark:hover:border-zinc-700"
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">
                4 Members
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                Quartet
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Team Leader + 3 Teammates
            </p>
          </div>
          <div
            className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors shrink-0 mt-0.5 ${
              value === 4
                ? "border-indigo-600 bg-indigo-600 dark:border-indigo-500 dark:bg-indigo-500 text-white"
                : "border-slate-300 dark:border-zinc-700"
            }`}
          >
            {value === 4 && (
              <svg
                className="w-3 h-3"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        </button>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Teams must have a minimum of 3 and a maximum of 4 members (including the Team Leader).
      </p>
    </div>
  );
};
