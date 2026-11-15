import { NextResponse } from "next/server";
import { getDbClient } from "@/lib/supabaseServer";

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

    const db = getDbClient();

    // 2. Check team capacity limit (Figma screen 3: Sorry Limit Reached)
    const { count } = await db
      .from("teams")
      .select("*", { count: "exact", head: true });

    if (count !== null && count >= MAX_CONTEST_TEAMS) {
      return NextResponse.json(
        { status: "limit_reached", message: "Sorry, all slots are filled!" },
        { status: 403 }
      );
    }

    // 3. Check if team name already exists
    const { data: existingTeam } = await db
      .from("teams")
      .select("id")
      .ilike("name", cleanTeamName)
      .maybeSingle();

    if (existingTeam) {
      return NextResponse.json(
        { error: `The team name "${cleanTeamName}" is already registered. Please choose another name.` },
        { status: 409 }
      );
    }

    // 4. Insert Team into Supabase `teams` table
    const { data: teamData, error: teamError } = await db
      .from("teams")
      .insert({
        name: cleanTeamName,
        locked: false,
      })
      .select("id")
      .single();

    if (teamError) {
      console.error("[Register API] Error inserting into teams:", teamError);
      return NextResponse.json(
        {
          error: `Database insert failed: ${teamError.message}.`,
        },
        { status: 500 }
      );
    }

    const teamId = teamData.id;

    // 5. Insert Captain into `members` table
    const { data: captainData, error: captainError } = await db
      .from("members")
      .insert({
        team_id: teamId,
        name: captain.name.trim(),
        email: captainEmail,
        college: `MITE - Sem ${captainSemester} (Ph: ${captainPhone})`,
      })
      .select("id")
      .single();

    if (captainError) {
      console.error("[Register API] Error inserting captain:", captainError);
    } else if (captainData?.id) {
      // Link captain_id in teams table
      await db
        .from("teams")
        .update({ captain_id: captainData.id })
        .eq("id", teamId);
    }

    // 6. Insert Teammates into `members` table
    for (const tm of members) {
      if (tm.name?.trim() && tm.usn?.trim()) {
        const tmUsn = tm.usn.trim().toUpperCase();
        await db.from("members").insert({
          team_id: teamId,
          name: tm.name.trim(),
          email: `${tmUsn.toLowerCase()}@mite.ac.in`,
          college: "MITE",
        });
      }
    }

    // 7. Initialize Wallet with 100 points
    try {
      const { error: walletError } = await db.from("wallets").insert({
        team_id: teamId,
        balance: 100,
      });

      if (walletError) {
        // Fallback for two-round schema if table requires round
        await db.from("wallets").insert([
          { team_id: teamId, round: 1, balance: 100 },
          { team_id: teamId, round: 2, balance: 100 },
        ]);
      }
    } catch (wErr) {
      console.warn("[Register API] Wallet insert fallback:", wErr);
    }

    return NextResponse.json({
      success: true,
      teamId,
      teamName: cleanTeamName,
      captainEmail,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to register team.";
    console.error("[Register API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
