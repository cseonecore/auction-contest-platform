'use client';

/**
 * Admin Auction Management Page
 * Bid2Build (Auction Contest Platform) — Complete Phase 4B
 *
 * Full-featured administrative control and monitoring center for the auction:
 *  - Phase 4B.1: Auction Overview Dashboard & Live KPIs
 *  - Phase 4B.2: Slot Queue & Management (Search, Filters, Sort, Modal Inspect, Quick Actions)
 *  - Phase 4B.3: Active Slot Bidding Controller & Pending Slot Launcher
 *  - Phase 4B.4A: Live Bid Feed Stream
 *  - Phase 4B.4B: Team Allocation & Economy Table (Rule Book §5.3 & §9.8)
 *
 * Synchronized with database authoritative state via useAdminAuction hook.
 */

import React, { Suspense, useState, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminHeader } from '@/features/admin/components/AdminHeader';
import { AdminAuthGuard } from '@/features/admin/components/AdminAuthGuard';
import { useAdminAuth } from '@/features/admin/hooks/useAdminAuth';
import { useAdminAuction } from '@/features/admin/hooks/useAdminAuction';
import { AdminSubnav } from '@/features/admin/components/AdminSubnav';
import { AuctionDashboardStats } from '@/features/admin/components/auction/AuctionDashboardStats';
import { SlotQueueTable } from '@/features/admin/components/auction/SlotQueueTable';
import { SlotDetailsModal } from '@/features/admin/components/auction/SlotDetailsModal';
import { ActiveSlotController } from '@/features/admin/components/auction/ActiveSlotController';
import { LiveBidFeed } from '@/features/admin/components/auction/LiveBidFeed';
import { TeamAllocationTable } from '@/features/admin/components/auction/TeamAllocationTable';
import {
  AuctionActionModal,
  type AuctionActionModalState,
  type AuctionActionType,
} from '@/features/admin/components/auction/AuctionActionModal';
import { AuctionResetModal } from '@/features/admin/components/auction/AuctionResetModal';
import { AddTopicModal } from '@/features/admin/components/auction/AddTopicModal';
import type {
  AdminSlotWithDetails,
  AuctionTabKey,
  CreateTopicFormValues,
} from '@/features/admin/types/auctionAdmin';

function AdminAuctionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Active sub-tab from query parameter (default: 'overview')
  const tabParam = (searchParams.get('tab') as AuctionTabKey) || 'overview';
  const activeTab: AuctionTabKey = [
    'overview',
    'queue',
    'controller',
    'feed',
    'allocations',
  ].includes(tabParam)
    ? tabParam
    : 'overview';

  const handleTabChange = useCallback(
    (newTab: AuctionTabKey) => {
      router.push(`/admin/auction?tab=${newTab}`, { scroll: false });
    },
    [router]
  );

  // Authoritative Hook
  const {
    slots,
    activeSlot,
    teamAllocations,
    recentBids,
    overviewStats,
    isLoading,
    isInitialLoad,
    error,
    actionFeedback,
    realtimeStatus,
    handleOpenSlot,
    handleCloseSlot,
    handleSkipSlot,
    handleResetAuction,
    handleCreateTopic,
    clearFeedback,
    refreshAll,
  } = useAdminAuction({
    autoSubscribeRealtime: true,
    pollIntervalMs: 15000,
  });

  // Modal States
  const [inspectModalSlot, setInspectModalSlot] = useState<AdminSlotWithDetails | null>(null);
  const [actionModalState, setActionModalState] = useState<AuctionActionModalState | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [isAddTopicModalOpen, setIsAddTopicModalOpen] = useState<boolean>(false);
  const [isExecutingAction, setIsExecutingAction] = useState<boolean>(false);

  // Pending slots for active controller launcher
  const pendingSlots = useMemo(() => {
    return slots.filter((s) => s.status === 'pending');
  }, [slots]);

  // Request action (opens confirmation modal)
  const handleRequestAction = useCallback(
    (slot: AdminSlotWithDetails, action: AuctionActionType) => {
      setActionModalState({
        isOpen: true,
        action,
        slot,
      });
    },
    []
  );

  // Execute confirmed slot action (open with startingBid, close, skip)
  const handleConfirmAction = useCallback(
    async (slotId: string, action: AuctionActionType, startingBid?: number) => {
      setIsExecutingAction(true);
      try {
        let success = false;
        if (action === 'open') {
          success = await handleOpenSlot(slotId, startingBid);
        } else if (action === 'close') {
          success = await handleCloseSlot(slotId);
        } else if (action === 'skip') {
          success = await handleSkipSlot(slotId);
        }

        if (success) {
          setActionModalState(null);
          // If modal inspect was open for this slot, close or update it
          setInspectModalSlot(null);
        }
      } finally {
        setIsExecutingAction(false);
      }
    },
    [handleOpenSlot, handleCloseSlot, handleSkipSlot]
  );

  // Execute full auction reset (Feature 2)
  const handleConfirmReset = useCallback(async () => {
    setIsExecutingAction(true);
    try {
      const success = await handleResetAuction();
      if (success) {
        setIsResetModalOpen(false);
        setActionModalState(null);
        setInspectModalSlot(null);
      }
    } finally {
      setIsExecutingAction(false);
    }
  }, [handleResetAuction]);

  // Execute add topic creation (Feature 3)
  const handleConfirmCreateTopic = useCallback(
    async (values: CreateTopicFormValues): Promise<boolean> => {
      setIsExecutingAction(true);
      try {
        const success = await handleCreateTopic(values);
        if (success) {
          setIsAddTopicModalOpen(false);
          return true;
        }
        return false;
      } finally {
        setIsExecutingAction(false);
      }
    },
    [handleCreateTopic]
  );

  return (
    <div className="space-y-6">
      {/* Universal Admin Subnav */}
      <AdminSubnav
        currentSection={activeTab}
        activeAuctionCount={activeSlot ? 1 : 0}
      />

      {/* ─────────────────────────────────────────────────────────────
          1. Header Controls: Title, Realtime Status & Manual Refresh
      ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight">
            Admin Auction Management
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Supervise contest slot queues, monitor live team bidding activity, and track topic allocations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Realtime Connection Status Pill */}
          {realtimeStatus === 'SUBSCRIBED' ? (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
              title="Realtime WebSocket connection active"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Realtime Live
            </span>
          ) : realtimeStatus === 'CONNECTING' ? (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
              title="Establishing connection to Realtime feed"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              Connecting...
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
              title="Operating in auto-polling fallback mode"
            >
              <span className="w-2 h-2 rounded-full bg-zinc-400" />
              Polling Mode (15s)
            </span>
          )}

          {/* Manual Refresh Button */}
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 shadow-2xs hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Force refresh auction data from database"
          >
            <svg
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-600' : 'text-zinc-500'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{isLoading ? 'Syncing...' : 'Sync All'}</span>
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. Action Feedback & Error Banners
      ────────────────────────────────────────────────────────────── */}
      {actionFeedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs transition-all ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionFeedback.type === 'success' ? (
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className="font-semibold">{actionFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={clearFeedback}
            className="text-sm font-bold opacity-60 hover:opacity-100 ml-4 leading-none"
          >
            &times;
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 flex items-start justify-between gap-3 text-sm">
          <div className="flex items-start gap-2.5">
            <svg
              className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="font-semibold">Failed to synchronize auction data</p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="text-xs font-semibold underline hover:no-underline text-red-700 dark:text-red-300 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. Sub-Tab Switcher Navigation
      ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto pb-px">
        {[
          { id: 'overview', label: 'Auction Overview' },
          { id: 'queue', label: 'Slot Queue', count: slots.length },
          {
            id: 'controller',
            label: 'Active Controller',
            badge: activeSlot ? 'LIVE' : undefined,
          },
          { id: 'feed', label: 'Live Bid Feed', count: recentBids.length },
          { id: 'allocations', label: 'Team Allocations', count: teamAllocations.length },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id as AuctionTabKey)}
              className={`inline-flex items-center gap-2 py-2.5 px-4 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse">
                  {tab.badge}
                </span>
              )}
              {tab.count !== undefined && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    isActive
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          4. Tab View Content
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Active Open Slot Live Callout Banner */}
          {activeSlot && (
            <div className="p-4 rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50/60 dark:bg-amber-950/20 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 font-mono">
                        LIVE BIDDING ACTIVE: Slot #{activeSlot.id.slice(0, 8)}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
                        {activeSlot.round === 1 ? 'Round 1 (Easy)' : 'Round 2 (Hard)'}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 mt-0.5">
                      {activeSlot.topic?.title ?? 'Auction Topic'}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-4 text-xs font-mono bg-white dark:bg-zinc-900 px-3.5 py-2 rounded-lg border border-amber-200 dark:border-amber-800/80 shadow-2xs">
                    <div>
                      <span className="text-zinc-400 block text-[10px] uppercase font-sans">Current Bid</span>
                      <span className="font-bold text-amber-600 dark:text-amber-400 text-sm">
                        {activeSlot.current_bid} pts
                      </span>
                    </div>
                    <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
                    <div>
                      <span className="text-zinc-400 block text-[10px] uppercase font-sans">Leading Team</span>
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {activeSlot.leader_team ? activeSlot.leader_team.name : 'Opens @ 10 pts'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleTabChange('controller')}
                    className="px-3 py-2 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-2xs transition-colors shrink-0"
                  >
                    Open Controller &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* KPI Statistics */}
          {isInitialLoad && !overviewStats ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-44 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
                >
                  <div className="flex justify-between items-center">
                    <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-800 rounded" />
                    <div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
                  </div>
                  <div className="h-8 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" />
                  <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full" />
                  <div className="h-3 w-36 bg-zinc-100 dark:bg-zinc-800 rounded" />
                </div>
              ))}
            </div>
          ) : overviewStats ? (
            <AuctionDashboardStats stats={overviewStats} isLoading={isLoading} />
          ) : (
            <div className="p-12 text-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                No auction slot data available. Please verify that database seed migrations have been applied.
              </p>
            </div>
          )}

          {/* Quick Slot Queue Teaser */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Live Slot Queue Snapshot
              </h3>
              <button
                type="button"
                onClick={() => handleTabChange('queue')}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                View Full Slot Queue ({slots.length}) &rarr;
              </button>
            </div>
            <SlotQueueTable
              slots={slots}
              isLoading={isLoading}
              onSelectSlot={(slot) => setInspectModalSlot(slot)}
              onRequestAction={handleRequestAction}
              isActionInProgress={isExecutingAction}
              onRequestReset={() => setIsResetModalOpen(true)}
              onRequestAddTopic={() => setIsAddTopicModalOpen(true)}
            />
          </div>
        </div>
      )}

      {activeTab === 'queue' && (
        <SlotQueueTable
          slots={slots}
          isLoading={isLoading}
          onSelectSlot={(slot) => setInspectModalSlot(slot)}
          onRequestAction={handleRequestAction}
          isActionInProgress={isExecutingAction}
          onRequestReset={() => setIsResetModalOpen(true)}
          onRequestAddTopic={() => setIsAddTopicModalOpen(true)}
        />
      )}

      {activeTab === 'controller' && (
        <ActiveSlotController
          activeSlot={activeSlot}
          pendingSlots={pendingSlots}
          recentBids={recentBids}
          onRequestAction={handleRequestAction}
          isActionInProgress={isExecutingAction}
          onRequestReset={() => setIsResetModalOpen(true)}
        />
      )}

      {activeTab === 'feed' && (
        <LiveBidFeed
          bids={recentBids}
          isLoading={isLoading}
          onRefresh={refreshAll}
        />
      )}

      {activeTab === 'allocations' && (
        <TeamAllocationTable
          allocations={teamAllocations}
          isLoading={isLoading}
          onRefresh={refreshAll}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. Action Confirmation Modal
      ────────────────────────────────────────────────────────────── */}
      <AuctionActionModal
        state={actionModalState}
        onClose={() => {
          if (!isExecutingAction) setActionModalState(null);
        }}
        onConfirm={handleConfirmAction}
        isExecuting={isExecutingAction}
      />

      {/* ─────────────────────────────────────────────────────────────
          6. Slot Criteria Inspect Modal
      ────────────────────────────────────────────────────────────── */}
      <SlotDetailsModal
        slot={inspectModalSlot}
        isOpen={inspectModalSlot !== null}
        onClose={() => setInspectModalSlot(null)}
        onRequestAction={handleRequestAction}
        isActionInProgress={isExecutingAction}
      />

      {/* ─────────────────────────────────────────────────────────────
          7. Auction Reset Confirmation Modal (Feature 2)
      ────────────────────────────────────────────────────────────── */}
      <AuctionResetModal
        isOpen={isResetModalOpen}
        onClose={() => {
          if (!isExecutingAction) setIsResetModalOpen(false);
        }}
        onConfirm={handleConfirmReset}
        isExecuting={isExecutingAction}
      />

      {/* ─────────────────────────────────────────────────────────────
          8. Add Topic Form Modal (Feature 3)
      ────────────────────────────────────────────────────────────── */}
      <AddTopicModal
        isOpen={isAddTopicModalOpen}
        onClose={() => {
          if (!isExecutingAction) setIsAddTopicModalOpen(false);
        }}
        onConfirm={handleConfirmCreateTopic}
        existingSlots={slots}
        isExecuting={isExecutingAction}
      />
    </div>
  );
}

export default function AdminAuctionPage() {
  const { user, role, signOut } = useAdminAuth();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      <AdminHeader
        userEmail={user?.email}
        role={role}
        onSignOut={user ? signOut : undefined}
        currentPage="Auction"
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        <AdminAuthGuard>
          <Suspense
            fallback={
              <div className="p-12 text-center text-xs text-zinc-400">
                <span className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin inline-block mr-2" />
                Loading Admin Auction Console...
              </div>
            }
          >
            <AdminAuctionInner />
          </Suspense>
        </AdminAuthGuard>
      </main>
    </div>
  );
}
