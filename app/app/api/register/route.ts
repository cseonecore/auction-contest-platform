import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
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
    phone?: string;
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

interface RollbackParams {
  db: SupabaseClient;
  teamId?: string | null;
  authUserId?: string | null;
  reason: string;
}

/**
 * Robust, cascading rollback for failed registration attempts.
 * Cleans up wallets, members, teams, and Supabase Auth users.
 * Never silently swallows cleanup errors; logs all failures for auditability.
 */
async function rollbackRegistration({
  db,
  teamId,
  authUserId,
  reason,
}: RollbackParams): Promise<string[]> {
  const failures: string[] = [];
  console.warn(`[Register API] Initiating registration rollback. Reason: ${reason}`);

  if (teamId) {
    // 1. Break any circular foreign key by clearing teams.captain_id first
    try {
      const { error: clearCapError } = await db
        .from("teams")
        .update({ captain_id: null })
        .eq("id", teamId);
      if (clearCapError) {
        const msg = `Failed to clear captain_id on team ${teamId}: ${clearCapError.message}`;
        console.error(`[Register API Rollback ERROR] ${msg}`);
        failures.push(msg);
      } else {
        console.log(`[Register API Rollback] Cleared captain_id on team: ${teamId}`);
      }
    } catch (err) {
      const msg = `Exception clearing captain_id on team ${teamId}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[Register API Rollback ERROR] ${msg}`);
      failures.push(msg);
    }

    // 2. Delete wallets
    try {
      const { error } = await db.from("wallets").delete().eq("team_id", teamId);
      if (error) {
        const msg = `Failed to delete wallets for team ${teamId}: ${error.message}`;
        console.error(`[Register API Rollback ERROR] ${msg}`);
        failures.push(msg);
      } else {
        console.log(`[Register API Rollback] Deleted wallets for team: ${teamId}`);
      }
    } catch (err) {
      const msg = `Exception deleting wallets for team ${teamId}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[Register API Rollback ERROR] ${msg}`);
      failures.push(msg);
    }

    // 3. Delete members
    try {
      const { error } = await db.from("members").delete().eq("team_id", teamId);
      if (error) {
        const msg = `Failed to delete members for team ${teamId}: ${error.message}`;
        console.error(`[Register API Rollback ERROR] ${msg}`);
        failures.push(msg);
      } else {
        console.log(`[Register API Rollback] Deleted members for team: ${teamId}`);
      }
    } catch (err) {
      const msg = `Exception deleting members for team ${teamId}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[Register API Rollback ERROR] ${msg}`);
      failures.push(msg);
    }

    // 4. Delete teams
    try {
      const { error } = await db.from("teams").delete().eq("id", teamId);
      if (error) {
        const msg = `Failed to delete team ${teamId}: ${error.message}`;
        console.error(`[Register API Rollback ERROR] ${msg}`);
        failures.push(msg);
      } else {
        console.log(`[Register API Rollback] Deleted team: ${teamId}`);
      }
    } catch (err) {
      const msg = `Exception deleting team ${teamId}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[Register API Rollback ERROR] ${msg}`);
      failures.push(msg);
    }
  }

  // 4. Delete Auth user
  if (authUserId) {
    try {
      if (db.auth?.admin?.deleteUser) {
        const { error } = await db.auth.admin.deleteUser(authUserId);
        if (error) {
          const msg = `Failed to delete Auth user ${authUserId}: ${error.message}`;
          console.error(`[Register API Rollback ERROR] ${msg}`);
          failures.push(msg);
        } else {
          console.log(`[Register API Rollback] Deleted Auth user: ${authUserId}`);
        }
      } else {
        const msg = `db.auth.admin.deleteUser unavailable; could not delete Auth user ${authUserId}`;
        console.error(`[Register API Rollback ERROR] ${msg}`);
        failures.push(msg);
      }
    } catch (err) {
      const msg = `Exception deleting Auth user ${authUserId}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[Register API Rollback ERROR] ${msg}`);
      failures.push(msg);
    }
  }

  if (failures.length > 0) {
    console.error(
      `[Register API CRITICAL] Partial rollback failure for teamId: ${teamId || "none"}, authUserId: ${authUserId || "none"}. Failures: ${failures.join(" | ")}`
    );
  } else {
    console.log(
      `[Register API Rollback] Rollback completed cleanly for teamId: ${teamId || "none"}, authUserId: ${authUserId || "none"}`
    );
  }

  return failures;
}

