import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/server";

/**
 * Authoritative live auction state.
 *
 * Reads the single source of truth (`get_live_auction_state()`) from
 * PostgreSQL. The function returns only public-safe data: the live
 * item, the public bid feed, the team list with balances, the
 * configuration and the sanitised event log.
 */
export async function GET() {
  try {
    const db = createPublicClient();

    const { data, error } = await db.rpc("get_live_auction_state");

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const state = (data ?? {}) as {
      session?: { status?: string; is_paused?: boolean } | null;
      active_slot?: { status?: string; question_number?: number | null } | null;
      settings?: Record<string, unknown>;
      teams?: unknown[];
      bids?: unknown[];
      events?: unknown[];
      eliminations?: unknown[];
      server_time?: string | null;
      total_items?: number;
      items_sold?: number;
    };

    return NextResponse.json({
      success: true,
      auctionStatus: deriveDisplayStatus(state),
      session: state.session ?? null,
      settings: state.settings ?? {},
      totalSlots: state.total_items ?? 0,
      itemsSold: state.items_sold ?? 0,
      activeSlotIndex: state.active_slot?.question_number ?? 0,
      activeSlot: state.active_slot ?? null,
      slots: [],
      history: [],
      bids: state.bids ?? [],
      teams: state.teams ?? [],
      events: state.events ?? [],
      eliminations: state.eliminations ?? [],
      serverTime: state.server_time ?? null,
      hasData: Boolean(state.session) || (state.teams ?? []).length > 0,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load auction state";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * Maps the contest state machine onto the four labels the participant
 * interface renders. The database remains the only authority.
 */
function deriveDisplayStatus(state: {
  session?: { status?: string; is_paused?: boolean } | null;
  active_slot?: { status?: string } | null;
}): "LIVE" | "UPCOMING" | "PAUSED" | "COMPLETED" {  const session = state.session;

  if (!session) return "UPCOMING";
  if (session.is_paused) return "PAUSED";
  if (session.status === "completed" || session.status === "cancelled") return "COMPLETED";

  const active = state.active_slot;
  if (active && active.status === "open") return "LIVE";
  if (session.status === "bidding_open") return "LIVE";

  return "UPCOMING";
}
