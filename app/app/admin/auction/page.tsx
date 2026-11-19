'use client';

/**
 * Admin Auction Control Panel — /admin/auction
 * Bid2Build (Auction Contest Platform)
 *
 * The compact live-auction controller matching the original auction
 * design: session controls, one problem statement card with the five
 * slot controls, and one live leaderboard with a Project button.
 *
 * The room is fully self-contained (state, realtime, RPC actions live
 * in AdminAuctionRoom); this page only supplies the existing admin
 * header, auth guard and dark shell.
 */

import React, { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { AdminSubnav } from '@/features/admin/components/AdminSubnav';
import { AdminAuthGuard } from '@/features/admin/components/AdminAuthGuard';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';
import { AdminAuctionRoom } from '@/features/auction/components/AdminAuctionRoom';

function AdminAuctionContent() {
  const { user, role, signOut } = useAdminAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Redirect obsolete tab=allocations to the unified /admin/results page
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'allocations') {
      router.replace('/admin/results');
    }
  }, [searchParams, router]);

  return (
    <div className="flex min-h-screen flex-col bg-[#0d0d0d] font-sans text-white select-none">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Auctioning"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        <AdminSubnav currentSection="auction" />
        <AdminAuctionRoom />
      </main>
    </div>
  );
}

export default function AdminAuctionPage() {
  return (
    <AdminAuthGuard>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-[#111215] text-xs text-zinc-400">
            <span className="mr-2 inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#fe5102] border-t-transparent" />
            Loading Auction Console...
          </div>
        }
      >
        <AdminAuctionContent />
      </Suspense>
    </AdminAuthGuard>
  );
}
