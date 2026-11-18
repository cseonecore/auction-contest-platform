import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_MAX_TEAMS = 60;
const DEFAULT_REGISTRATION_OPEN = true;

interface RegisterRequestBody {
  teamName: string;
  teamSize?: number;
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
    phone?: string;
  }>;
}

interface RegistrationSettings {
  isOpen: boolean;
  maxTeams: number;
}

/**
 * Server-side database client for trusted registration operations.
 * Requires SUPABASE_SERVICE_ROLE_KEY to bypass RLS policies on teams/members/wallets.
 * Never falls back to public anon/publishable keys or placeholder values.
 */
function getDbClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing server configuration: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/**
 * Safely reads registration control settings from public.settings table.
 * Throws on database query error to prevent silent defaulting on connection failures.
 */
async function getRegistrationSettings(
  db: SupabaseClient
): Promise<RegistrationSettings> {
  const { data, error } = await db
    .from("settings")
    .select("key, value")
    .in("key", ["registration_open", "max_teams"]);

  if (error) {
    console.error("[Register API] Error loading registration settings from DB:", error.message);
    throw new Error("Failed to load registration settings from database.");
  }

  let isOpen = DEFAULT_REGISTRATION_OPEN;
  let maxTeams = DEFAULT_MAX_TEAMS;

  if (data) {
    for (const row of data) {
      if (row.key === "registration_open") {
        const val = row.value;
        if (typeof val === "boolean") {
          isOpen = val;
        } else if (typeof val === "string") {
          isOpen = val.toLowerCase() === "true";
        } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
          const obj = val as Record<string, unknown>;
          if ("open" in obj) isOpen = Boolean(obj.open);
          else if ("value" in obj) isOpen = Boolean(obj.value);
        }
      } else if (row.key === "max_teams") {
        const val = row.value;
        if (typeof val === "number" && Number.isFinite(val)) {
          maxTeams = Math.floor(val);
        } else if (typeof val === "string") {
          const parsed = parseInt(val, 10);
          if (!isNaN(parsed) && parsed > 0) maxTeams = parsed;
        } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
          const obj = val as Record<string, unknown>;
          const candidate = obj.max ?? obj.teams ?? obj.value ?? obj.count;
          if (typeof candidate === "number" && Number.isFinite(candidate)) {
            maxTeams = Math.floor(candidate);
          }
        }
      }
    }
  }

  return { isOpen, maxTeams };
}

/**
 * Public registration status endpoint.
 * Returns public, safe registration metadata without leaking secrets.
 * Fails with HTTP 500 if server configuration or database is unavailable.
 */
