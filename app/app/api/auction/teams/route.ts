import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const slotId = searchParams.get("slotId");

    const db = getServerDb();

    // 1. Fetch registered teams from DB
    const { data: dbTeams, error: teamsErr } = await db
      .from("teams")
      .select("id, name, captain_id, locked")
      .order("name", { ascending: true });

    if (teamsErr) {
      return NextResponse.json({ success: false, error: teamsErr.message }, { status: 500 });
    }

    const teams = dbTeams || [];

    // 2. Fetch wallets for all teams
    const walletMap = new Map<string, number>();
    const { data: wallets } = await db.from("wallets").select("team_id, balance");
    if (wallets) {
      wallets.forEach((w: { team_id: string; balance: number }) => walletMap.set(w.team_id, w.balance));
    }

    // 3. Fetch bids for active slot if provided
    const teamBidsMap = new Map<string, number>();
    if (slotId) {
      const { data: slotBids } = await db
        .from("bids")
        .select("team_id, amount")
        .eq("slot_id", slotId)
        .order("amount", { ascending: false });

      if (slotBids) {
        slotBids.forEach((b: { team_id: string; amount: number }) => {
          const existing = teamBidsMap.get(b.team_id) || 0;
          if (b.amount > existing) {
            teamBidsMap.set(b.team_id, b.amount);
          }
        });
      }
    }

    // 4. Combine into enriched leaderboard objects
    const enrichedTeams = teams.map((team: { id: string; name: string; captain_id: string | null; locked: boolean }, index: number) => {
      const balance = walletMap.get(team.id) ?? 100;
      const currentBid = teamBidsMap.get(team.id) ?? 0;
      return {
        id: team.id,
        name: team.name,
        captain_id: team.captain_id,
        locked: team.locked,
        balance,
        currentBid,
        characterIndex: (index % 10) + 1,
      };
    });

    // 5. Sort for leaderboard: highest current bid first, then balance, then name
    enrichedTeams.sort((a: { currentBid: number; balance: number; name: string }, b: { currentBid: number; balance: number; name: string }) => {
      if (b.currentBid !== a.currentBid) return b.currentBid - a.currentBid;
      if (b.balance !== a.balance) return b.balance - a.balance;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      success: true,
      teams: enrichedTeams,
      hasData: teams.length > 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load teams";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