/**
 * Creates a Supabase Auth user for the captain using the service-role admin API.
 * Never falls back to client-side auth.signUp().
 * Returns the Auth user ID on success.
 */
async function createAuthUserWithRole(
  supabase: SupabaseClient,
  email: string,
  password: string,
  role: string
): Promise<{ userId: string; error: Error | null }> {
  try {
    if (!supabase.auth?.admin?.createUser) {
      return {
        userId: "",
        error: new Error("Supabase Auth admin API is unavailable on the service client."),
      };
    }

    const { data, error: adminError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        usn: email.split("@")[0],
        role: role,
      },
      app_metadata: {
        role: role,
      },
    });

    if (adminError) {
      console.error("[Register API] admin.createUser error:", adminError.message);
      return { userId: "", error: adminError };
    }

    const userId = data?.user?.id?.trim();
    if (!userId) {
      return {
        userId: "",
        error: new Error("Auth user creation succeeded but returned no user ID."),
      };
    }

    console.log(`[Register API] Created Auth user via admin API: ${userId}`);
    return { userId, error: null };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { userId: "", error };
  }
}

/**
 * Generates the initial password: TeamName + Last3DigitsOfCaptainUSN
 */
function generateInitialPassword(teamName: string, usn: string): string {
  const last3Digits = usn.slice(-3); // Preserves leading zeros
  return `${teamName}${last3Digits}`;
}

