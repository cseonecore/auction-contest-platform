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

import React, { Suspense } from 'react';
import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { AdminAuthGuard } from '@/features/admin/components/AdminAuthGuard';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';
import { AdminAuctionRoom } from '@/features/auction/components/AdminAuctionRoom';

function AdminAuctionContent() {
  const { user, role, signOut } = useAdminAuth();

  return (
    <div className="flex min-h-screen flex-col bg-[#111215] font-sans text-white">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Auction"
      />

      <main className="flex-1 w-full">
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
