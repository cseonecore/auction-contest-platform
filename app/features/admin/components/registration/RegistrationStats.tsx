'use client';

import { RegistrationStatsData } from '../../types/registration';

interface RegistrationStatsProps {
  stats: RegistrationStatsData;
}

export function RegistrationStats({ stats }: RegistrationStatsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Total Teams & Capacity */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-medium">
          <span>Registered Teams</span>
          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            Capacity
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 font-mono">
            {stats.totalTeams}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            / {stats.maxCapacity} Max
          </span>
        </div>
        {/* Progress Bar */}
        <div className="mt-3">
          <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                stats.capacityPercentage >= 100
                  ? 'bg-red-500'
                  : stats.capacityPercentage >= 75
                  ? 'bg-amber-500'
                  : 'bg-blue-600'
              }`}
              style={{ width: `${stats.capacityPercentage}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
            <span>{stats.capacityPercentage}% Filled</span>
            <span>{Math.max(0, stats.maxCapacity - stats.totalTeams)} slots open</span>
          </div>
        </div>
      </div>

      {/* 2. Total Participants */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-medium">
          <span>Total Participants</span>
          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            Students
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 font-mono">
            {stats.totalParticipants}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">members registered</span>
        </div>
        <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">
          Avg. {stats.totalTeams > 0 ? (stats.totalParticipants / stats.totalTeams).toFixed(1) : 0} members per team
        </p>
      </div>

      {/* 3. Unlocked Teams */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-medium">
          <span>Unlocked Teams</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
            {stats.unlockedTeams}
          </span>
          <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">Active</span>
        </div>
        <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">
          Teams currently open for roster updates
        </p>
      </div>

      {/* 4. Locked Teams */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-xs font-medium">
          <span>Locked Teams</span>
          <span className="w-2 h-2 rounded-full bg-amber-500" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 dark:text-amber-400 font-mono">
            {stats.lockedTeams}
          </span>
          <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">Frozen</span>
        </div>
        <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">
          Rosters finalized for contest participation
        </p>
      </div>
    </div>
  );
}