export async function GET() {
  try {
    const db = getDbClient();
    const [{ isOpen, maxTeams }, countRes] = await Promise.all([
      getRegistrationSettings(db),
      db.from("teams").select("*", { count: "exact", head: true }),
    ]);

    if (countRes.error) {
      console.error("[Register API] Error counting teams:", countRes.error.message);
      return NextResponse.json(
        { error: "Server configuration error. Please contact the organizers." },
        { status: 500 }
      );
    }

    const totalRegistered = countRes.count ?? 0;
    const remainingSlots = Math.max(0, maxTeams - totalRegistered);

    return NextResponse.json({
      isOpen,
      maxTeams,
      totalRegistered,
      remainingSlots,
      // Provide snake_case equivalents for consumer flexibility
      registration_open: isOpen,
      max_teams: maxTeams,
      total_registered: totalRegistered,
      remaining_slots: remainingSlots,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch registration status.";
    console.error("[Register API] Status fetch error:", msg);
    return NextResponse.json(
      { error: "Server configuration error. Please contact the organizers." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body: RegisterRequestBody = await request.json();
    const { teamName, members } = body;
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

    // 2. Validate server configuration & acquire service-role client
    let db: SupabaseClient;
    try {
      db = getDbClient();
    } catch (configErr) {
      console.error(
        "[Register API] Server configuration error:",
        configErr instanceof Error ? configErr.message : configErr
      );
      return NextResponse.json(
        { error: "Server configuration error. Please contact the organizers." },
        { status: 500 }
      );
    }

    // 3. Authoritative backend registration safeguards
    // Step A: Read dynamic settings from public.settings (registration_open & max_teams)
    let isOpen: boolean;
    let maxTeams: number;
    try {
      const settings = await getRegistrationSettings(db);
      isOpen = settings.isOpen;
      maxTeams = settings.maxTeams;
    } catch (settingsErr) {
      console.error(
        "[Register API] Failed to load registration settings:",
        settingsErr instanceof Error ? settingsErr.message : settingsErr
      );
      return NextResponse.json(
        { error: "Server configuration error. Please contact the organizers." },
        { status: 500 }
      );
    }

    // Step B: Reject if registration is closed
    if (!isOpen) {
      return NextResponse.json(
        {
          status: "registration_closed",
          code: "registration_closed",
          error: "Registration is currently closed. Please contact the organizers for further information.",
          message: "Registration is currently closed. Please contact the organizers for further information.",
        },
        { status: 403 }
      );
    }

    // Step C: Check team capacity limit dynamically
    const { count, error: countErr } = await db
      .from("teams")
      .select("*", { count: "exact", head: true });

    if (countErr) {
      console.error("[Register API] Error checking team count:", countErr.message);
      return NextResponse.json(
        { error: "Server configuration error. Please contact the organizers." },
        { status: 500 }
      );
    }

    if (count !== null && count >= maxTeams) {
      return NextResponse.json(
        {
          status: "limit_reached",
          code: "limit_reached",
          error: "Sorry, all slots are filled!",
          message: "Sorry, all slots are filled!",
          maxTeams,
          totalRegistered: count,
        },
        { status: 403 }
      );
    }

    // 4. Check if team name already exists
    const { data: existingTeam, error: existErr } = await db
      .from("teams")
      .select("id")
      .ilike("name", cleanTeamName)
      .maybeSingle();

    if (existErr) {
      console.error("[Register API] Error checking existing team:", existErr.message);
      return NextResponse.json(
        { error: "Server configuration error. Please contact the organizers." },
        { status: 500 }
      );
    }

    if (existingTeam) {
      return NextResponse.json(
        { error: `The team name "${cleanTeamName}" is already registered. Please choose another name.` },
        { status: 409 }
      );
    }

    // 5. Insert Team into Supabase `teams` table
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

    // 6. Insert Captain into `members` table
    let captainData: { id: string } | null = null;
    let captainError: { message?: string } | null = null;

    const captainPayloadWithPhone = {
      team_id: teamId,
      name: captain.name.trim(),
      email: captainEmail,
      college: `MITE - Sem ${captainSemester} (Ph: ${captainPhone})`,
      phone: captainPhone,
    };

    const firstCaptainAttempt = await db
      .from("members")
      .insert(captainPayloadWithPhone)
      .select("id")
      .single();

    if (
      firstCaptainAttempt.error &&
      (firstCaptainAttempt.error.message?.includes("phone") ||
        firstCaptainAttempt.error.message?.includes("column"))
    ) {
      console.warn(
        "[Register API] phone column not yet created in members table; falling back to schema without phone column"
      );
      const fallbackCaptainAttempt = await db
        .from("members")
        .insert({
          team_id: teamId,
          name: captain.name.trim(),
          email: captainEmail,
          college: `MITE - Sem ${captainSemester} (Ph: ${captainPhone})`,
        })
        .select("id")
        .single();
      captainData = fallbackCaptainAttempt.data;
      captainError = fallbackCaptainAttempt.error;
    } else {
      captainData = firstCaptainAttempt.data;
      captainError = firstCaptainAttempt.error;
    }

    if (captainError) {
      console.error("[Register API] Error inserting captain:", captainError);
    } else if (captainData?.id) {
      // Link captain_id in teams table
      await db
        .from("teams")
        .update({ captain_id: captainData.id })
        .eq("id", teamId);
    }

    // 7. Insert Teammates into `members` table
    for (const tm of members) {
      if (tm.name?.trim() && tm.usn?.trim()) {
        const tmUsn = tm.usn.trim().toUpperCase();
        const tmPhone = tm.phone?.trim() || null;

        const memberPayload = {
          team_id: teamId,
          name: tm.name.trim(),
          email: `${tmUsn.toLowerCase()}@mite.ac.in`,
          college: "MITE",
          ...(tmPhone ? { phone: tmPhone } : {}),
        };

        const memRes = await db.from("members").insert(memberPayload);
        if (
          memRes.error &&
          (memRes.error.message?.includes("phone") ||
            memRes.error.message?.includes("column"))
        ) {
          await db.from("members").insert({
            team_id: teamId,
            name: tm.name.trim(),
            email: `${tmUsn.toLowerCase()}@mite.ac.in`,
            college: "MITE",
          });
        }
      }
    }

    // 8. Initialize Wallet with 100 points
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
    return NextResponse.json(
      { error: "Server configuration error. Please contact the organizers." },
      { status: 500 }
    );
  }
}
