import React from "react";
import { RegistrationSuccessData } from "../types";

interface RegistrationSuccessProps {
  data: RegistrationSuccessData;
  onReset: () => void;
}

export const RegistrationSuccess: React.FC<RegistrationSuccessProps> = ({
  data,
  onReset,
}) => {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 rounded-2xl shadow-xl shadow-slate-100/50 dark:shadow-none p-6 sm:p-10 text-center transition-all animate-in fade-in zoom-in-95 duration-200">
      {/* Success Icon */}
      <div className="mx-auto w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-500/20 dark:border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-6">
        <svg
          className="w-8 h-8 sm:w-10 sm:h-10"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>

      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100/80 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 mb-3">
        Registration Confirmed
      </span>

      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-zinc-50 tracking-tight">
        Team Successfully Registered!
      </h2>
      <p className="text-sm text-slate-600 dark:text-zinc-400 mt-2 max-w-md mx-auto">
        Your team has been officially registered for the event. Keep your Registration ID handy for check-in and auction rounds.
      </p>

      {/* Details Box */}
      <div className="mt-8 text-left bg-slate-50 dark:bg-zinc-950/60 rounded-xl border border-slate-200/80 dark:border-zinc-800 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200/70 dark:border-zinc-800 gap-2">
          <div>
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400">
              Registration ID
            </span>
            <p className="text-base font-mono font-bold text-indigo-600 dark:text-indigo-400">
              {data.registrationId}
            </p>
          </div>
          <div className="sm:text-right">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400">
              Registration Time
            </span>
            <p className="text-xs text-slate-600 dark:text-zinc-400">
              {new Date(data.registeredAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Team Name</span>
            <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              {data.teamName}
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Team Size</span>
            <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              {data.teamSize} Members
            </p>
          </div>
        </div>

        {/* Member breakdown */}
        <div className="pt-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Registered Members
          </span>
          <div className="mt-2 divide-y divide-slate-200/60 dark:divide-zinc-800/80 rounded-lg border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            {/* Leader */}
            <div className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div>
                <span className="font-semibold text-slate-900 dark:text-zinc-100">
                  {data.leader.name}
                </span>{" "}
                <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                  (Leader)
                </span>
                <span className="block text-slate-500 dark:text-slate-400">
                  {data.leader.email} • {data.leader.phone}
                </span>
              </div>
              <div className="font-mono text-slate-700 dark:text-zinc-300 font-medium">
                USN: {data.leader.usn}
              </div>
            </div>

            {/* Teammates */}
            {data.teammates.map((m) => (
              <div
                key={m.id}
                className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
              >
                <div>
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">
                    {m.name}
                  </span>{" "}
                  <span className="text-slate-400">
                    (Member #{m.id})
                  </span>
                </div>
                <div className="font-mono text-slate-700 dark:text-zinc-300 font-medium">
                  USN: {m.usn}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 text-sm font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
        >
          Print Receipt
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-xs hover:shadow-indigo-500/20 transition-all cursor-pointer"
        >
          Register Another Team
        </button>
      </div>
    </div>
  );
};
