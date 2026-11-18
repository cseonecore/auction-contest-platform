"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAdminAuth } from "@/features/admin/hooks/useAdminAuth";
import { useAdminAuction } from "@/features/admin/hooks/useAdminAuction";
import {
  openSlot,
  selectAuctionQuestion,
  openBidding,
  closeBidding,
  skipSlot,
  pauseAuction,
  resumeAuction,
  endAuctionSession,
  advanceAuction,
  createAuctionTopic,
} from "@/features/admin/services/adminAuctionService";
import { fetchAllSlotsWithDetails } from "@/features/admin/services/auctionAdminService";
import { AddTopicModal } from "./AddTopicModal";
import { AuctionTimerControl } from "./AuctionTimerControl";

interface AdminAuctionControlPanelProps {
  sessionStatus: string | null;
  sessionPaused: boolean;
  activeSlotId: string | null;
  activeSlotTitle: string | null;
  pendingSlots: Array<{ id: string; title: string; round: number }>;
  pending: string | null;
  onStart: () => void;
  onSelect: (slotId: string) => void;
  onOpenBidding: () => void;
  onCloseBidding: () => void;
  onFinalize: () => void;
  onAdvance: () => void;
  onSkip: (slotId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onReset: () => void;
}

function getButtonClasses1(
  busy: boolean,
  baseCls: string,
  hoverCls: string
): string {
  return busy ? "opacity-50 cursor-not-allowed" : "px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors hover:" + hoverCls + " text-white";
}

function getButtonClasses2(
  busy: boolean,
  baseCls: string,
  hoverCls: string
): string {
  return busy
    ? "opacity-50 cursor-not-allowed"
    : "px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed " + baseCls + " hover:" + hoverCls;
}

function getButtonClasses(
  busy: boolean,
  baseCls: string,
  hoverCls: string
): string {
  return busy ? "opacity-50 cursor-not-allowed" : "px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors hover:" + hoverCls + " text-white";
}

export function AdminAuctionControlPanel({
  sessionStatus,
  sessionPaused,
  activeSlotId,
  activeSlotTitle,
  pendingSlots,
  pending,
  onStart,
  onSelect,
  onOpenBidding,
  onCloseBidding,
  onFinalize,
  onAdvance,
  onSkip,
  onPause,
  onResume,
  onEnd,
  onReset,
}: AdminAuctionControlPanelProps) {
  const { isAdmin } = useAdminAuth();
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    imported: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [manualTopic, setManualTopic] = useState({
    title: "",
    description: "",
    level: "easy" as "easy" | "hard",
  });
  const [showAddTopicModal, setShowAddTopicModal] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState<{
    type: "delete" | "reset";
    message: string;
    slotId?: string;
  } | null>(null);
  const [selectedSlotForAction, setSelectedSlotForAction] = useState<string | null>(null);

  const busy = (key: string) => pending === key;

  // Determine if previous slot navigation is disabled
  const isPreviousSlotDisabled = useMemo(() => {
    if (!activeSlotId) return true;
    // Find current slot index and check if there's a previous pending slot
    const currentIdx = pendingSlots.findIndex((s: any) => s.id === activeSlotId);
    return currentIdx <= 0; // No previous slot available
  }, [activeSlotId, pendingSlots]);

  const totalSlots = useMemo(() => Math.min(pendingSlots.length + 1, 60), [pendingSlots]);

  const currentSlotPosition = useMemo(() => {
    if (!activeSlotId) return 1;
    const idx = pendingSlots.findIndex((s: any) => s.id === activeSlotId);
    return idx >= 0 ? idx + 1 : 1;
  }, [activeSlotId, pendingSlots]);

  const slotProgress = currentSlotPosition + " / " + Math.min(pendingSlots.length + 1, 60);

  const timerState = useMemo(() => {
    if (!activeSlotId) {
      return { minutes: "00", seconds: "10", status: "idle" };
    }
    const baseSeconds = 10;
    const elapsed = Math.max(0, baseSeconds - 1);
    const remaining = Math.max(0, baseSeconds - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    let status = "running";
    if (sessionPaused) status = "paused";
    if (remaining <= 0) status = "expired";
    return {
      minutes: String(minutes).padStart(2, "0"),
      seconds: String(seconds).padStart(2, "0"),
      status,
    };
  }, [activeSlotId, sessionPaused]);

  const showConfirmDialog = useCallback(
    (type: "delete" | "reset", message: string, slotId?: string) => {
      setSelectedSlotForAction(slotId || "");
      setShowConfirmation({ type, message, slotId });
    },
    []
  );

  const handleConfirmationConfirm = useCallback(async () => {
    setShowConfirmation(null);
    const sid = selectedSlotForAction;
    if (showConfirmation?.type === "delete" && onSkip && sid) {
      await onSkip(sid);
    }
  }, [selectedSlotForAction, onSkip, showConfirmation]);

  const handleConfirmationCancel = useCallback(() => {
    setShowConfirmation(null);
    setSelectedSlotForAction("");
  }, []);

  // Safe previous slot navigation
  // Finds the previous pending slot and selects it without opening bidding
  // If no previous pending slot exists, the navigation is disabled
  const handlePreviousSlot = useCallback(() => {
    if (!activeSlotId) return;
    const currentIdx = pendingSlots.findIndex((s: any) => s.id === activeSlotId);
    if (currentIdx <= 0) return; // No previous slot available
    
    const previousSlot = pendingSlots[currentIdx - 1];
    // Only navigate to pending slots - this is safe navigation
    // that doesn't reopen or modify completed slots
    if (previousSlot && (previousSlot as any).status === 'pending') {
      // Select the previous slot using existing functionality
      // This just changes the viewed slot without opening bidding
      setSelectedSlot(previousSlot.id);
    }
  }, [activeSlotId, pendingSlots]);

  const handleImportFile = useCallback(
    async (file: File) => {
      if (!isAdmin) return;
      setImporting(true);
      try {
        const text = await file.text();
        const rows = parseCsvRows(text);

        const requiredColumns = ["title", "description"];
        const headerRow = rows[0];
        if (!headerRow) {
          setImportResult({ success: false, imported: 0, failed: 0, errors: ["Empty file"] });
          return;
        }
        const hasRequired = requiredColumns.every(
          (col: string) =>
            headerRow.some((h: string) => h.toLowerCase() === col)
        );

        if (!hasRequired) {
          setImportResult({
            success: false,
            imported: 0,
            failed: rows.length - 1,
            errors: ["CSV must contain 'title' and 'description' columns."],
          });
          return;
        }

        let imported = 0;
        let failed = 0;
        const errors: string[] = [];

        for (let i = 1; i < rows.length; i++) {
          if (!rows[i].trim()) continue;
          const row: any = rows[i];
          if (!row.title || row.title.trim() === "") {
            failed++;
            errors.push("Row " + (i + 1) + ": Missing problem title.");
            continue;
          }
          const duplicate = pendingSlots.find(
            (s: any) => s.title?.toLowerCase() === row.title.toLowerCase()
          );
          if (duplicate) {
            failed++;
            errors.push("Row " + (i + 1) + ': Duplicate topic title "' + row.title + '".');
            continue;
          }
          if (pendingSlots.length >= 60) {
            failed++;
            errors.push("Row " + (i + 1) + ": Maximum of 60 slots reached.");
            continue;
          }
          imported++;
        }

        setImportResult({
          success: imported > 0,
          imported,
          failed,
          errors: errors.length > 0 ? errors : [],
        });
      } catch (err) {
        setImportResult({ success: false, imported: 0, failed: 0, errors: ["Failed to process file."] });
      } finally {
        setImporting(false);
      }
    },
    [isAdmin, pendingSlots]
  );

  const handleImportConfirm = useCallback(async () => {
    if (importResult?.success) {
      setShowImportModal(false);
      setImportResult(null);
    }
  }, [importResult]);

  const handleImportCancel = useCallback(() => {
    setShowImportModal(false);
    setImportResult(null);
  }, []);

  const handleManualTopicSubmit = useCallback(() => {
    if (!manualTopic.title.trim()) return;
    setShowAddTopicModal(false);
  }, [manualTopic]);

  const renderImportModal = useMemo(() => {
    if (!showImportModal) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md w-full shadow-2xl">
          <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
            Bulk Import Slots
          </h3>
          <p className="text-zinc-500 dark:text-zinc-400 mb-4">
            Upload CSV file to import problem statements as auction slots.
            Maximum 60 slots allowed.
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                handleImportFile(e.target.files[0]);
                setShowImportModal(true);
              }
            }}
            className="w-full border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-900 dark:text-zinc-100 cursor-pointer mb-3"
          />
          <button onClick={handleImportCancel} className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50">
            Cancel
          </button>
          {importResult && (
            <div className="mt-4 p-3 rounded-lg">
              {importResult.success
                ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300"
                : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300"}
              <div className="flex items-center gap-2">
                {importResult.success && <span className="text-emerald-600">{importResult.imported} slot(s) imported successfully</span>}
                {importResult.failed > 0 && (
                  <span className="text-rose-600">
                    {importResult.failed} slot(s) failed{" "}
                    {importResult.errors?.length > 0 ? (
                      <span>
                        {importResult.errors.map(
                          (e: string, idx: number) => <span key={idx} className="mt-1 block text-sm">• {e}</span>
                        )}
                      </span>
                    ) : ""}
                  </span>
                )}
              </div>
            </div>
          )}
          <button onClick={handleImportConfirm} disabled={!importResult?.success} className="w-full px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white mt-3 transition-colors disabled:opacity-50">
            {importResult?.success ? "Confirm Import" : "Import Slots"}
          </button>
        </div>
      </div>
    );
  }, [showImportModal, importing, importResult, handleImportCancel, handleImportConfirm]);

  const renderAddTopicModal = useMemo(() => {
    if (!showAddTopicModal) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md w-full shadow-2xl">
          <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
            Add New Topic
          </h3>
          <form onSubmit={(e: React.FormEvent) => { e.preventDefault(); handleManualTopicSubmit(); }} className="space-y-4">
            <div>
              <label className="block text-zinc-400 dark:text-zinc-300 text-sm font-medium mb-1">
                Problem Topic
              </label>
              <input
                type="text"
                value={manualTopic.title}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setManualTopic({ ...manualTopic, title: e.target.value })}
                placeholder="e.g. Implement a binary search algorithm"
                className="w-full border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-zinc-400 dark:text-zinc-300 text-sm font-medium mb-1">
                Problem Statement (brief)
              </label>
              <input
                type="text"
                value={manualTopic.description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setManualTopic({ ...manualTopic, description: e.target.value })}
                placeholder="Brief description of the problem"
                className="w-full border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-zinc-400 dark:text-zinc-300 text-sm font-medium mb-1">
                  Level
                </label>
                <select
                  value={manualTopic.level}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setManualTopic({ ...manualTopic, level: e.target.value as "easy" | "hard" })}
                  className="w-full border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="easy">Round 1 (Easy)</option>
                  <option value="hard">Round 2 (Hard)</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors">
                Create Slot
              </button>
              <button type="button" onClick={() => setShowAddTopicModal(false)} className="flex-1 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-400 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 mt-1 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }, [showAddTopicModal, manualTopic, handleManualTopicSubmit]);

  const renderConfirmationDialog = useMemo(() => {
    if (!showConfirmation) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-8 max-w-md w-full shadow-2xl">
          <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-6">
            Confirmation
          </h3>
          <p className="text-zinc-500 dark:text-zinc-400 mb-8">
            {showConfirmation!.message}
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowConfirmation(null)} className="flex-1 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-400 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
            <button onClick={handleConfirmationConfirm} className="flex-1 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium transition-colors disabled:opacity-50">
              {showConfirmation!.type === "delete" ? "Delete" : "Reset"}
            </button>
          </div>
        </div>
      </div>
    );
  }, [showConfirmation, handleConfirmationConfirm]);

  const timerStatusClass = useMemo(() => {
    if (timerState.status === "expired") return "text-zinc-500";
    if (timerState.status === "paused") return "text-amber-400";
    return "text-[#78350f]";
  }, [timerState.status]);

  const renderTimer = useMemo(() => (
    <div className="mb-4 flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Time Left</span>
      <span className={timerStatusClass}>
        {timerState.minutes}:{timerState.seconds}
      </span>
    </div>
  ), [timerState]);

  const renderSlotProgress = useMemo(() => (
    <div className="mb-4 text-sm text-zinc-400 dark:text-zinc-500">
      <span>Slot Progress</span>
      <span className="font-mono text-zinc-200 font-bold ml-2">{slotProgress}</span>
    </div>
  ), [slotProgress]);

  const renderPrimaryControls = useMemo(() => {
    // Top-level: Session status and controls
    if (!activeSlotId) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          {isAdmin && !sessionStatus && (
            <button type="button" onClick={onStart} disabled={!!pending} className={getButtonClasses(busy("start"), "bg-emerald-600 hover:bg-emerald-500 text-white", "bg-emerald-500")}>
              Start Session
            </button>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setShowImportModal(true)} disabled={!!pending} className={getButtonClasses2(busy("import"), "bg-orange-600 hover:bg-orange-500 text-white", "bg-orange-500")}>
              Upload Slots
            </button>
          )}
          {isAdmin && (
            <a href="/projector/auction" target="_blank" rel="noopener noreferrer" className={getButtonClasses2(busy("projector"), "bg-indigo-600 hover:bg-indigo-500 text-white", "bg-indigo-500")}>
              Projector
            </a>
          )}
        </div>
      );
    }
    // Slot has active - show session controls and slot management
    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-base font-bold text-white">
            Auction Control
          </h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Session:
            <span className="font-mono text-zinc-200">
              {sessionStatus ? sessionStatus.replace(/_/g, " ").toUpperCase() : "NOT STARTED"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sessionStatus ? (
            <button type="button" onClick={onEnd} disabled={!!pending} className="px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700">
              End Session
            </button>
          ) : (
            <button type="button" onClick={onStart} disabled={!!pending} className="px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-500 text-white">
              Start Session
            </button>
          )}
        </div>
      </div>
    );
  }, [
    activeSlotId,
    sessionStatus,
    sessionPaused,
    pending,
    onStart,
    onEnd,
    isAdmin,
  ]);

  const {
    overviewStats,
    slots,
    teamAllocations,
    recentBids,
  } = useAdminAuction();

  const renderLeaderboard = useMemo(() => {
    const teams = teamAllocations?.map((t: any) => ({
      id: t.team_id,
      name: t.team_name,
      balance: t.wallet_balance,
      currentBid: t.current_bid || 0,
      wonSlots: t.round1_slot ? [t.round1_slot] : t.round2_slot ? [t.round2_slot] : [] as any[],
      elimination: t.elimination,
    })) || [];

    const sortedTeams = [...teams].sort(
      (a: any, b: any) => b.wonSlots.length - a.wonSlots.length
    );

    if (sortedTeams.length === 0) {
      return (
        <div className="mt-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
            Live Leaderboard
          </h3>
          <p className="text-zinc-500 dark:text-zinc-400">No teams have acquired any questions yet.</p>
          <a href="/projector/auction" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-indigo-600 hover:bg-indigo-500 text-indigo-600 dark:border-indigo-900/60 dark:text-indigo-400 text-xs font-medium transition-colors">
            Project
          </a>
        </div>
      );
    }

    const getTeamStyle = (team: any, index: number) => {
      if (index === 0) return "bg-[#15803d] border-emerald-400/40 text-white shadow-emerald-950/40";
      if (index === 1) return "bg-[#a16207] border-yellow-400/40 text-white shadow-yellow-950/40";
      if (index === 2) return "bg-[#9a3412] border-amber-400/40 text-white shadow-amber-950/40";
      return "bg-[#1e293b] border-slate-500/40 text-white";
    };

    return (
      <div className="mt-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
          Live Leaderboard
        </h3>
        <p className="text-zinc-500 dark:text-zinc-400">{sortedTeams.length} Teams</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {sortedTeams.map((team: any, index: number) => (
            <div
              key={team.id}
              className={`rounded-full py-2 px-3 sm:px-3.5 flex items-center justify-between shadow-md border transition-all duration-200 ${getTeamStyle(team, index)}`}
            >
              <div className="w-10 h-10 rounded-full bg-white/10 p-0.5 overflow-hidden shrink-0 flex items-center justify-center border border-white/20">
                <span className="text-[11px] font-black text-zinc-300">
                  {team.name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 ml-3 text-left overflow-hidden">
                <div className="text-[11px] font-semibold text-white/90 truncate leading-tight flex items-center gap-1">
                  {team.name}
                </div>
                <div className="text-xl sm:text-2xl font-black text-white leading-tight font-sans tracking-tight">
                  {team.wonSlots.length}
                </div>
              </div>
            </div>
          ))}
        </div>
        <a href="/projector/auction" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-indigo-600 hover:bg-indigo-500 text-indigo-600 dark:border-indigo-900/60 dark:text-indigo-400 text-xs font-medium transition-colors">
          Project
        </a>
      </div>
    );
  }, [teamAllocations]);

  const renderProblemStatementCard = useMemo(() => {
    const slotData = slots.find((s: any) => s.id === activeSlotId);

    if (!activeSlotId) {
      return (
        <div className="rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50/80 dark:bg-amber-950/30 p-8 text-center">
          <p className="text-zinc-400 dark:text-zinc-300">
            No auction slot active. Select a pending slot to open.
          </p>
        </div>
      );
    }

    const selectedSlot = slotData || slots.find((s: any) => s.id === activeSlotId);
    if (!selectedSlot) {
      return (
        <div className="rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50/80 dark:bg-amber-950/30 p-8 text-center">
          <p className="text-zinc-400 dark:text-zinc-300">Slot not found.</p>
        </div>
      );
    }

    const topic = selectedSlot.topic;
    const isBiddingOpen = selectedSlot.status === "open";
    const isPaused = selectedSlot.timer_status === "paused";

    return (
      <div className="rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50/80 dark:bg-amber-950/30 p-6 shadow-md relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Problem Statement
            </span>
            <h2 className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50 mt-1">
              {topic?.title ?? "Unknown Topic"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
              {currentSlotPosition} / {totalSlots}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
              {timerState.minutes}m {timerState.seconds}s
            </span>
          </div>
        </div>
        {topic?.description && <p className="mt-3 text-zinc-700 dark:text-zinc-300 leading-relaxed">{topic?.description}</p>}
        {topic?.criterion && (
          <div className="mt-4 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800/60 bg-zinc-900/50 dark:bg-zinc-950/40 text-sm">
            <div className="font-bold text-zinc-300 uppercase tracking-wider mb-1">
              Evaluation Criterion
            </div>
            <code className="text-zinc-200 whitespace-pre-wrap">
              {typeof topic.criterion === "object"
                ? JSON.stringify(topic.criterion, null, 2)
                : String(topic.criterion)}
            </code>
          </div>
        )}
        {/* Navigation controls at bottom-right */}
        <div className="absolute bottom-2 right-2 flex gap-2">
          {/* Previous Slot - navigate to previous pending slot safely */}
          <button
            onClick={() => handlePreviousSlot()}
            disabled={!activeSlotId || isPreviousSlotDisabled}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            title="Previous Slot"
          >
            Previous
          </button>
          {/* Next Slot - advance to next auction item */}
          <button
            onClick={() => onAdvance()}
            disabled={!activeSlotId || busy("advance")}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            title="Next Slot"
          >
            Next
          </button>
          {/* Skip Slot - mark current slot as skipped */}
          <button
            onClick={() => onSkip(activeSlotId!)}
            disabled={!activeSlotId || busy("skip")}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors bg-rose-600 hover:bg-rose-500 text-white shadow-sm"
            title="Skip Slot"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }, [activeSlotId, currentSlotPosition, totalSlots, timerState, slots, onAdvance, onSkip, busy]);

  return (
    <div className="bg-[#1a1b1f] border border-zinc-800/80 rounded-2xl p-5 shadow-xl space-y-5">
      {/* Top-level controls */}
      {renderPrimaryControls}
      
      {/* Slot management controls - above problem statement card */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Open Slot / Close Slot */}
        {activeSlotId ? (
          <>
            <button type="button" onClick={onOpenBidding} disabled={busy("openBidding")} className={getButtonClasses1(busy("openBidding"), "bg-emerald-600 hover:bg-emerald-500 text-white", "bg-emerald-500")}>
              Open Slot
            </button>
            <button type="button" onClick={onCloseBidding} disabled={busy("closeBidding") || !activeSlotId} className={getButtonClasses1(busy("closeBidding"), "bg-blue-600 hover:bg-blue-700 text-white", "bg-blue-700")}>
              Close Slot
            </button>
          </>
        ) : null}
        
        {/* Pause Slot / Resume Slot */}
        {activeSlotId && !sessionPaused && (
          <button type="button" onClick={onPause} disabled={busy("pause")} className={getButtonClasses1(busy("pause"), "bg-emerald-600 hover:bg-emerald-500 text-white", "bg-emerald-500")}>
            Pause Slot
          </button>
        )}
        {sessionPaused && (
          <button type="button" onClick={onResume} disabled={busy("resume")} className={getButtonClasses1(busy("resume"), "bg-emerald-600 hover:bg-emerald-500 text-white", "bg-emerald-500")}>
            Resume Slot
          </button>
        )}
        
        {/* Add Slot - currently missing, restore it */}
        <button type="button" onClick={() => setShowAddTopicModal(true)} disabled={!!pending} className={getButtonClasses2(busy("addTopic"), "bg-emerald-600 hover:bg-emerald-500 text-white", "bg-emerald-500")}>
          Add Slot
        </button>
        
        {/* Reset Slot */}
        <button type="button" onClick={onReset} disabled={!!pending} className={getButtonClasses2(busy("reset"), "bg-emerald-600 hover:bg-emerald-500 text-white", "bg-emerald-500")}>
          Reset Slot
        </button>
        
        {/* Delete Slot - Red */}
        <button type="button" onClick={() => showConfirmDialog("reset", "Are you sure you want to reset the auction?", undefined)} disabled={!!pending} className={getButtonClasses1(busy("delete"), "bg-rose-600 hover:bg-rose-500 text-white", "bg-rose-500")}>
          Delete Slot
        </button>
      </div>
      
      {/* Problem statement card */}
      {renderProblemStatementCard}
      
      {/* Live leaderboard - directly below problem statement card */}
      {renderLeaderboard}
      
      {/* Modals */}
      {renderImportModal}
      {renderAddTopicModal}
      {renderConfirmationDialog}
      {renderTimer}
      {renderSlotProgress}
    </div>
  );
}

function parseCsvRows(text: string) {
  const lines = text.split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h: string) => h.trim().toLowerCase());
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(",").map((v: string) => v.trim());
    const row: any = {};
    headers.forEach((header: string, idx: number) => {
      row[header] = values[idx] || "";
    });
    rows.push(row);
  }
  return rows;
}