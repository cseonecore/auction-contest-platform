"use client";

import Link from "next/link";
import { Settings, Users, Gavel, Cpu, Trophy } from "lucide-react";
import { AdminHeader } from "@/features/admin/components/AdminHeader";
import { AdminSubnav } from "@/features/admin/components/AdminSubnav";
import { useAdminAuth } from "@/features/admin/hooks/useAdminAuth";

export default function AdminDashboardPage() {
  const { user, role, signOut } = useAdminAuth();

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white flex flex-col font-sans select-none">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Dashboard"
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        <AdminSubnav currentSection="dashboard" />

        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Bid2Build Admin Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Contest management portal for organizers and evaluators.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Settings Card */}
          <Link
            href="/admin/settings"
            className="p-6 rounded-2xl border border-white/10 bg-[#16171b] hover:border-[#fe5102]/60 hover:bg-[#1c1d22] transition-all group shadow-lg"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#fe5102]/15 text-[#fe5102] flex items-center justify-center">
                <Settings className="w-5 h-5" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                Active
              </span>
            </div>
            <h2 className="text-lg font-bold text-white group-hover:text-[#fe5102] transition-colors">
              Contest Settings
            </h2>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Configure minimum bids, raise increments, timers, and scoring bonus multipliers.
            </p>
          </Link>

          {/* Registration Management */}
          <Link
            href="/admin/registration"
            className="p-6 rounded-2xl border border-white/10 bg-[#16171b] hover:border-[#fe5102]/60 hover:bg-[#1c1d22] transition-all group shadow-lg"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#fe5102]/15 text-[#fe5102] flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                Active
              </span>
            </div>
            <h2 className="text-lg font-bold text-white group-hover:text-[#fe5102] transition-colors">
              Registration &amp; Teams
            </h2>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              View registered teams, inspect member rosters, and monitor contest capacity limits.
            </p>
          </Link>

          {/* Auction Control */}
          <Link
            href="/admin/auction"
            className="p-6 rounded-2xl border border-white/10 bg-[#16171b] hover:border-[#fe5102]/60 hover:bg-[#1c1d22] transition-all group shadow-lg"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#fe5102]/15 text-[#fe5102] flex items-center justify-center">
                <Gavel className="w-5 h-5" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                Active
              </span>
            </div>
            <h2 className="text-lg font-bold text-white group-hover:text-[#fe5102] transition-colors">
              Auction Control
            </h2>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Open and close slots, manage countdown extensions, and supervise live team bidding.
            </p>
          </Link>

          {/* Submissions & Evaluation */}
          <div className="p-6 rounded-2xl border border-white/5 bg-[#16171b]/50 opacity-60">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-white/5 text-slate-500 flex items-center justify-center">
                <Cpu className="w-5 h-5" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-white/5 text-slate-400">
                Upcoming
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-300">
              Submissions &amp; Eval
            </h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Track code repositories, monitor AI grading progress, and requeue failed evaluations.
            </p>
          </div>

          {/* Bidding Results & Allocations */}
          <Link
            href="/admin/results"
            className="p-6 rounded-2xl border border-white/10 bg-[#16171b] hover:border-[#fe5102]/60 hover:bg-[#1c1d22] transition-all group shadow-lg"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#fe5102]/15 text-[#fe5102] flex items-center justify-center">
                <Trophy className="w-5 h-5" />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                Active
              </span>
            </div>
            <h2 className="text-lg font-bold text-white group-hover:text-[#fe5102] transition-colors">
              Bidding Results
            </h2>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Consolidated report of acquired problems, winning bids, wallet debits, and development time.
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