/**
 * Public registration status endpoint.
 * Returns public, safe registration metadata without leaking secrets.
 */
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

    return NextResponse.json({
      isOpen,
      maxTeams,
      totalRegistered,
      remainingSlots,
      // Provide snake_case equivalents for consumer compatibility
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
  let createdAuthUserId: string | null = null;
  let createdTeamId: string | null = null;
  let db: SupabaseClient | null = null;

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

    if (Array.isArray(members)) {
      for (const tm of members) {
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

    // 3. Acquire server database client (service-role)
    db = getServiceDb();

    // 4. Verify contest registration is open and capacity is not exceeded (fail closed on DB error)
    const [{ isOpen, maxTeams }, countRes] = await Promise.all([
      getRegistrationSettings(db),
      db.from("teams").select("*", { count: "exact", head: true }),
    ]);

    if (countRes.error) {
      console.error("[Register API] Error checking team count:", countRes.error.message);
      return NextResponse.json(
        { error: "Database error while verifying registration capacity." },
        { status: 500 }
      );
    }

    if (!isOpen) {
      return NextResponse.json(
        { error: "Registration is currently closed by the contest organizers." },
        { status: 403 }
      );
    }

    const totalRegistered = countRes.count ?? 0;
    if (totalRegistered >= maxTeams) {
      return NextResponse.json(
        {
          status: "limit_reached",
          message: "Sorry, all slots are filled!",
          error: "Maximum registration capacity reached. No further registrations can be accepted.",
          maxTeams,
          totalRegistered,
        },
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
      return NextResponse.json(
        { error: "Database error while verifying USN uniqueness." },
        { status: 500 }
      );
    }

    if (existingMembers && existingMembers.length > 0) {
      const dup = existingMembers[0];
      const dupUsn = dup.email ? dup.email.split("@")[0].toUpperCase() : "entered USN";
      const regTeam = (dup.teams as unknown as { name?: string })?.name;
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

    // 7. Create Auth user for the captain using the service-role client (strictly required - never fabricate an identity)
    const { userId, error: authError } = await createAuthUserWithRole(
      db,
      captainEmail,
      initialPassword,
      "captain"
    );

    if (authError || !userId || !userId.trim()) {
      const errorMsg = authError?.message || "Failed to create authentication user.";
      const errLower = errorMsg.toLowerCase();
      if (
        errLower.includes("already registered") ||
        errLower.includes("already exists") ||
        errLower.includes("duplicate")
      ) {
        return NextResponse.json(
          {
            error: `Captain USN "${cleanCaptainUsn}" is already registered in the system. Each participant can only register once.`,
          },
          { status: 409 }
        );
      }

      console.error("[Register API] Fatal Auth creation failure:", errorMsg);
      return NextResponse.json(
        {
          error: `Registration failed: Unable to create authentication account (${errorMsg}). Registration cannot proceed without a valid account.`,
        },
        { status: 500 }
      );
    }

    const captainAuthId = userId.trim();
    createdAuthUserId = captainAuthId;

    // 8. Begin database operations - insert team first with captain_id: null
    // To safely respect foreign keys (e.g. if teams.captain_id references public.members.id),
    // we insert the team record with captain_id = null first, then link after captain member creation.
    const generatedTeamId = randomUUID();
    const { data: teamData, error: teamError } = await db
      .from("teams")
      .insert({
        id: generatedTeamId,
        name: cleanTeamName,
        captain_id: null,
        locked: false,
      })
      .select("id")
      .single();

    if (teamError) {
      console.error("[Register API] Error inserting into teams:", teamError);
      await rollbackRegistration({
        db,
        authUserId: captainAuthId,
        reason: `Team insert failure: ${teamError.message || "Unknown error"}`,
      });
      createdAuthUserId = null;
      return NextResponse.json(
        { error: `Database insert failed for team: ${teamError.message || "Unknown error"}.` },
        { status: 500 }
      );
    }

    const teamId = teamData?.id || generatedTeamId;
    createdTeamId = teamId;
    console.log(`[Register API] Created team: ${teamId}`);

    // 10. Insert Captain into `members` table
    // STRICT: public.members.id MUST match auth.users.id for the captain (captainAuthId).
    // Never fall back to randomUUID() or fabricated IDs.
    const captainPayload = {
      id: captainAuthId,
      team_id: teamId,
      name: captain.name.trim(),
      email: captainEmail,
      college: `MITE - Sem ${captainSemester}`,
      phone: captainPhone,
    };

    const { data: captainData, error: captainError } = await db
      .from("members")
      .insert(captainPayload)
      .select("id")
      .single();

    if (captainError) {
      console.error("[Register API] Error inserting captain:", captainError);
      await rollbackRegistration({
        db,
        teamId,
        authUserId: captainAuthId,
        reason: `Captain member insert failure: ${captainError.message || "Unknown error"}`,
      });
      createdTeamId = null;
      createdAuthUserId = null;

      if (captainError.code === "23505" || captainError.message?.includes("unique")) {
        return NextResponse.json(
          { error: `Captain USN "${cleanCaptainUsn}" is already registered. Each participant can only register once.` },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: `Database insert failed for captain: ${captainError.message || "Unknown error"}.` },
        { status: 500 }
      );
    }

    // Link captain_id in teams table to verified captain member ID and check error
    const resolvedCaptainId = captainData?.id || captainAuthId;
    const { error: updateCapError } = await db
      .from("teams")
      .update({ captain_id: resolvedCaptainId })
      .eq("id", teamId);

    if (updateCapError) {
      console.error("[Register API] Error updating captain_id on teams:", updateCapError.message);
      await rollbackRegistration({
        db,
        teamId,
        authUserId: captainAuthId,
        reason: `Team captain_id update failure: ${updateCapError.message}`,
      });
      createdTeamId = null;
      createdAuthUserId = null;
      return NextResponse.json(
        { error: `Database update failed for team captain: ${updateCapError.message}.` },
        { status: 500 }
      );
    }

    console.log(`[Register API] Inserted captain into members: ${resolvedCaptainId}`);

    // 11. Insert Teammates into `members` table
    // Teammates do not have Auth logins; each receives a valid RFC 4122 v4 UUID.
    if (Array.isArray(members)) {
      for (const tm of members) {
        if (tm.name?.trim() && tm.usn?.trim()) {
          const tmUsn = tm.usn.trim().toUpperCase();
          const tmEmail = `${tmUsn.toLowerCase()}@mite.ac.in`;
          const tmPhone = tm.phone?.trim() || null;
          const teammateMemberId = randomUUID();

          const memberPayload = {
            id: teammateMemberId,
            team_id: teamId,
            name: tm.name.trim(),
            email: tmEmail,
            college: "MITE",
            phone: tmPhone,
          };

          const memRes = await db.from("members").insert(memberPayload);

          if (memRes.error) {
            console.error("[Register API] Error inserting teammate:", memRes.error);
            await rollbackRegistration({
              db,
              teamId,
              authUserId: captainAuthId,
              reason: `Teammate insert failure (${tmUsn}): ${memRes.error.message}`,
            });
            createdTeamId = null;
            createdAuthUserId = null;

            if (memRes.error.code === "23505" || memRes.error.message?.includes("unique")) {
              return NextResponse.json(
                { error: `Member USN "${tmUsn}" is already registered. Each participant can only register once.` },
                { status: 409 }
              );
            }

            return NextResponse.json(
              { error: `Database insert failed for member: ${memRes.error.message}.` },
              { status: 500 }
            );
          }

          console.log(`[Register API] Inserted teammate: ${tm.name} (${teammateMemberId})`);
        }
      }
    }

    // 12. Initialize Wallet with 100 points (fail closed if wallet initialization fails)
    let walletSuccess = false;
    let walletErrorMsg = "";

    const { error: walletError } = await db.from("wallets").insert({
      team_id: teamId,
      balance: 100,
    });

    if (!walletError) {
      walletSuccess = true;
    } else if (
      walletError.message?.includes("round") ||
      walletError.code === "23502"
    ) {
      // Fallback for two-round schema if table requires round
      const { error: roundWalletError } = await db.from("wallets").insert([
        { team_id: teamId, round: 1, balance: 100 },
        { team_id: teamId, round: 2, balance: 100 },
      ]);

      if (!roundWalletError) {
        walletSuccess = true;
      } else {
        walletErrorMsg = roundWalletError.message;
      }
    } else {
      walletErrorMsg = walletError.message;
    }

    if (!walletSuccess) {
      console.error("[Register API] Error initializing wallet:", walletErrorMsg);
      await rollbackRegistration({
        db,
        teamId,
        authUserId: captainAuthId,
        reason: `Wallet insert failure: ${walletErrorMsg}`,
      });
      createdTeamId = null;
      createdAuthUserId = null;
      return NextResponse.json(
        { error: `Database insert failed for wallet: ${walletErrorMsg || "Unknown error"}.` },
        { status: 500 }
      );
    }

    // Clear tracking variables since registration completed successfully
    createdTeamId = null;
    createdAuthUserId = null;

    // 13. Return success with genuinely needed fields (never expose credentials)
    return NextResponse.json({
      success: true,
      teamId,
      teamName: cleanTeamName,
      captainEmail,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to register team.";
    console.error("[Register API] Exception during registration:", msg);

    if (db && (createdTeamId || createdAuthUserId)) {
      await rollbackRegistration({
        db,
        teamId: createdTeamId,
        authUserId: createdAuthUserId,
        reason: `Unhandled registration exception: ${msg}`,
      });
    }

    return NextResponse.json(
      { error: `Registration error: ${msg}` },
      { status: 500 }
    );
  }
}
