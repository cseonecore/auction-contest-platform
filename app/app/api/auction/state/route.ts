import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";

interface AuctionSettings {
  min_bid: number;
  min_raise: number;
  opening_window_seconds: number;
  timer_extension_seconds: number;
  starting_wallet_balance: number;
}

const DEFAULT_SETTINGS: AuctionSettings = {
  min_bid: 10,
  min_raise: 10,
  opening_window_seconds: 10,
  timer_extension_seconds: 5,
  starting_wallet_balance: 100,
};

type SlotStatus = "pending" | "open" | "sold" | "skipped";

interface DbSlot {
  id: string;
  topic_id: string;
  round: number;
  status: SlotStatus;
  current_bid: number;
  leader_team_id: string | null;
  end_time: string | null;
  winner_team_id: string | null;
  topic?: { id: string; level: string; title: string; description: string; criterion?: unknown } | { id: string; level: string; title: string; description: string; criterion?: unknown }[] | null;
  leader_team?: { id: string; name: string } | { id: string; name: string }[] | null;
  winner_team?: { id: string; name: string } | { id: string; name: string }[] | null;
}

function normalizeRelation<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

export async function GET(request: Request) {
  try {
    const db = getServerDb();
    const { searchParams } = new URL(request.url);
    const activeSlotIdParam = searchParams.get("slotId");

    // 1. Fetch settings from DB
    const settings: AuctionSettings = { ...DEFAULT_SETTINGS };
    try {
      const { data: settingsRows } = await db.from("settings").select("key, value");
      if (settingsRows && settingsRows.length > 0) {
        for (const row of settingsRows) {
          const val = row.value;
          const num =
            typeof val === "number"
              ? val
              : typeof val === "string"
              ? parseFloat(val)
              : typeof val === "object" && val !== null && "value" in val
              ? Number((val as Record<string, unknown>).value)
              : null;

          if (num !== null && !isNaN(num)) {
            if (row.key === "min_bid") settings.min_bid = num;
            if (row.key === "min_raise") settings.min_raise = num;
            if (row.key === "opening_window_seconds") settings.opening_window_seconds = num;
            if (row.key === "timer_extension_seconds") settings.timer_extension_seconds = num;
            if (row.key === "starting_wallet_balance") settings.starting_wallet_balance = num;
          }
        }
      }
    } catch {
      // Use defaults silently
    }

    // 2. Fetch slots from DB (source of truth — no store fallback)
    let slots: DbSlot[] = [];
    const { data: dbSlots, error: slotsErr } = await db
      .from("slots")
      .select(`
        id,
        topic_id,
        round,
        status,
        current_bid,
        leader_team_id,
        end_time,
        winner_team_id,
        topic:topics (
          id,
          level,
          title,
          description,
          criterion
        ),
        leader_team:teams!slots_leader_team_id_fkey (
          id,
          name
        ),
        winner_team:teams!slots_winner_team_id_fkey (
          id,
          name
        )
      `)
      .order("round", { ascending: true })
      .order("id", { ascending: true });

    if (!slotsErr && dbSlots && dbSlots.length > 0) {
      slots = dbSlots as unknown as DbSlot[];
    }

    // Normalize nested relations
    const normalizedSlots = slots.map((s) => ({
      ...s,
      topic: normalizeRelation(s.topic),
      leader_team: normalizeRelation(s.leader_team),
      winner_team: normalizeRelation(s.winner_team),
    }));

    // 3. Determine Active Slot
    const openSlot = normalizedSlots.find((s) => s.status === "open");

    let activeSlot = null;
    if (activeSlotIdParam) {
      activeSlot = normalizedSlots.find((s) => s.id === activeSlotIdParam) || null;
    }
    if (!activeSlot) {
      activeSlot =
        openSlot ||
        normalizedSlots.find((s) => s.status === "pending") ||
        normalizedSlots[normalizedSlots.length - 1] ||
        null;
    }

    const totalSlots = normalizedSlots.length;
    const activeSlotIndex = activeSlot
      ? normalizedSlots.findIndex((s) => s.id === activeSlot!.id) + 1
      : 0;

    // 4. Overall Auction Status
    let auctionStatus: "LIVE" | "UPCOMING" | "PAUSED" | "COMPLETED" = "UPCOMING";
    if (openSlot) {
      auctionStatus = "LIVE";
    } else if (
      normalizedSlots.length > 0 &&
      normalizedSlots.every((s) => s.status === "sold" || s.status === "skipped")
    ) {
      auctionStatus = "COMPLETED";
    } else if (normalizedSlots.some((s) => s.status === "pending")) {
      auctionStatus = "UPCOMING";
    }

    // 5. History: concluded (sold/skipped) slots
    const history = normalizedSlots
      .filter((s) => s.status === "sold" || s.status === "skipped")
      .map((s, _idx) => ({
        slotId: s.id,
        slotNumber: normalizedSlots.findIndex((item) => item.id === s.id) + 1,
        status: s.status as "sold" | "skipped",
        topicTitle: (s.topic as { title?: string })?.title || "Problem",
        winnerTeam: s.winner_team as { id: string; name: string } | null,
        winningBid: s.current_bid,
        round: s.round,
        endTime: s.end_time,
      }));

    return NextResponse.json({
      success: true,
      auctionStatus,
      settings,
      totalSlots,
      activeSlotIndex,
      activeSlot,
      slots: normalizedSlots,
      history,
      // No DB data means no auction configured yet
      hasData: normalizedSlots.length > 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load auction state";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
