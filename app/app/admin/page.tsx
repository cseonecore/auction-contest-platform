'use client';

import Link from 'next/link';
import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';

export default function AdminDashboardPage() {
  const { user, role, signOut } = useAdminAuth();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight">
            Bid2Build Admin Dashboard
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Contest management portal for organizers and evaluators.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Settings Card - ACTIVE */}
          <Link
            href="/admin/settings"
            className="p-6 rounded-xl border-2 border-blue-600 bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md transition-shadow group"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold">
                ⚙️
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Active
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 transition-colors">
              Contest Settings
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Configure minimum bids, raise increments, timers, and scoring bonus multipliers.
            </p>
          </Link>

          {/* Registration Management - UPCOMING */}
          <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 opacity-75">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center">
                👥
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Next Phase
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Registration &amp; Teams
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              View participant teams, inspect rosters, handle member change requests, and lock registration.
            </p>
          </div>

          {/* Auction Control - UPCOMING */}
          <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 opacity-75">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center">
                🔨
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Upcoming
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Auction Control
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Open and close slots, manage countdown extensions, and supervise live team bidding.
            </p>
          </div>

          {/* Submissions & AI Evaluation - UPCOMING */}
          <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 opacity-75">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center">
                🤖
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Upcoming
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Submissions &amp; Eval
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Track code repositories, monitor AI grading progress, and requeue failed evaluations.
            </p>
          </div>

          {/* Review & Leaderboard - UPCOMING */}
          <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 opacity-75">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center">
                🏆
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Upcoming
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Review &amp; Results
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Audit flagged scores, manually adjust grades, finalize results, and publish leaderboard.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
