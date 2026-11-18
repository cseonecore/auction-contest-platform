"use client";

/**
 * AdminAuctionRoom — the live auction controller.
 *
 * A compact, dark, three-section surface (per the original auction design):
 *   1. Session controls   — Upload Slots + Start/Stop Session
 *   2. Main container     — five slot buttons + problem statement card
 *   3. Live leaderboard   — one "Lead board" grid + one Project button
 *
 * Everything is wired to the secure backend: the authoritative live state
 * (`get_live_auction_state`) drives the timer and session flags, and every
 * button calls an existing SECURITY DEFINER RPC through the admin service
 * layer. No placeholder handlers, no mock data.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuction } from "../hooks/useAuction";
import { useAuctionTimer } from "../hooks/useAuctionTimer";
import { useAdminAuction } from "@/features/admin/hooks/useAdminAuction";
import { useAdminAuctionActions } from "@/features/admin/hooks/useAdminAuctionActions";
import { createAuctionTopic } from "@/features/admin/services/auctionAdminService";
import { AddTopicModal } from "@/features/admin/components/auction/AddTopicModal";
import { LeaderboardCapsule } from "./LeaderboardCapsule";
import type { AuctionItem } from "../types/auction.types";
import type {
  AdminSlotWithDetails,
  CreateTopicFormValues,
} from "@/features/admin/types/auctionAdmin";

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────

/** Formats remaining seconds as "00m 10s" (reference clock style). */
function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/** Zero-padded two-digit display for progress counts. */
function pad2(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

/**
 * Splits a topic description into a brief (first sentence/paragraph) and
 * the remaining detailed description. The database stores one description
 * column, so the brief is derived — never invented.
 */
function splitBrief(description: string | null | undefined): {
  brief: string;
  detail: string;
} {
  const text = (description ?? "").trim();
  if (!text) return { brief: "", detail: "" };

  const match = text.match(/^[\s\S]*?([.!?)\n])/);
  if (!match) return { brief: text, detail: "" };

  const end = (match.index ?? 0) + match[0].length;
  const brief = text.slice(0, end).trim();
  const detail = text.slice(end).trim();
  return detail ? { brief, detail } : { brief, detail: "" };
}

