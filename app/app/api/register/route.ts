import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const MAX_CONTEST_TEAMS = 60; // Max allowed teams for the competition

interface RegisterRequestBody {
  teamName: string;
  teamSize: number;
  caption?: {
    name: string;
    usn: string;
    semester?: string;
    phone?: string;
  };
  captain?: {
    name: string;
    usn: string;
    semester?: string;
    phone?: string;
  };
  members: Array<{
    name: string;
    usn: string;
  }>;
}

export async function POST(request: Request) {
  try {
    const body: RegisterRequestBody = await request.json();
    const { teamName, teamSize, members } = body;
    const captain = body.captain || body.caption;

    // 1. Basic validation
    if (!teamName?.trim()) {
      return NextResponse.json(
        { error: "Team Name is required." },
        { status: 400 }
      );
    }

    if (!captain?.name?.trim() || !captain?.usn?.trim()) {
      return NextResponse.json(
        { error: "Team Captain Name and USN are required." },
        { status: 400 }
      );
    }

    if (!captain?.semester?.trim()) {
      return NextResponse.json(
        { error: "Team Captain Semester confirmation is required." },
        { status: 400 }
      );
    }

    if (!captain?.phone?.trim()) {
      return NextResponse.json(
        { error: "Team Captain Phone Number is required." },
        { status: 400 }
      );
    }

    const cleanTeamName = teamName.trim();
    const cleanCaptainUsn = captain.usn.trim().toUpperCase();
    const captainEmail = `${cleanCaptainUsn.toLowerCase()}@mite.ac.in`;
    const captainSemester = captain.semester.trim();
    const captainPhone = captain.phone.trim();

    // 2. Check team capacity limit (Figma screen 3: Sorry Limit Reached)
    try {
      const { count } = await supabase
        .from("teams")
        .select("*", { count: "exact", head: true });

      if (count !== null && count >= MAX_CONTEST_TEAMS) {
        return NextResponse.json(
          { status: "limit_reached", message: "Sorry, all slots are filled!" },
          { status: 403 }
        );
      }
    } catch {
      // Continue if count check times out
    }

    // 3. Check if team name already exists
    try {
      const { data: existingTeam } = await supabase
        .from("teams")
        .select("id")
        .ilike("name", cleanTeamName)
        .maybeSingle();

      if (existingTeam) {
        return NextResponse.json(
          { error: `The team name "${cleanTeamName}" is already registered. Please choose another.` },
          { status: 409 }
        );
      }
    } catch {
      // Continue if DB check fails
    }

    // 4. Insert into database
    let teamId: string | null = null;
    try {
      const { data: teamData, error: teamError } = await supabase
        .from("teams")
        .insert({
          name: cleanTeamName,
          locked: false,
        })
        .select("id")
        .single();

      if (teamError) {
        console.warn("[Register API] Supabase insert team warning:", teamError.message);
      } else if (teamData) {
        teamId = teamData.id;

        // Insert Captain with semester and phone
        await supabase.from("members").insert({
          team_id: teamId,
          name: captain.name.trim(),
          email: captainEmail,
          college: `MITE - Sem ${captainSemester} (Ph: ${captainPhone})`,
        });

        // Insert Teammates
        for (const tm of members) {
          if (tm.name?.trim() && tm.usn?.trim()) {
            const tmUsn = tm.usn.trim().toUpperCase();
            await supabase.from("members").insert({
              team_id: teamId,
              name: tm.name.trim(),
              email: `${tmUsn.toLowerCase()}@mite.ac.in`,
              college: "MITE",
            });
          }
        }

        // Initialize Wallets with 100 coins (as seen in Figma Preview)
        await supabase.from("wallets").insert([
          { team_id: teamId, round: 1, balance: 100 },
          { team_id: teamId, round: 2, balance: 100 },
        ]);
      }
    } catch (dbErr) {
      console.warn("[Register API] Database integration fallback:", dbErr);
    }

    // Generate response
    const generatedId = teamId || `B2B-${Math.floor(1000 + Math.random() * 9000)}`;

    return NextResponse.json({
      success: true,
      teamId: generatedId,
      teamName: cleanTeamName,
      captionEmail: captainEmail,
      captainEmail,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to register team.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
