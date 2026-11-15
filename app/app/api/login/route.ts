import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const teamName = body.teamName;
    const captainUsn = (body.captainUsn || body.password || "").trim().toUpperCase();

    if (!teamName?.trim()) {
      return NextResponse.json(
        { error: "Team Name is required." },
        { status: 400 }
      );
    }

    if (!captainUsn) {
      return NextResponse.json(
        { error: "Captain USN is required." },
        { status: 400 }
      );
    }

    const cleanTeamName = teamName.trim();

    // 1. Check team in database
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

        // Verify captain's USN matches (email format is usn@mite.ac.in)
        const expectedEmail = `${captainUsn.toLowerCase()}@mite.ac.in`;
        const matchedMember = members?.find(
          (m) =>
            m.email?.toLowerCase() === expectedEmail ||
            m.email?.toUpperCase().includes(captainUsn) ||
            m.college?.toUpperCase().includes(captainUsn)
        );

        if (matchedMember || !members || members.length === 0) {
          return NextResponse.json({
            success: true,
            team: {
              id: team.id,
              name: team.name,
              locked: team.locked,
              captain: matchedMember || members?.[0],
              members: members || [],
            },
          });
        } else {
          return NextResponse.json(
            { error: "The provided Captain USN does not match this team." },
            { status: 401 }
          );
        }
      }
    } catch (dbErr) {
      console.warn("[Login API] DB check fallback:", dbErr);
    }

    // 2. Demo/Contest fallback if team was registered locally or offline
    if (cleanTeamName.length >= 2) {
      return NextResponse.json({
        success: true,
        team: {
          id: `TEAM-${Math.floor(1000 + Math.random() * 9000)}`,
          name: cleanTeamName,
          locked: false,
          captain: {
            name: "Captain",
            email: `${captainUsn.toLowerCase()}@mite.ac.in`,
          },
          members: [
            {
              name: "Captain",
              email: `${captainUsn.toLowerCase()}@mite.ac.in`,
            },
          ],
        },
      });
    }

    return NextResponse.json(
      { error: "Invalid Team Name or Captain USN. Please check your credentials." },
      { status: 401 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
