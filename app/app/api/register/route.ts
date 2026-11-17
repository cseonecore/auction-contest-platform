import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServiceDb } from "@/lib/serverDb";

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
  }>;
}

interface RegistrationSettings {
  isOpen: boolean;
  maxTeams: number;
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
 * Creates a Supabase Auth user for the captain.
 * Also updates the user's app_metadata to include the role.
 * Returns the Auth user ID on success.
 */
async function createAuthUserWithRole(
  supabase: SupabaseClient,
  email: string,
  password: string,
  role: string
): Promise<{ userId: string; error: Error | null }> {
  // Step 1: Sign up the user
  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        usn: email.split("@")[0], // Store USN in user metadata
        role: role, // Store role in user metadata
      },
    },
  });

  if (signUpError) {
    console.error("[Register API] Supabase Auth sign-up error:", signUpError.message);
    return { userId: "", error: signUpError };
  }

  const userId = data.user?.id || "";

  if (!userId) {
    return { userId: "", error: new Error("Failed to create Auth user - no user ID returned.") };
  }

  // Step 2: Update the user's app_metadata through the admin API
  // to ensure the role is stored in app_metadata for RLS policies
  try {
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userId,
      {
        app_metadata: {
          role: role,
        },
      }
    );

    if (updateError) {
      console.warn(
        "[Register API] Warning: Could not update app_metadata:",
        updateError.message
      );
      // Don't fail registration if metadata update fails;
      // the user metadata will still be available for reference.
    }
  } catch (metaErr) {
    console.warn("[Register API] Exception updating app_metadata:", metaErr);
  }

  console.log(`[Register API] Created Auth user: ${userId} with email: ${email}, role: ${role}`);

  return { userId, error: null };
}

/**
 * Generates the initial password: TeamName + Last3DigitsOfCaptainUSN
 */
function generateInitialPassword(teamName: string, usn: string): string {
  const last3Digits = usn.slice(-3); // Preserves leading zeros
  return `${teamName}${last3Digits}`;
}