/**
 * Minimal RFC-4180 CSV parser: quoted fields, embedded commas, newlines
 * and escaped double quotes are supported.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

interface CsvProblemRow {
  title: string;
  description: string;
  level: "easy" | "hard";
  startingBid: number;
}

const MAX_SLOTS = 60;

// ─────────────────────────────────────────────────────────────
// Shared button styles
// ─────────────────────────────────────────────────────────────

const BTN_BASE =
  "px-4 py-2 rounded-lg text-xs font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";
const BTN_GREEN = `${BTN_BASE} bg-emerald-600 hover:bg-emerald-500`;
const BTN_NEUTRAL = `${BTN_BASE} bg-zinc-700 hover:bg-zinc-600`;
const BTN_RED = `${BTN_BASE} bg-rose-600 hover:bg-rose-500`;
const BTN_ORANGE = `${BTN_BASE} bg-[#fe5102] hover:bg-[#d94502]`;
const BTN_BLUE = `${BTN_BASE} bg-blue-600 hover:bg-blue-500`;

// ─────────────────────────────────────────────────────────────
// Confirmation dialog
// ─────────────────────────────────────────────────────────────

interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  tone: "danger" | "neutral";
  run: () => Promise<unknown>;
}

function ConfirmDialog({
  request,
  busy,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!request) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="bg-[#1b1c21] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-black text-white">{request.title}</h3>
        <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{request.body}</p>
        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`${BTN_BASE} border border-white/15 bg-transparent hover:bg-white/5 text-zinc-300`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={request.tone === "danger" ? BTN_RED : BTN_GREEN}
          >
            {busy ? "Working…" : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Upload Slots modal (CSV import → create_auction_topic RPCs)
// ─────────────────────────────────────────────────────────────

interface UploadState {
  open: boolean;
  fileName: string | null;
  rows: CsvProblemRow[];
  error: string | null;
  notice: string | null;
  importing: boolean;
  progress: { done: number; total: number } | null;
  result: { imported: number; failed: number; errors: string[] } | null;
}

const EMPTY_UPLOAD: UploadState = {
  open: false,
  fileName: null,
  rows: [],
  error: null,
  notice: null,
  importing: false,
  progress: null,
  result: null,
};

function UploadSlotsModal({
  state,
  capacity,
  onClose,
  onFile,
  onImport,
}: {
  state: UploadState;
  capacity: number;
  onClose: () => void;
  onFile: (file: File) => void;
  onImport: (rows: CsvProblemRow[]) => void;
}) {
  if (!state.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={() => {
        if (!state.importing) onClose();
      }}
    >
      <div
        className="bg-[#1b1c21] border border-white/10 rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-black text-white">Upload Slots</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Import problem statements from a CSV file. Required columns:
              <span className="font-mono text-zinc-200"> title</span>,
              <span className="font-mono text-zinc-200"> description</span>.
              Optional: <span className="font-mono text-zinc-200">level</span>{" "}
              (easy/hard), <span className="font-mono text-zinc-200">starting_bid</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={state.importing}
            className="text-zinc-500 hover:text-white text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {state.error && (
          <div className="mt-4 rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
            {state.error}
          </div>
        )}
        {state.notice && !state.error && (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
            {state.notice}
          </div>
        )}

        {!state.result && (
          <label className="mt-4 block cursor-pointer rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-6 text-center hover:border-white/30">
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={state.importing}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onFile(file);
              }}
            />
            <span className="text-xs font-bold text-zinc-200">
              {state.fileName ? state.fileName : "Choose a CSV file"}
            </span>
            <span className="mt-1 block text-[11px] text-zinc-500">
              Excel (.xlsx) import is planned — please export to CSV.
            </span>
          </label>
        )}

        {state.rows.length > 0 && !state.result && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>
                <span className="font-black text-white">{state.rows.length}</span>{" "}
                problem statement{state.rows.length === 1 ? "" : "s"} ready
              </span>
              <span>
                Capacity remaining: <span className="text-zinc-200">{capacity}</span>
              </span>
            </div>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-white/5 text-zinc-500">
                  <tr>
                    <th className="px-3 py-1.5 font-bold">#</th>
                    <th className="px-3 py-1.5 font-bold">Title</th>
                    <th className="px-3 py-1.5 font-bold">Level</th>
                    <th className="px-3 py-1.5 font-bold">Start</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {state.rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-3 py-1.5 text-zinc-500">{i + 1}</td>
                      <td className="px-3 py-1.5 truncate max-w-[240px]">{r.title}</td>
                      <td className="px-3 py-1.5 capitalize">{r.level}</td>
                      <td className="px-3 py-1.5 font-mono">{r.startingBid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {state.rows.length > 8 && (
              <p className="mt-1 text-[11px] text-zinc-500">
                and {state.rows.length - 8} more…
              </p>
            )}
          </div>
        )}

        {state.progress && (
          <p className="mt-4 text-xs font-bold text-sky-300">
            Importing {state.progress.done} / {state.progress.total}…
          </p>
        )}

        {state.result && (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs">
            <p className="font-bold text-emerald-400">
              {state.result.imported} imported
              {state.result.failed > 0 ? `, ${state.result.failed} failed` : ""}
            </p>
            {state.result.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-rose-300 list-disc list-inside max-h-32 overflow-y-auto">
                {state.result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={state.importing}
            className={`${BTN_BASE} border border-white/15 bg-transparent hover:bg-white/5 text-zinc-300`}
          >
            {state.result ? "Done" : "Cancel"}
          </button>
          {!state.result && (
            <button
              type="button"
              onClick={() => onImport(state.rows)}
              disabled={state.importing || state.rows.length === 0 || capacity <= 0}
              className={BTN_GREEN}
            >
              {state.importing
                ? `Importing ${state.progress?.done ?? 0}…`
                : `Import ${state.rows.length} slot${state.rows.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// The room
// ─────────────────────────────────────────────────────────────

export function AdminAuctionRoom() {
  // ── Authoritative live state (session, timer fields, teams) ──
  const { state, refresh: refreshLive } = useAuction();

  // ── Admin slot queue + slot-scoped actions ──
  const {
    slots,
    activeSlot,
    teamAllocations,
    isLoading,
    error: loadError,
    actionInProgress,
    actionFeedback,
    handleSkipSlot,
    handleResetAuction,
    handleCreateTopic,
    clearFeedback,
    refreshAll,
  } = useAdminAuction({ autoSubscribeRealtime: true, pollIntervalMs: 15000 });

  // ── Session-scoped actions (start / pause / resume / end / advance) ──
  const onActionsRefresh = useCallback(() => {
    refreshAll();
    void refreshLive();
  }, [refreshAll, refreshLive]);

  const actions = useAdminAuctionActions({
    onRefresh: onActionsRefresh,
    activeSlotId: state.active_slot?.id ?? null,
  });

  // ── Derived: session ────────────────────────────────────────
  const session = state.session;
  const sessionActive =
    (!!session &&
      [
        "ready",
        "question_selection",
        "bidding_open",
        "bidding_closed",
        "finalizing",
        "question_assigned",
        "solving",
      ].includes(session.status)) ||
    !!activeSlot;
  const auctionPaused = !!session?.is_paused || activeSlot?.timer_status === "paused";

  // ── Derived: live item (state first, slot queue as fallback) ──
  const liveItem: AuctionItem | null = useMemo(() => {
    if (state.active_slot && state.active_slot.status === "open") {
      return state.active_slot;
    }
    if (!activeSlot) return null;
    return {
      id: activeSlot.id,
      status: "open",
      round: activeSlot.round,
      current_bid: activeSlot.current_bid,
      min_bid: activeSlot.min_bid,
      min_next_bid: activeSlot.current_bid,
      leader_team_id: activeSlot.leader_team_id,
      leader_team_name: activeSlot.leader_team?.name ?? null,
      winner_team_id: null,
      winner_team_name: null,
      end_time: activeSlot.end_time,
      timer_status: activeSlot.timer_status ?? "running",
      paused_remaining_seconds: activeSlot.paused_remaining_seconds ?? 0,
      question_number: activeSlot.question_number ?? null,
      topic: activeSlot.topic
        ? {
            id: activeSlot.topic.id,
            level: activeSlot.topic.level,
            title: activeSlot.topic.title,
            description: activeSlot.topic.description,
            criterion: activeSlot.topic.criterion,
          }
        : null,
    };
  }, [state.active_slot, activeSlot]);

  // ── Derived: pending queue + browsing pointer ───────────────
  const pendingQueue = useMemo(
    () =>
      slots
        .filter((s) => s.status === "pending")
        .sort(
          (a, b) =>
            a.round - b.round ||
            (a.question_number ?? MAX_SLOTS + 1) - (b.question_number ?? MAX_SLOTS + 1) ||
            a.id.localeCompare(b.id)
        ),
    [slots]
  );

  const [viewedId, setViewedId] = useState<string | null>(null);

  useEffect(() => {
    if (liveItem) return;
    if (viewedId && pendingQueue.some((s) => s.id === viewedId)) return;
    setViewedId(pendingQueue[0]?.id ?? null);
  }, [liveItem, viewedId, pendingQueue]);

  const viewedSlot = useMemo(
    () => pendingQueue.find((s) => s.id === viewedId) ?? null,
    [pendingQueue, viewedId]
  );

  const totalCount = slots.length;

  const orderedPosition = useCallback(
    (slotId: string): number | null => {
      const idx = slots.findIndex((s) => s.id === slotId);
      return idx >= 0 ? idx + 1 : null;
    },
    [slots]
  );

  // ── Timer (server-authoritative, frozen while paused) ───────
  const countdown = useAuctionTimer({
    endTime: liveItem?.end_time ?? null,
    serverTime: state.server_time,
    running: liveItem?.timer_status === "running",
    paused: liveItem?.timer_status === "paused",
    pausedRemainingSeconds: liveItem?.paused_remaining_seconds ?? 0,
    onExpire: () => void refreshLive(),
  });

  // ── Feedback (combined + auto-dismiss successes) ────────────
  const feedback = actions.feedback ?? actionFeedback;

  useEffect(() => {
    if (!feedback || feedback.type !== "success") return;
    const timer = setTimeout(() => {
      actions.clearFeedback();
      clearFeedback();
    }, 6000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  const busy = !!actions.pending || !!actionInProgress;

  // ── Modals ──────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [upload, setUpload] = useState<UploadState>(EMPTY_UPLOAD);

  // ── Actions ─────────────────────────────────────────────────
  const viewedNumber = viewedSlot
    ? viewedSlot.question_number ?? orderedPosition(viewedSlot.id) ?? 1
    : 0;
  const displayNumber = liveItem
    ? liveItem.question_number ?? orderedPosition(liveItem.id) ?? 1
    : viewedNumber;
  const cardItem = liveItem ?? viewedSlot;
  const isLive = !!liveItem;

  const viewedIndex = pendingQueue.findIndex((s) => s.id === viewedId);
  const canPrevious = !isLive && viewedIndex > 0;
  const canNextBrowse = !isLive && viewedIndex >= 0 && viewedIndex < pendingQueue.length - 1;
  const canNextLive = isLive && sessionActive;

  /** Open Slot — publishes the viewed pending item and starts its 10s window. */
  const handleOpenSlot = useCallback(async () => {
    if (!viewedSlot) return;
    const ok = await actions.openBidding(viewedSlot.id);
    if (ok) void refreshLive();
  }, [actions, viewedSlot, refreshLive]);

  /** Close Slot — settles the live item (sold to leader or skipped). */
  const handleCloseSlot = useCallback(async () => {
    if (!liveItem) return;
    const ok = await actions.closeBidding(liveItem.id);
    if (ok) void refreshLive();
  }, [actions, liveItem, refreshLive]);

  /** Skip — removes the current item from play via the backend RPC. */
  const handleSkip = useCallback(async () => {
    if (!cardItem) return;
    const ok = await handleSkipSlot(cardItem.id);
    if (ok) void refreshLive();
  }, [handleSkipSlot, cardItem, refreshLive]);

  const requestStop = useCallback(() => {
    setConfirm({
      title: "Stop session?",
      body: "The auction session will be completed. If an item is live, it is settled now (sold to the leading team, or skipped when it has no bids). Bidding is disabled afterwards.",
      confirmLabel: "Stop Session",
      tone: "danger",
      run: () => actions.end(),
    });
  }, [actions]);

  const requestReset = useCallback(() => {
    setConfirm({
      title: "Reset auction?",
      body: "The secure backend provides a full auction reset only — every slot returns to Pending, all bids are cleared and every wallet is restored to its starting balance. A single-slot reset is not exposed by the backend, so this action cannot be limited to the selected slot.",
      confirmLabel: "Full reset",
      tone: "danger",
      run: async () => {
        const ok = await handleResetAuction();
        if (ok) void refreshLive();
        return ok;
      },
    });
  }, [handleResetAuction, refreshLive]);

  const requestDelete = useCallback(() => {
    if (!cardItem) return;
    const label = cardItem.topic?.title
      ? `"${cardItem.topic.title}"`
      : "this problem statement";
    setConfirm({
      title: "Delete slot?",
      body: `${label} will be removed from the auction queue (marked skipped) via the skip RPC. The secure backend does not expose permanent row deletion. Only this slot is affected — no wallets or other slots.`,
      confirmLabel: "Delete slot",
      tone: "danger",
      run: async () => {
        const ok = await handleSkipSlot(cardItem.id);
        if (ok) void refreshLive();
        return ok;
      },
    });
  }, [cardItem, handleSkipSlot, refreshLive]);

  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.run();
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  }, [confirm]);

  // ── CSV import ──────────────────────────────────────────────
  const openUpload = useCallback(() => {
    setUpload(EMPTY_UPLOAD);
    setUpload((prev) => ({ ...prev, open: true }));
  }, []);

  const closeUpload = useCallback(() => {
    setUpload(EMPTY_UPLOAD);
  }, []);

  const handleCsvFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        setUpload((prev) => ({
          ...prev,
          error: "Excel (.xlsx) import is planned. Please save the sheet as CSV (comma-separated) and upload again.",
          rows: [],
        }));
        return;
      }
      if (!lower.endsWith(".csv")) {
        setUpload((prev) => ({
          ...prev,
          error: "Unsupported file type. Upload a .csv file.",
          rows: [],
        }));
        return;
      }

      try {
        const text = await file.text();
        const table = parseCsv(text);
        if (table.length < 2) {
          setUpload((prev) => ({
            ...prev,
            error: "The file has no data rows.",
            rows: [],
          }));
          return;
        }

        const header = table[0].map((h) => h.trim().toLowerCase());
        const titleIdx = header.indexOf("title");
        const descIdx = header.indexOf("description");
        const levelIdx = header.indexOf("level");
        const bidIdx = header.indexOf("starting_bid");

        if (titleIdx === -1 || descIdx === -1) {
          setUpload((prev) => ({
            ...prev,
            error:
              "CSV must contain 'title' and 'description' columns. Optional: 'level', 'starting_bid'.",
            rows: [],
          }));
          return;
        }

        const existingTitles = new Set(
          slots.map((s) => s.topic?.title?.toLowerCase()).filter(Boolean) as string[]
        );
        const capacity = Math.max(0, MAX_SLOTS - slots.length);

        const rows: CsvProblemRow[] = [];
        const rowErrors: string[] = [];

        for (let i = 1; i < table.length && rows.length < capacity; i++) {
          const cells = table[i];
          const title = (cells[titleIdx] ?? "").trim();
          const description = (cells[descIdx] ?? "").trim();
          if (!title) {
            rowErrors.push(`Row ${i + 1}: missing title.`);
            continue;
          }
          if (existingTitles.has(title.toLowerCase())) {
            rowErrors.push(`Row ${i + 1}: duplicate title "${title}".`);
            continue;
          }
          const levelRaw = (cells[levelIdx] ?? "easy").trim().toLowerCase();
          const level: "easy" | "hard" = levelRaw === "hard" ? "hard" : "easy";
          const bidRaw = parseInt((cells[bidIdx] ?? "10").trim(), 10);
          const startingBid = Number.isFinite(bidRaw) && bidRaw > 0 ? bidRaw : 10;

          existingTitles.add(title.toLowerCase());
          rows.push({ title, description, level, startingBid });
        }

        setUpload((prev) => ({
          ...prev,
          fileName: file.name,
          rows,
          error: rowErrors.length > 0 && rows.length === 0 ? rowErrors[0] ?? null : null,
          notice:
            rowErrors.length > 0 && rows.length > 0
              ? `${rowErrors.length} row(s) will be skipped.`
              : null,
        }));
      } catch {
        setUpload((prev) => ({
          ...prev,
          error: "Failed to read the file.",
          rows: [],
        }));
      }
    },
    [slots]
  );

  const handleImport = useCallback(
    async (rows: CsvProblemRow[]) => {
      if (rows.length === 0) return;
      setUpload((prev) => ({
        ...prev,
        importing: true,
        progress: { done: 0, total: rows.length },
      }));

      let imported = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const res = await createAuctionTopic({
          title: row.title,
          description: row.description,
          level: row.level,
          starting_bid: row.startingBid,
          slots_count: 1,
        });
        if (res.success) {
          imported++;
        } else {
          errors.push(`"${row.title}": ${res.error ?? "failed"}`);
        }
        setUpload((prev) => ({
          ...prev,
          progress: { done: i + 1, total: rows.length },
        }));
      }

      setUpload((prev) => ({
        ...prev,
        importing: false,
        progress: null,
        result: { imported, failed: errors.length, errors },
      }));

      refreshAll();
      void refreshLive();
    },
    [refreshAll, refreshLive]
  );

  // ── Leaderboard (questions won, descending) ─────────────────
  const winsByTeam = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of slots) {
      if (s.status === "sold" && s.winner_team_id) {
        map.set(s.winner_team_id, (map.get(s.winner_team_id) ?? 0) + 1);
      }
    }
    return map;
  }, [slots]);

  // Roster: authoritative live state first, admin allocations as
  // fallback (e.g. while the live-state RPC is briefly unavailable).
  const roster = useMemo(() => {
    if (state.teams.length > 0) {
      return state.teams.map((t) => ({
        id: t.id,
        name: t.name,
        balance: t.balance,
        eliminated: t.eliminated,
      }));
    }
    return teamAllocations.map((t) => ({
      id: t.team_id,
      name: t.team_name,
      balance: t.wallet_balance,
      eliminated: false,
    }));
  }, [state.teams, teamAllocations]);

  const boardRows = useMemo(() => {
    return roster
      .map((t, i) => ({
        id: t.id,
        name: t.name,
        balance: t.balance,
        currentBid: 0,
        stat: winsByTeam.get(t.id) ?? 0,
        eliminated: t.eliminated,
        // Stable mascot per team (roster order, independent of rank).
        characterIndex: (i % 10) + 1,
      }))
      .sort(
        (a, b) =>
          b.stat - a.stat || b.balance - a.balance || a.name.localeCompare(b.name)
      );
  }, [roster, winsByTeam]);

  // ── Card content pieces ─────────────────────────────────────
  const topic = cardItem?.topic ?? null;
  const { brief, detail } = splitBrief(topic?.description);

  const timerLabel = !liveItem
    ? "Awaiting open"
    : liveItem.timer_status === "paused"
      ? `${formatClock(countdown.secondsLeft)} · Paused`
      : countdown.isExpired
        ? "Time expired — close to settle"
        : `Time Left: ${formatClock(countdown.secondsLeft)}`;

  const pillTone = !liveItem
    ? "bg-zinc-700 text-zinc-200"
    : countdown.isExpired
      ? "bg-rose-600 text-white"
      : countdown.isUrgent
        ? "bg-amber-500 text-amber-950"
        : "bg-emerald-600 text-white";
  const pillBadgeTone =
    pillTone === "bg-emerald-600 text-white"
      ? "bg-sky-200 text-emerald-950"
      : pillTone === "bg-amber-500 text-amber-950"
        ? "bg-amber-100 text-amber-900"
        : "bg-white/20 text-white";

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {/* 1 ─ Top-level session controls */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={openUpload}
          disabled={busy}
          className={BTN_ORANGE}
        >
          Upload Slots
        </button>

        {sessionActive ? (
          <button
            type="button"
            onClick={requestStop}
            disabled={busy}
            className={BTN_GREEN}
          >
            Stop Session
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void actions.start()}
            disabled={busy}
            className={BTN_GREEN}
          >
            Start Session
          </button>
        )}
      </div>

      {/* 2 ─ Main auction container */}
      <div className="rounded-2xl border border-white/10 bg-[#17181c] p-5 sm:p-6">
        {/* Five slot controls — one row */}
        <div className="flex flex-wrap items-center gap-2.5">
          {isLive ? (
            <button
              type="button"
              onClick={() => void handleCloseSlot()}
              disabled={busy}
              className={BTN_GREEN}
            >
              Close Slot
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleOpenSlot()}
              disabled={busy || !viewedSlot || !sessionActive}
              title={
                !sessionActive
                  ? "Start the session before opening a slot"
                  : "Open the selected problem statement for bidding"
              }
              className={BTN_GREEN}
            >
              Open Slot
            </button>
          )}

          {auctionPaused ? (
            <button
              type="button"
              onClick={() => void actions.resume()}
              disabled={busy || !sessionActive}
              className={BTN_GREEN}
            >
              Resume Slot
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void actions.pause()}
              disabled={busy || !sessionActive}
              className={BTN_GREEN}
            >
              Pause Slot
            </button>
          )}

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={busy}
            className={BTN_GREEN}
          >
            Add Slot
          </button>

          <button
            type="button"
            onClick={requestReset}
            disabled={busy}
            className={BTN_NEUTRAL}
          >
            Reset Slot
          </button>

          <button
            type="button"
            onClick={requestDelete}
            disabled={busy || !cardItem}
            className={BTN_RED}
          >
            Delete Slot
          </button>
        </div>

        {/* Inline action feedback (no banners) */}
        {feedback && (
          <p
            className={`mt-3 text-xs font-semibold ${
              feedback.type === "success" ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {feedback.message}
          </p>
        )}

        {/* Problem statement card */}
        <section className="relative mt-5 min-h-[280px] rounded-2xl border border-white/10 bg-[#1b1c21] p-5 sm:p-7">
          {cardItem && topic ? (
            <>
              {/* Header + status pill */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
                    Problem Statement
                  </p>
                  <h2 className="mt-1 text-xl font-black text-white sm:text-2xl">
                    Problem Statement {pad2(displayNumber)}
                  </h2>
                  <h3 className="mt-1 truncate text-sm font-semibold text-zinc-300">
                    {topic.title}
                  </h3>
                </div>

                <div
                  className={`inline-flex shrink-0 items-center gap-2 self-start rounded-full py-1.5 pl-1.5 pr-3.5 ${pillTone}`}
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-black ${pillBadgeTone}`}
                  >
                    {pad2(displayNumber)} / {pad2(totalCount)}
                  </span>
                  <span className="text-[11px] font-bold">{timerLabel}</span>
                </div>
              </div>

              {/* Brief statement */}
              {brief && (
                <p className="mt-5 text-sm font-semibold leading-relaxed text-zinc-100">
                  {brief}
                </p>
              )}

              {/* Detailed description */}
              {(detail || (!brief && topic.description)) && (
                <div className="mt-3 max-h-52 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-zinc-400">
                  {detail || topic.description}
                </div>
              )}
              {!topic.description && (
                <p className="mt-5 text-sm italic text-zinc-600">
                  No description was provided for this problem statement.
                </p>
              )}

              {/* Live bidding status */}
              {isLive && liveItem && (
                <p className="mt-4 text-xs text-zinc-500">
                  {liveItem.leader_team_name
                    ? `Current bid ${liveItem.current_bid} pts · Leader: ${liveItem.leader_team_name}`
                    : `Current bid ${liveItem.current_bid} pts · No bids yet`}
                </p>
              )}
              {!isLive && viewedSlot && (
                <p className="mt-4 text-xs text-zinc-500">
                  In queue — open this slot to start the 10s bidding window.
                </p>
              )}

              {/* Navigation */}
              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (viewedIndex > 0) setViewedId(pendingQueue[viewedIndex - 1]?.id ?? null);
                  }}
                  disabled={!canPrevious || busy}
                  className={BTN_GREEN}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isLive) {
                      void actions.advance();
                    } else if (canNextBrowse) {
                      setViewedId(pendingQueue[viewedIndex + 1]?.id ?? null);
                    }
                  }}
                  disabled={busy || (!canNextLive && !canNextBrowse)}
                  className={BTN_GREEN}
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={() => void handleSkip()}
                  disabled={busy || !cardItem}
                  className={BTN_ORANGE}
                >
                  Skip
                </button>
              </div>
            </>
          ) : (
            /* Compact empty state — stays inside the card */
            <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
              <p className="text-sm font-bold text-zinc-300">
                {isLoading
                  ? "Loading auction data…"
                  : loadError && slots.length === 0
                    ? "Could not load the auction queue"
                    : slots.length === 0
                      ? "No problem statements in the queue"
                      : "Queue empty — every problem statement has been played"}
              </p>
              {!isLoading && (
                <>
                  <p className="mt-1 max-w-sm text-xs text-zinc-500">
                    {loadError && slots.length === 0
                      ? loadError
                      : "Use Add Slot or Upload Slots to create problem statements, then start the session and open a slot for bidding."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    disabled={busy}
                    className={`${BTN_GREEN} mt-4`}
                  >
                    Add Slot
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* 3 ─ Live leaderboard */}
        <div className="mt-7">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight text-white sm:text-xl">
              Lead board
            </h2>
            <a
              href="/projector/auction"
              target="_blank"
              rel="noopener noreferrer"
              className={BTN_BLUE}
            >
              Project
            </a>
          </div>

          {boardRows.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-xs text-zinc-500">
              No teams have registered yet.
            </p>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {boardRows.map((team, rank) => (
                  <LeaderboardCapsule
                    key={team.id}
                    team={team}
                    rank={rank + 1}
                    totalTeams={boardRows.length}
                  />
                ))}
              </div>
              {boardRows.length > 8 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-xl bg-gradient-to-t from-[#17181c] to-transparent" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AddTopicModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onConfirm={async (values: CreateTopicFormValues) => {
          const ok = await handleCreateTopic(values);
          if (ok) void refreshLive();
          return ok;
        }}
        existingSlots={slots as AdminSlotWithDetails[]}
        isExecuting={actionInProgress?.action === "add_topic"}
      />

      <UploadSlotsModal
        state={upload}
        capacity={Math.max(0, MAX_SLOTS - slots.length)}
        onClose={closeUpload}
        onFile={handleCsvFile}
        onImport={handleImport}
      />

      <ConfirmDialog
        request={confirm}
        busy={confirmBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runConfirm()}
      />
    </div>
  );
}
