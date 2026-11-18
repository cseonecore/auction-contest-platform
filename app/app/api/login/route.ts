import { NextResponse } from "next/server";
import { getDbClient } from "@/lib/supabaseServer";

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
    const db = getDbClient();

    // 1. Strict Query: Find Team in Supabase (case-insensitive)
    const { data: initialTeam, error: teamErr } = await db
      .from("teams")
      .select("id, name, captain_id, locked, created_at")
      .ilike("name", cleanTeamName)
      .maybeSingle();

    let team = initialTeam;

    // If not found, try without spaces in case user typed "Code Ninjas" for "CodeNinjas"
    if (!team) {
      const compactName = cleanTeamName.replace(/\s+/g, "");
      const { data: altTeam } = await db
        .from("teams")
        .select("id, name, captain_id, locked, created_at")
        .ilike("name", compactName)
        .maybeSingle();
      if (altTeam) team = altTeam;
    }

    if (teamErr) {
      console.error("[Login API] Supabase query error:", teamErr);
      return NextResponse.json(
        { error: "Database error occurred while verifying credentials." },
        { status: 500 }
      );
    }

    if (!team) {
      return NextResponse.json(
        { error: `Team "${cleanTeamName}" was not found in the database. Please register first.` },
        { status: 404 }
      );
    }

    // 2. Fetch all members of this team
    const { data: members, error: memErr } = await db
      .from("members")
      .select("id, name, email, college, created_at")
      .eq("team_id", team.id)
      .order("created_at", { ascending: true });

    if (memErr || !members || members.length === 0) {
      return NextResponse.json(
        { error: "No registered members found for this team." },
        { status: 404 }
      );
    }

    // 3. Identify the Captain of this team
    let captain = null;
    if (team.captain_id) {
      captain = members.find((m) => m.id === team.captain_id);
    }
    if (!captain) {
      captain =
        members.find(
          (m) =>
            m.college &&
            (m.college.toLowerCase().includes("sem") ||
              m.college.toLowerCase().includes("captain") ||
              m.college.toLowerCase().includes("ph"))
        ) || members[0];
    }

    // 4. Strictly match Captain USN against the Captain's registered USN/email
    const expectedEmail = `${captainUsn.toLowerCase()}@mite.ac.in`;
    const cleanCaptainUsn = captainUsn.replace(/[\s-]/g, "");
    const isCaptainMatch =
      captain?.email &&
      (captain.email.toLowerCase() === expectedEmail ||
        captain.email.toUpperCase().includes(cleanCaptainUsn) ||
        (captain.college && captain.college.toUpperCase().includes(cleanCaptainUsn)));

    if (!isCaptainMatch) {
      return NextResponse.json(
        {
          error: "Invalid Captain USN for this team. Please enter the correct USN used during registration.",
        },
        { status: 401 }
      );
    }

    // 5. Successful strictly verified login
    return NextResponse.json({
      success: true,
      team: {
        id: team.id,
        name: team.name,
        locked: team.locked,
        captain: {
          id: captain.id,
          name: captain.name,
          email: captain.email,
          college: captain.college,
        },
        members: members,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed.";
    console.error("[Login API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
