import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";

export async function GET() {
  try {
    const db = getServerDb();

    const { data: allSlots, error } = await db
      .from("slots")
      .select(`
        id,
        round,
        status,
        current_bid,
        end_time,
        winner_team_id,
        topic:topics (
          id,
          title,
          description,
          level
        ),
        winner_team:teams!slots_winner_team_id_fkey (
          id,
          name
        )
      `)
      .order("round", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const slots = allSlots || [];

    const completedSlots = slots
      .map((s: {
        id: string;
        round: number;
        status: string;
        current_bid: number;
        end_time: string | null;
        winner_team_id: string | null;
        topic: { id: string; title?: string; description?: string; level?: string } | { id: string; title?: string; description?: string; level?: string }[] | null;
        winner_team: { id: string; name: string } | { id: string; name: string }[] | null;
      }, index: number) => {
        const topic = Array.isArray(s.topic) ? s.topic[0] : s.topic;
        const winnerTeam = Array.isArray(s.winner_team) ? s.winner_team[0] : s.winner_team;
        return {
          slotId: s.id,
          slotNumber: index + 1,
          round: s.round,
          status: s.status as "sold" | "skipped" | "open" | "pending",
          topicTitle: topic?.title || `Problem ${index + 1}`,
          description: topic?.description || "",
          winnerTeam: winnerTeam || null,
          winningBid: s.current_bid,
          coinsDeducted: s.status === "sold" ? s.current_bid : 0,
          endTime: s.end_time,
        };
      })
      .filter((s: { status: string }) => s.status === "sold" || s.status === "skipped");

    return NextResponse.json({
      success: true,
      totalSlots: slots.length,
      results: completedSlots,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load auction history";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
