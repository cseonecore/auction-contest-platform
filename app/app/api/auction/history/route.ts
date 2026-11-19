import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/server";

/**
 * Concluded auction items (sold / skipped).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 0);

    const db = createPublicClient();

    const { data, error } = await db.rpc("get_auction_history", {
      p_limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as Array<{
      slot_id: string;
      slot_number: number | null;
      round: number;
      status: string;
      topic_title: string;
      winner_team_id: string | null;
      winner_team_name: string | null;
      winning_bid: number | null;
      sold_at: string | null;
      end_time: string | null;
    }>;

    return NextResponse.json({
      success: true,
      results: rows.map((row) => ({
        slotId: row.slot_id,
        slotNumber: row.slot_number,
        round: row.round,
        status: row.status,
        topicTitle: row.topic_title,
        winnerTeam: row.winner_team_name
          ? { id: row.winner_team_id, name: row.winner_team_name }
          : null,
        winningBid: row.winning_bid ?? 0,
        coinsDeducted: row.status === "sold" ? row.winning_bid ?? 0 : 0,
        endTime: row.sold_at ?? row.end_time,
      })),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load auction history";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
