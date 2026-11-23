import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/server";

/**
 * Live leaderboard / participating teams.
 *
 * Sourced from the same authoritative state as every other client.
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
      teams?: Array<{
        id: string;
        name: string;
        balance: number;
        current_bid: number;
        eliminated: boolean;
        character_index?: number | null;
      }>;
    };
    const teams = state.teams ?? [];

    return NextResponse.json({
      success: true,
      teams: teams.map((team, index) => ({
        id: team.id,
        name: team.name,
        balance: team.balance ?? 0,
        currentBid: team.current_bid ?? 0,
        eliminated: Boolean(team.eliminated),
        // Prefer the DB character_index (the same source the /profile page uses).
        characterIndex: team.character_index ?? (index % 10) + 1,
      })),      hasData: teams.length > 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load teams";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