export async function GET() {
  try {
    const db = getServiceDb();
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

    return NextResponse.json({ isOpen, maxTeams, totalRegistered, remainingSlots });
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

    const USN_PATTERN = /^4MT\d{2}[A-Z]{2}\d{3}$/i;
    if (!USN_PATTERN.test(captain.usn.trim())) {
      return NextResponse.json(
        {
          error: `Invalid Captain USN "${captain.usn}". Must follow pattern 4MT2XBBMMM (e.g., 4MT24CS001).`,
        },
        { status: 400 }
      );
    }

    for (const tm of members || []) {
      if (tm.name?.trim() && tm.usn?.trim()) {
        if (!USN_PATTERN.test(tm.usn.trim())) {
          return NextResponse.json(
            {
              error: `Invalid USN "${tm.usn}" for member "${tm.name}". Must follow pattern 4MT2XBBMMM (e.g., 4MT24CS002).`,
            },
            { status: 400 }
          );
        }
      }
    }

    const cleanTeamName = teamName.trim();
    const cleanCaptainUsn = captain.usn.trim().toUpperCase();
    const captainEmail = `${cleanCaptainUsn.toLowerCase()}@mite.ac.in`;
    const captainSemester = captain.semester.trim();
    const captainPhone = captain.phone.trim();

    // 2. Build list of all participant USNs and check for duplicate USNs within the submitted form
    const allUsnEntries: Array<{ usn: string; email: string; role: string }> = [
      {
        usn: cleanCaptainUsn,
        email: captainEmail,
        role: `Captain (${captain.name.trim()})`,
      },
    ];

    if (Array.isArray(members)) {
      members.forEach((tm, idx) => {
        if (tm.name?.trim() && tm.usn?.trim()) {
          const u = tm.usn.trim().toUpperCase();
          allUsnEntries.push({
            usn: u,
            email: `${u.toLowerCase()}@mite.ac.in`,
            role: `Member ${idx + 2} (${tm.name.trim()})`,
          });
        }
      });
    }

    const seenInForm = new Map<string, string>();
    for (const entry of allUsnEntries) {
      if (seenInForm.has(entry.usn)) {
        return NextResponse.json(
          {
            error: `Duplicate USN "${entry.usn}" detected in your team details (${seenInForm.get(entry.usn)} and ${entry.role}). Each member must have a unique USN.`,
          },
          { status: 400 }
        );
      }
      seenInForm.set(entry.usn, entry.role);
    }

    // 3. Acquire server database client
    const db = getServerDb();

    // 4. Verify contest registration is open and capacity is not exceeded
    const [{ isOpen, maxTeams }, countRes] = await Promise.all([
      getRegistrationSettings(db),
      db.from("teams").select("*", { count: "exact", head: true }),
    ]);

    if (!isOpen) {
      return NextResponse.json(
        { error: "Registration is currently closed by the contest organizers." },
        { status: 403 }
      );
    }

    const totalRegistered = countRes.count ?? 0;
    if (totalRegistered >= maxTeams) {
      return NextResponse.json(
        { error: "Maximum registration capacity reached. No further registrations can be accepted." },
        { status: 403 }
      );
    }

    // 5. Check if Team Name already exists (case-insensitive and space-trimmed)
    const { data: existingTeam, error: existErr } = await db
      .from("teams")
      .select("id, name")
      .ilike("name", cleanTeamName)
      .maybeSingle();

    if (existErr) {
      console.error("[Register API] Error checking existing team:", existErr.message);
      return NextResponse.json(
        { error: "Database error while validating team name." },
        { status: 500 }
      );
    }

    if (existingTeam) {
      return NextResponse.json(
        { error: `The team name "${cleanTeamName}" is already registered. Please choose another name.` },
        { status: 409 }
      );
    }

    // 6. Check if ANY USN in this team is ALREADY registered in the database
    const allEmails = allUsnEntries.map((e) => e.email);
    const { data: existingMembers, error: memberCheckErr } = await db
      .from("members")
      .select("id, name, email, team_id, teams(name)")
      .in("email", allEmails);

    if (memberCheckErr) {
      console.error("[Register API] Error checking existing members:", memberCheckErr.message);
    }

    if (existingMembers && existingMembers.length > 0) {
      const dup = existingMembers[0];
      const dupUsn = dup.email ? dup.email.split("@")[0].toUpperCase() : "entered USN";
      const regTeam = (dup.teams as any)?.name;
      const teamInfo = regTeam ? ` under team "${regTeam}"` : "";
      return NextResponse.json(
        {
          error: `USN "${dupUsn}" is already registered${teamInfo}. Each participant can only register once.`,
        },
        { status: 409 }
      );
    }

    // Generate initial password
    const initialPassword = generateInitialPassword(cleanTeamName, cleanCaptainUsn);

<<<<<<< HEAD
    // 2. Acquire server database client
    const db = getServiceDb();

    // 3. Create Supabase Admin client for Auth user creation
=======
    // 7. Create Supabase Admin client for Auth user creation
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qqbuauryvhgssmmxiiuh.supabase.co";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

    const supabaseAdmin = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    });

    // 8. Create Auth user for the captain
    let authUserId: string | null = null;
    const { userId, error: authError } = await createAuthUserWithRole(
      supabaseAdmin,
      captainEmail,
      initialPassword,
      "captain"
    );

    if (authError) {
      const errLower = authError.message.toLowerCase();
      if (errLower.includes("already registered") || errLower.includes("already exists") || errLower.includes("duplicate")) {
        return NextResponse.json(
          {
            error: `Captain USN "${cleanCaptainUsn}" is already registered in the system. Each participant can only register once.`,
          },
          { status: 409 }
        );
      }
      console.warn("[Register API] Non-fatal Auth creation notice:", authError.message);
    } else {
      authUserId = userId;
    }

    // 6. Begin database operations - insert team first
    const { data: teamData, error: teamError } = await db
      .from("teams")
      .insert({
        name: cleanTeamName,
        captain_id: authUserId, // Link team to Auth user
        locked: false,
      })
      .select("id")
      .single();

    if (teamError || !teamData) {
      console.error("[Register API] Error inserting into teams:", teamError);
      if (authUserId) await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
      return NextResponse.json(
        { error: `Database insert failed for team: ${teamError?.message || "Unknown error"}.` },
        { status: 500 }
      );
    }

    const teamId = teamData.id;

    console.log(`[Register API] Created team: ${teamId}`);

    // 7. Insert Captain into `members` table.
    // The member id MUST be the Auth user id: the identity chain
    // auth.users.id == members.id == teams.captain_id is what
    // current_team_id(), is_team_captain() and place_bid() rely on.
    const { data: captainData, error: captainError } = await db
      .from("members")
      .insert({
        id: authUserId,
        team_id: teamId,
        name: captain.name.trim(),
        email: captainEmail,
        college: `MITE - Sem ${captainSemester}`,
      })
      .select("id")
      .single();

    if (captainError) {
      console.error("[Register API] Error inserting captain:", captainError);
      if (authUserId) await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
      await db.from("teams").delete().eq("id", teamId);

      if (captainError.code === "23505" || captainError.message?.includes("unique")) {
        return NextResponse.json(
          { error: `Captain USN "${cleanCaptainUsn}" is already registered. Each participant can only register once.` },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: `Database insert failed for captain: ${captainError.message}.` },
        { status: 500 }
      );
    }

    if (captainData?.id) {
      await db
        .from("teams")
        .update({ captain_id: captainData.id })
        .eq("id", teamId);
    }

    console.log(`[Register API] Inserted captain into members: ${captainData.id}`);

    // 8. Insert Teammates into `members` table
    if (Array.isArray(members)) {
      for (const tm of members) {
        if (tm.name?.trim() && tm.usn?.trim()) {
          const tmUsn = tm.usn.trim().toUpperCase();
          const tmEmail = `${tmUsn.toLowerCase()}@mite.ac.in`;

          const { error: tmError } = await db.from("members").insert({
            team_id: teamId,
            name: tm.name.trim(),
            email: tmEmail,
            college: "MITE",
          });

          if (tmError) {
            console.error("[Register API] Error inserting teammate:", tmError);
            if (tmError.code === "23505" || tmError.message?.includes("unique")) {
              await db.from("teams").delete().eq("id", teamId);
              if (authUserId) await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
              return NextResponse.json(
                { error: `Member USN "${tmUsn}" is already registered. Each participant can only register once.` },
                { status: 409 }
              );
            }
          } else {
            console.log(`[Register API] Inserted teammate: ${tm.name}`);
          }
        }
      }
    }

    // 9. Initialize Wallet with 100 points
    try {
      const { error: walletError } = await db.from("wallets").insert({
        team_id: teamId,
        balance: 100,
      });

      if (walletError) {
        console.warn("[Register API] Wallet insert error (non-critical):", walletError.message);
        // Not fatal - auction may handle wallet creation differently
      }
    } catch (wErr) {
      console.warn("[Register API] Wallet insert exception:", wErr);
    }

    // 10. Return success with all relevant data
    return NextResponse.json({
      success: true,
      teamId,
      teamName: cleanTeamName,
      captainEmail,
      initialPassword, // Provide initial password to captain
      authUserId,
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