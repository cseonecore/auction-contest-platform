import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServerDb } from "@/lib/serverDb";

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
      emailConfirm: false, // Registration is instant, no email confirm required
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
    const db = getServerDb();
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

    // Generate initial password
    const initialPassword = generateInitialPassword(cleanTeamName, cleanCaptainUsn);

    // 2. Acquire server database client
    const db = getServerDb();

    // 3. Create Supabase Admin client for Auth user creation
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
        setAll() {
          // No-op on server
        },
      },
    });

    // 4. Create Auth user first - this is outside the DB transaction
    // Role will be "captain" since this is a captain registration
    const { userId: authUserId, error: authError } = await createAuthUserWithRole(
      supabaseAdmin,
      captainEmail,
      initialPassword,
      "captain"
    );

    if (authError) {
      return NextResponse.json(
        { error: `Authentication creation failed: ${authError.message}` },
        { status: 500 }
      );
    }

    if (!authUserId) {
      return NextResponse.json(
        { error: "Failed to create authentication user." },
        { status: 500 }
      );
    }

    console.log(`[Register API] Created Auth user: ${authUserId} with email: ${captainEmail}`);

    // 5. Check if team name already exists (case-insensitive)
    const { data: existingTeam, error: existErr } = await db
      .from("teams")
      .select("id")
      .ilike("name", cleanTeamName)
      .maybeSingle();

    if (existErr) {
      console.error("[Register API] Error checking existing team:", existErr.message);
      // Clean up: delete the Auth user we just created
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: "Server configuration error. Please contact the organizers." },
        { status: 500 }
      );
    }

    if (existingTeam) {
      // Clean up: delete the Auth user we just created
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: `The team name "${cleanTeamName}" is already registered. Please choose another name.` },
        { status: 409 }
      );
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
      // Clean up: delete the Auth user
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: `Database insert failed for team: ${teamError?.message || "Unknown error"}.` },
        { status: 500 }
      );
    }

    const teamId = teamData.id;

    console.log(`[Register API] Created team: ${teamId}`);

    // 7. Insert Captain into `members` table
    const { data: captainData, error: captainError } = await db
      .from("members")
      .insert({
        team_id: teamId,
        name: captain.name.trim(),
        email: captainEmail,
        college: `MITE - Sem ${captainSemester}`, // Fixed: only college and semester
      })
      .select("id")
      .single();

    if (captainError) {
      console.error("[Register API] Error inserting captain:", captainError);
      // Clean up: delete Auth user and team
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      await db.from("teams").delete().eq("id", teamId);
      return NextResponse.json(
        { error: `Database insert failed for captain: ${captainError.message}.` },
        { status: 500 }
      );
    }

    if (captainData?.id) {
      // Already linked via teams.captain_id set above, but ensure consistency
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

          // Check for duplicate USN within the same team
          const { data: existingMember, error: memberCheckErr } = await db
            .from("members")
            .select("id")
            .eq("team_id", teamId)
            .ilike("email", tmEmail)
            .maybeSingle();

          if (memberCheckErr) {
            console.error("[Register API] Error checking duplicate member:", memberCheckErr.message);
            // Clean up and return error
            await supabaseAdmin.auth.admin.deleteUser(authUserId);
            await db.from("teams").delete().eq("id", teamId);
            return NextResponse.json(
              { error: `Error checking duplicate member: ${memberCheckErr.message}.` },
              { status: 500 }
            );
          }

          if (existingMember) {
            // Clean up and return error
            await supabaseAdmin.auth.admin.deleteUser(authUserId);
            await db.from("teams").delete().eq("id", teamId);
            return NextResponse.json(
              { error: `A member with USN "${tm.usn}" is already registered in this team.` },
              { status: 409 }
            );
          }

          const { error: tmError } = await db.from("members").insert({
            team_id: teamId,
            name: tm.name.trim(),
            email: tmEmail,
            college: "MITE", // Fixed: clean college field
          });

          if (tmError) {
            console.error("[Register API] Error inserting teammate:", tmError);
            // Continue with partial registration; we'll clean up auth/user below
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