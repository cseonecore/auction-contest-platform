'use client';

/**
 * Admin Bidding Results & Allocations — /admin/results
 * Bid2Build (Auction Contest Platform)
 *
 * Consolidated financial and problem allocation report:
 * Displays all registered teams, their captain, roster, valid balance,
 * total amount spent, every won problem with winning bid, and base/bonus/total dev time.
 * Reads directly from PostgreSQL RPC `public.get_bidding_results()`.
 */

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { AdminSubnav } from '@/features/admin/components/AdminSubnav';
import { AdminAuthGuard } from '@/features/admin/components/AdminAuthGuard';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';
import { UnifiedBiddingResultsTable } from '@/features/admin/components/auction/UnifiedBiddingResultsTable';
import { fetchBiddingResults } from '@/features/admin/services/adminAuctionService';
import type { BiddingResultTeam } from '@/features/admin/types/auctionAdmin';

function AdminResultsContent() {
  const { user, role, signOut } = useAdminAuth();
  const [teams, setTeams] = useState<BiddingResultTeam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const res = await fetchBiddingResults();
      if (res.success && res.data) {
        setTeams(res.data);
      } else {
        setError(res.error || 'Failed to load bidding results from database.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error loading results');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();

    // Auto-refresh periodically while page is open
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadData(true);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <div className="flex min-h-screen flex-col bg-[#0d0d0d] font-sans text-white select-none">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Bidding Results"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        <AdminSubnav currentSection="results" />

        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Bidding Results &amp; Financial Consolidation
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Authoritative records of team problem acquisitions, winning amounts, wallet debits, and development time.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold">
            {error}
          </div>
        )}

        <UnifiedBiddingResultsTable
          teams={teams}
          isLoading={isLoading}
          onRefresh={() => loadData(false)}
        />
      </main>
    </div>
  );
}

export default function AdminResultsPage() {
  return (
    <AdminAuthGuard>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-[#0d0d0d] text-xs text-zinc-400">
            <span className="mr-2 inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#fe5102] border-t-transparent" />
            Loading Bidding Results...
          </div>
        }
      >
        <AdminResultsContent />
      </Suspense>
    </AdminAuthGuard>
  );
}
