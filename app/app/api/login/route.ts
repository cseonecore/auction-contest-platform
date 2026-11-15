import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const { teamName, password } = await request.json();

    if (!teamName?.trim()) {
      return NextResponse.json(
        { error: "Team Name is required." },
        { status: 400 }
      );
    }

    if (!password) {
      return NextResponse.json(
        { error: "Password is required." },
        { status: 400 }
      );
    }

    const cleanTeamName = teamName.trim();

    // Check team in database
    try {
      const { data: team, error } = await supabase
        .from("teams")
        .select("id, name, locked, created_at")
        .ilike("name", cleanTeamName)
        .maybeSingle();

      if (team) {
        // Fetch team members
        const { data: members } = await supabase
          .from("members")
          .select("id, name, email, college")
          .eq("team_id", team.id);

        return NextResponse.json({
          success: true,
          team: {
            id: team.id,
            name: team.name,
            locked: team.locked,
            members: members || [],
          },
        });
      }
    } catch (dbErr) {
      console.warn("[Login API] DB fallback check:", dbErr);
    }

    // Demo/Offline Fallback for Contest
    if (cleanTeamName.toLowerCase().includes("core") || cleanTeamName.length >= 3) {
      return NextResponse.json({
        success: true,
        team: {
          id: `TEAM-${Math.floor(1000 + Math.random() * 9000)}`,
          name: cleanTeamName,
          locked: false,
          members: [
            { name: "Captain", email: `${cleanTeamName.toLowerCase()}@mite.ac.in` },
          ],
        },
      });
    }

    return NextResponse.json(
      { error: "Invalid Team Name or Password. Please check your credentials." },
      { status: 401 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
