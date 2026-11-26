import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceDb } from "@/lib/serverDb";
import { isValidUsn, normalizeUsn, USN_FORMAT_HINT } from "@/lib/usn";

const DEFAULT_MAX_TEAMS = 60;
const DEFAULT_REGISTRATION_OPEN = true;
const MIN_TEAM_MEMBERS = 2;
const MAX_TEAM_MEMBERS = 3;

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
  isNewAuthUser?: boolean;
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
  isNewAuthUser = false,
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

  // 5. Delete Auth user ONLY if it was newly created in this registration attempt.
  // Never delete pre-existing or orphaned Auth users to protect account integrity.
  if (authUserId && isNewAuthUser) {
    try {
      if (db.auth?.admin?.deleteUser) {
        const { error } = await db.auth.admin.deleteUser(authUserId);
        if (error) {
          const msg = `Failed to delete newly created Auth user ${authUserId}: ${error.message}`;
          console.error(`[Register API Rollback ERROR] ${msg}`);
          failures.push(msg);
        } else {
          console.log(`[Register API Rollback] Deleted newly created Auth user: ${authUserId}`);
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
  } else if (authUserId && !isNewAuthUser) {
    console.log(`[Register API Rollback] Preserved existing Auth user during rollback: ${authUserId}`);
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

interface CaptainAuthResolution {
  userId: string;
  isNewUser: boolean;
  error: Error | null;
  conflictDetails?: {
    isRegisteredTeam: boolean;
    teamName?: string;
  };
}

/**
 * Searches for an existing Supabase Auth user by email across all pages.
 */
async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<{ id: string; email?: string } | null> {
  const cleanEmail = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users) {
      console.error("[Register API] Error listing auth users:", error?.message);
      break;
    }
    const found = data.users.find(
      (u) => (u.email || "").trim().toLowerCase() === cleanEmail
    );
    if (found) return { id: found.id, email: found.email };
    if (data.users.length < perPage) break;
  }
  return null;
}

/**
 * Resolves or creates a Supabase Auth user for the captain.
 * Handles existing/orphaned accounts intelligently:
 *   1. If user does not exist, creates it with captain role and confirmed email.
 *   2. If user already exists:
 *      - Checks if user is already linked to an active team or member in PostgreSQL.
 *      - If already linked, signals duplicate registration conflict.
 *      - If orphaned (no team or member record), adopts and updates the account with initial credentials.
 * Never falls back to client-side auth.signUp().
 */
async function resolveCaptainAuthUser(
  supabase: SupabaseClient,
  email: string,
  password: string,
  cleanCaptainUsn: string,
  role: string = "captain"
): Promise<CaptainAuthResolution> {
  try {
    if (!supabase.auth?.admin?.createUser) {
      return {
        userId: "",
        isNewUser: false,
        error: new Error("Supabase Auth admin API is unavailable on the service client."),
      };
    }

    // 1. Attempt to create fresh Auth user
    const { data, error: adminError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        usn: cleanCaptainUsn.toLowerCase(),
        role: role,
      },
      app_metadata: {
        role: role,
      },
    });

    if (!adminError && data?.user?.id) {
      const newId = data.user.id.trim();
      console.log(`[Register API] Created new Auth user via admin API: ${newId}`);
      return { userId: newId, isNewUser: true, error: null };
    }

    // 2. If error is not a duplicate/already registered error, return failure immediately
    const errorMsg = adminError?.message || "Failed to create authentication user.";
    const errLower = errorMsg.toLowerCase();
    const isAlreadyExists =
      /already.*registered|already exists|duplicate/i.test(errLower) ||
      (errLower.includes("already") && errLower.includes("register")) ||
      (errLower.includes("already") && errLower.includes("exist"));

    if (!isAlreadyExists) {
      console.error("[Register API] Unexpected admin.createUser error:", errorMsg);
      return { userId: "", isNewUser: false, error: adminError || new Error(errorMsg) };
    }

    // 3. Email already exists in Auth. Find the existing Auth user record.
    console.log(`[Register API] Auth account for ${email} already exists. Locating existing account...`);
    const existingUser = await findAuthUserByEmail(supabase, email);
    if (!existingUser || !existingUser.id) {
      console.error(`[Register API] Could not locate existing Auth user for email ${email}`);
      return {
        userId: "",
        isNewUser: false,
        error: new Error(`Authentication user exists for ${email} but record could not be retrieved.`),
      };
    }

    const existingAuthId = existingUser.id.trim();

    // 4. Check if this Auth user is already linked to an active team or member in the database
    const [memCheck, teamCheck] = await Promise.all([
      supabase
        .from("members")
        .select("id, name, email, team_id, teams(name)")
        .or(`id.eq.${existingAuthId},email.ilike.${email}`)
        .maybeSingle(),
      supabase
        .from("teams")
        .select("id, name")
        .eq("captain_id", existingAuthId)
        .maybeSingle(),
    ]);

    const activeTeamName =
      (memCheck.data?.teams as unknown as { name?: string })?.name ||
      teamCheck.data?.name;

    if (memCheck.data || teamCheck.data) {
      console.warn(
        `[Register API] Auth user ${existingAuthId} is actively registered under team "${activeTeamName || "unknown"}"`
      );
      return {
        userId: existingAuthId,
        isNewUser: false,
        error: null,
        conflictDetails: {
          isRegisteredTeam: true,
          teamName: activeTeamName || undefined,
        },
      };
    }

    // 5. Account is orphaned (no team or member record). Adopt and update it.
    console.log(`[Register API] Adopting orphaned Auth user ${existingAuthId} for ${email}`);
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      existingAuthId,
      {
        password,
        email_confirm: true,
        user_metadata: {
          usn: cleanCaptainUsn.toLowerCase(),
          role: role,
        },
        app_metadata: {
          role: role,
        },
      }
    );

    if (updateError) {
      console.error(`[Register API] Failed to update orphaned Auth user ${existingAuthId}:`, updateError.message);
      return {
        userId: "",
        isNewUser: false,
        error: new Error(`Failed to configure existing authentication account: ${updateError.message}`),
      };
    }

    return { userId: existingAuthId, isNewUser: false, error: null };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { userId: "", isNewUser: false, error };
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
  let isNewAuthUser = false;
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

    const captainPhoneDigits = captain.phone.replace(/\D/g, "");
    if (captainPhoneDigits.length < 10) {
      return NextResponse.json(
        { error: "Please enter a valid Captain Phone Number (at least 10 digits)." },
        { status: 400 }
      );
    }

    if (!isValidUsn(captain.usn)) {
      return NextResponse.json(
        {
          error: `Invalid Captain USN "${captain.usn}". Must follow pattern ${USN_FORMAT_HINT}.`,
        },
        { status: 400 }
      );
    }

    // Only team members with both a name and a USN count toward team size.
    const validMembers = (Array.isArray(members) ? members : []).filter(
      (tm) => tm.name?.trim() && tm.usn?.trim()
    );
    const totalMembers = 1 + validMembers.length;

    if (totalMembers < MIN_TEAM_MEMBERS) {
      return NextResponse.json(
        {
          error: `A team must have at least ${MIN_TEAM_MEMBERS} members (the Captain plus at least one teammate).`,
        },
        { status: 400 }
      );
    }

    if (totalMembers > MAX_TEAM_MEMBERS) {
      return NextResponse.json(
        {
          error: `A team can have at most ${MAX_TEAM_MEMBERS} members (the Captain plus up to two teammates).`,
        },
        { status: 400 }
      );
    }

    if (body.teamSize !== undefined && body.teamSize !== null) {
      const declaredSize = Number(body.teamSize);
      if (
        !Number.isInteger(declaredSize) ||
        declaredSize < MIN_TEAM_MEMBERS ||
        declaredSize > MAX_TEAM_MEMBERS
      ) {
        return NextResponse.json(
          {
            error: `Team size must be between ${MIN_TEAM_MEMBERS} and ${MAX_TEAM_MEMBERS} members.`,
          },
          { status: 400 }
        );
      }
      if (declaredSize !== totalMembers) {
        return NextResponse.json(
          {
            error: `Team size (${declaredSize}) does not match the ${totalMembers} member(s) provided.`,
          },
          { status: 400 }
        );
      }
    }

    if (Array.isArray(members)) {
      for (const tm of members) {
        if (tm.name?.trim() && tm.usn?.trim()) {
          if (!isValidUsn(tm.usn)) {
            return NextResponse.json(
              {
                error: `Invalid USN "${tm.usn}" for member "${tm.name}". Must follow pattern ${USN_FORMAT_HINT}.`,
              },
              { status: 400 }
            );
          }
        }
      }
    }

    const cleanTeamName = teamName.trim();
    const cleanCaptainUsn = normalizeUsn(captain.usn);
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
      validMembers.forEach((tm, idx) => {
        const u = normalizeUsn(tm.usn);
        allUsnEntries.push({
          usn: u,
          email: `${u.toLowerCase()}@mite.ac.in`,
          role: `Member ${idx + 2} (${tm.name.trim()})`,
        });
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

    const currentTeamCount = countRes.count ?? 0;
    // Character index rotates 1..10 as teams register, then repeats.
    // Formula: (current_team_count % 10) + 1 ensures 1-based indexing
    // and cycles through 1..10 indefinitely.
    const characterIndex = (currentTeamCount % 10) + 1;

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

    // 7. Resolve Auth user for the captain (creates new or safely adopts orphaned account)
    const authOutcome = await resolveCaptainAuthUser(
      db,
      captainEmail,
      initialPassword,
      cleanCaptainUsn,
      "captain"
    );

    if (authOutcome.conflictDetails?.isRegisteredTeam) {
      const regTeam = authOutcome.conflictDetails.teamName
        ? ` under team "${authOutcome.conflictDetails.teamName}"`
        : "";
      return NextResponse.json(
        {
          error: `Captain USN "${cleanCaptainUsn}" is already registered${regTeam}. Each participant can only register once.`,
        },
        { status: 409 }
      );
    }

    if (authOutcome.error || !authOutcome.userId || !authOutcome.userId.trim()) {
      const errorMsg = authOutcome.error?.message || "Failed to create authentication user.";
      console.error("[Register API] Fatal Auth creation failure:", errorMsg);
      return NextResponse.json(
        {
          error: `Registration failed: Unable to create authentication account (${errorMsg}). Registration cannot proceed without a valid account.`,
        },
        { status: 500 }
      );
    }

    const captainAuthId = authOutcome.userId.trim();
    isNewAuthUser = authOutcome.isNewUser;
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
        character_index: characterIndex,
      })
      .select("id")
      .single();

    if (teamError) {
      console.error("[Register API] Error inserting into teams:", teamError);
      await rollbackRegistration({
        db,
        authUserId: captainAuthId,
        isNewAuthUser,
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
        isNewAuthUser,
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
        isNewAuthUser,
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
    // Only the captain's phone number is collected, so teammate phone is always NULL.
    for (const tm of validMembers) {
      const tmUsn = normalizeUsn(tm.usn);
      const tmEmail = `${tmUsn.toLowerCase()}@mite.ac.in`;
      const teammateMemberId = randomUUID();

      const memberPayload = {
        id: teammateMemberId,
        team_id: teamId,
        name: tm.name.trim(),
        email: tmEmail,
        college: "MITE",
        phone: null,
      };

      const memRes = await db.from("members").insert(memberPayload);

      if (memRes.error) {
        console.error("[Register API] Error inserting teammate:", memRes.error);
        await rollbackRegistration({
          db,
          teamId,
          authUserId: captainAuthId,
          isNewAuthUser,
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
        isNewAuthUser,
        reason: `Wallet insert failure: ${walletErrorMsg}`,
      });
      createdTeamId = null;
      createdAuthUserId = null;
      return NextResponse.json(
        { error: `Database insert failed for wallet: ${walletErrorMsg || "Unknown error"}.` },
        { status: 500 }
      );
    }

    // 13. Ensure identity alignment in PostgreSQL
    try {
      await db.rpc("align_identities");
    } catch (alignErr) {
      console.warn("[Register API] Notice running align_identities:", alignErr);
    }

    // Clear tracking variables since registration completed successfully
    createdTeamId = null;
    createdAuthUserId = null;
    isNewAuthUser = false;

    // 14. Return success with genuinely needed fields (never expose credentials)
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
        isNewAuthUser,
        reason: `Unhandled registration exception: ${msg}`,
      });
    }

    return NextResponse.json(
      { error: `Registration error: ${msg}` },
      { status: 500 }
    );
  }
}
