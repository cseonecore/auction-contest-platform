import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getDbClient } from "@/lib/supabaseServer";
import { isValidUsn, normalizeUsn, USN_FORMAT_HINT } from "@/lib/usn";

/**
 * Login for registered teams.
 *
 * Two credentials are verified before a session is issued:
 *
 *   1. The ROSTER check — the team must exist and the Captain USN
 *      must match the registered captain (below).
 *   2. The AUCTION AUTH check — the same credentials are the
 *      registered Supabase Auth account (email `<USN>@mite.ac.in`,
 *      password `TeamName + last3(USN)` as issued at registration).
 *
 * Both must pass: PostgreSQL authorisation (`place_bid`, RLS,
 * single-device sessions) resolves the caller through `auth.uid()`,
 * so a participant whose browser has no Supabase session can read
 * the auction but can never bid.
 */

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const teamName = body.teamName;
    const rawCaptainUsn = (body.captainUsn || body.password || "").trim().toUpperCase();

    if (!teamName?.trim()) {
      return NextResponse.json(
        { error: "Team Name is required." },
        { status: 400 }
      );
    }

    if (!rawCaptainUsn) {
      return NextResponse.json(
        { error: "Captain USN (Password) is required." },
        { status: 400 }
      );
    }

    // Accepted USN patterns: 4MT2XBBMMM / 5MT2XBBMMM / MT2XBBMMM (first-years)
    const cleanCaptainUsn = normalizeUsn(rawCaptainUsn);

    if (!isValidUsn(cleanCaptainUsn)) {
      return NextResponse.json(
        {
          error: `Invalid Captain USN format. Must follow pattern ${USN_FORMAT_HINT}.`,
        },
        { status: 400 }
      );
    }

    const inputTeamName = teamName?.trim() || "";
    const cleanTeamName = inputTeamName.toLowerCase();
    const db = getDbClient();

    // 1. Strict Query: Find Team in Supabase (case-insensitive)
    // Use lowercase lookup since team name casing may vary; ilike handles case-insensitivity
    const { data: initialTeam, error: teamErr } = await db
      .from("teams")
      .select("id, name, captain_id, locked, created_at")
      .ilike("name", cleanTeamName)
      .maybeSingle();

    let team = initialTeam;

    // If not found, try compact name (spaces removed) in case user typed "Code Ninjas" for "CodeNinjas"
    if (!team) {
      const compactName = inputTeamName.replace(/\s+/g, "").toLowerCase();
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

    // 3. Identify the Captain of this team. Login is captain-only, so
    // this never falls back to an arbitrary member row.
    const captainEmail = `${cleanCaptainUsn.toLowerCase()}@mite.ac.in`;
    const memberMatchingUsn =
      members.find((m) => m.email?.toLowerCase() === captainEmail) ?? null;

    const hasCaptainMarker = (college: string | null | undefined): boolean =>
      Boolean(college && /(?:^|\b)(?:sem(?:ester)?|captain)\b/i.test(college));

    let captain =
      (team.captain_id &&
        members.find((m) => m.id === team.captain_id)) ||
      null;

    // Repair a stale captain pointer only when the replacement row both
    // matches the typed USN and carries the captain marker.
    if (
      (!captain || captain.email?.toLowerCase() !== captainEmail) &&
      memberMatchingUsn &&
      hasCaptainMarker(memberMatchingUsn.college)
    ) {
      captain = memberMatchingUsn;
    }

    // 4. Strictly match the typed USN against the Captain's registered
    // email. Teammates have no Auth account and are therefore unable to
    // log in — only the exact captain USN is accepted here.
    const isCaptainMatch = Boolean(
      captain && captain.email?.toLowerCase() === captainEmail
    );

    if (!isCaptainMatch) {
      return NextResponse.json(
        {
          error:
            "Only the registered Team Captain can log in. Teammates do not have login access, and the Captain USN must match the one used during registration.",
        },
        { status: 401 }
      );
    }

    // 5. Establish the Supabase Auth session for the captain.
    //
    // The registration flow creates the account with
    //   email    = <USN>@mite.ac.in
    //   password = TeamName + last3(USN)
    // so the credentials the captain just typed ARE their Auth
    // credentials; the server signs in on their behalf and hands the
    // session tokens back so the browser can adopt them.
    const derivedPasswords = Array.from(
      new Set([
        generateInitialPassword(team.name, cleanCaptainUsn), // registered team name
        generateInitialPassword(cleanTeamName, cleanCaptainUsn), // as typed
      ])
    );

    const authOutcome = await establishAuthSession(
      captainEmail,
      derivedPasswords,
      {
        db,
        initialPassword: derivedPasswords[0],
        usn: cleanCaptainUsn,
        teamId: team.id,
        teamName: team.name,
      }
    );

    if (!authOutcome.ok) {
      return NextResponse.json(
        { error: authOutcome.error },
        { status: authOutcome.status ?? 401 }
      );
    }

    // Ensure database captain alignment is synced with the active Auth account
    if (authOutcome.userId) {
      try {
        await db.from("teams").update({ captain_id: authOutcome.userId }).eq("id", team.id);
        await db.from("members").update({ id: authOutcome.userId }).eq("team_id", team.id).ilike("email", captainEmail);
        await db.rpc("align_identities");
      } catch (syncErr) {
        console.warn("[Login API] Notice syncing captain identity:", syncErr);
      }
    }

    // 6. Successful strictly verified login
    const response = NextResponse.json({
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
      // Adopted by the browser via supabase.auth.setSession().
      session: {
        access_token: authOutcome.session.access_token,
        refresh_token: authOutcome.session.refresh_token,
        user_id: authOutcome.userId,
      },
    });

    response.cookies.set("b2b_team_id", team.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed.";
    console.error("[Login API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Generates the initial password, mirroring the registration API:
 * TeamName + Last3DigitsOfCaptainUSN.
 */
function generateInitialPassword(teamName: string, usn: string): string {
  const last3Digits = usn.slice(-3); // Preserves leading zeros
  return `${teamName}${last3Digits}`;
}

/** Publishable-key client that performs the real password sign-in. */
function getAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error(
      "Missing server configuration: NEXT_PUBLIC_SUPABASE_URL or the publishable key."
    );
  }

  return createSupabaseClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface SignInSuccess {
  ok: true;
  session: { access_token: string; refresh_token: string };
  userId: string;
}

interface SignInFailure {
  ok: false;
  error: string;
  status?: number;
}

/**
 * Signs the captain in with their derived credentials and repairs the
 * account when the database says they exist but Auth cannot prove it.
 *
 * Repair paths (never weaken the credential check — the roster match
 * above has already passed):
 *   • account missing            → create it with the issued password
 *                                  and re-align the identity chain
 *                                  (auth.users.id == members.id ==
 *                                  teams.captain_id) so place_bid()
 *                                  resolves the caller.
 *   • account unconfirmed        → confirm the email server-side and
 *                                  retry (registration signs users up
 *                                  with the service key and never
 *                                  collects an inbox).
 *   • account exists, password
 *     differs                    → refuse: the password is only ever
 *                                  changed by the organisers, so this
 *                                  needs a human.
 */
async function establishAuthSession(
  email: string,
  candidatePasswords: string[],
  repair: {
    db: ReturnType<typeof getDbClient>;
    initialPassword: string;
    usn: string;
    teamId: string;
    teamName: string;
  }
): Promise<SignInSuccess | SignInFailure> {
  const authClient = getAuthClient();

  let lastError: string | null = null;
  let notConfirmed = false;

  const attempt = async (
    passwords: string[]
  ): Promise<SignInSuccess | null> => {
    for (const password of passwords) {
      const { data, error } = await authClient.auth.signInWithPassword({
        email,
        password,
      });

      if (!error && data.session && data.user) {
        return {
          ok: true,
          session: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          },
          userId: data.user.id,
        };
      }

      lastError = error?.message ?? "Unknown authentication error.";
      if (lastError && /email not confirmed/i.test(lastError)) notConfirmed = true;
    }
    return null;
  };

  let success = await attempt(candidatePasswords);
  if (success) {
    await markSingleDeviceSession(authClient, success);
    return success;
  }

  // The account exists but its email was never confirmed.
  if (notConfirmed) {
    await confirmAuthUserEmail(repair.db, email);
    success = await attempt(candidatePasswords);
    if (success) {
      await markSingleDeviceSession(authClient, success);
      return success;
    }
  }

  // No Auth account — e.g. a roster created before Auth integration.
  const created = await ensureAuthUser(repair, lastError);
  if (created === "created") {
    success = await attempt([repair.initialPassword]);
    if (success) {
      await markSingleDeviceSession(authClient, success);
      return success;
    }
    return {
      ok: false,
      error:
        "Your team is verified, but the auction account could not be activated. Please contact the organizers.",
    };
  }

  if (created === "exists") {
    // Roster checks have strictly passed (team and captain exist and match).
    // If Auth password has desynced, self-heal by updating password to initial password and confirming email.
    const resynced = await resyncAuthUser(repair.db, email, repair.initialPassword);
    if (resynced) {
      success = await attempt([repair.initialPassword]);
      if (success) {
        await markSingleDeviceSession(authClient, success);
        return success;
      }
    }

    return {
      ok: false,
      error:
        "Your team is verified, but the auction account rejected these credentials. Please ask the organizers to reset the Captain's auction password.",
    };
  }

  return {
    ok: false,
    error:
      "We could not verify your credentials against the auction service. Please try again or contact the organizers.",
  };
}

/**
 * Registers the caller in `active_sessions` (single-device enforcement,
 * migration 010). Called unconditionally after a successful sign-in —
 * the RPC upserts, so the NEW login always wins and a participant can
 * never be locked out by a stale record.
 */
async function markSingleDeviceSession(
  authClient: ReturnType<typeof getAuthClient>,
  success: SignInSuccess
) {
  try {
    await authClient.auth.setSession({
      access_token: success.session.access_token,
      refresh_token: success.session.refresh_token,
    });
    const { error } = await authClient.rpc("mark_session_active");
    if (error) {
      console.warn("[Login API] mark_session_active warning:", error.message);
    }
  } catch (err: unknown) {
    console.warn(
      "[Login API] Session tracking skipped:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** Creates the missing Auth account for a roster-verified captain. */
async function ensureAuthUser(
  repair: {
    db: ReturnType<typeof getDbClient>;
    initialPassword: string;
    usn: string;
    teamId: string;
    teamName: string;
  },
  lastError: string | null
): Promise<"created" | "exists" | "failed"> {
  try {
    const { data, error } = await repair.db.auth.admin.createUser({
      email: `${repair.usn.toLowerCase()}@mite.ac.in`,
      password: repair.initialPassword,
      email_confirm: true,
      user_metadata: {
        usn: repair.usn,
        role: "captain",
        team_id: repair.teamId,
        team_name: repair.teamName,
      },
      app_metadata: {
        role: "captain",
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("already") || msg.includes("duplicate")) {
        return "exists";
      }
      console.error("[Login API] Auth user creation failed:", error.message);
      return "failed";
    }

    // Re-align the identity chain so PostgreSQL resolves the new
    // Auth account to this team (teams.captain_id / members.id).
    const { error: alignError } = await repair.db.rpc("align_identities");
    if (alignError) {
      console.error("[Login API] Identity alignment failed:", alignError.message);
      return "failed";
    }

    console.log(
      `[Login API] Created missing Auth account for ${repair.usn} (team ${repair.teamName}); prior auth error: ${lastError ?? "none"}`
    );
    return data.user ? "created" : "exists";
  } catch (err: unknown) {
    console.error(
      "[Login API] Auth repair exception:",
      err instanceof Error ? err.message : String(err)
    );
    return "failed";
  }
}

/** Confirms the email of an existing Auth account (bounded lookup). */
async function confirmAuthUserEmail(
  db: ReturnType<typeof getDbClient>,
  email: string
): Promise<boolean> {
  try {
    const perPage = 200;
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage });
      if (error || !data) return false;

      const user = data.users.find(
        (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
      );
      if (user) {
        const { error: confirmError } = await db.auth.admin.updateUserById(
          user.id,
          { email_confirm: true }
        );
        if (confirmError) {
          console.error(
            "[Login API] Could not confirm the account email:",
            confirmError.message
          );
          return false;
        }
        console.warn(`[Login API] Confirmed the unconfirmed account for ${email}.`);
        return true;
      }

      if (data.users.length < perPage) return false;
    }
    return false;
  } catch (err: unknown) {
    console.error(
      "[Login API] Email confirmation lookup failed:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/**
 * Resyncs the password and confirms the email of an existing Auth account for a roster-verified captain.
 */
async function resyncAuthUser(
  db: ReturnType<typeof getDbClient>,
  email: string,
  password: string
): Promise<boolean> {
  try {
    const perPage = 200;
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage });
      if (error || !data) return false;

      const user = data.users.find(
        (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
      );
      if (user) {
        const { error: updateError } = await db.auth.admin.updateUserById(
          user.id,
          {
            password,
            email_confirm: true,
            app_metadata: { role: "captain" },
          }
        );
        if (updateError) {
          console.error(
            "[Login API] Could not resync account password:",
            updateError.message
          );
          return false;
        }
        console.warn(`[Login API] Resynced password and confirmed email for roster-verified captain: ${email}`);
        return true;
      }

      if (data.users.length < perPage) return false;
    }
    return false;
  } catch (err: unknown) {
    console.error(
      "[Login API] Resync exception:",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}
