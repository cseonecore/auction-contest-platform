import { NextResponse } from "next/server";
import { getDbClient } from "@/lib/supabaseServer";

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

    // Strict USN pattern: 4MT2XBBMMM (e.g., 4MT24CS001)
    const USN_PATTERN = /^4MT\d{2}[A-Z]{2}\d{3}$/i;
    const cleanCaptainUsn = rawCaptainUsn.replace(/[\s-]/g, "");

    if (!USN_PATTERN.test(cleanCaptainUsn)) {
      return NextResponse.json(
        {
          error:
            "Invalid Captain USN format. Must follow pattern 4MT2XBBMMM (e.g., 4MT24CS001).",
        },
        { status: 400 }
      );
    }

    const cleanTeamName = teamName.trim();
<<<<<<< HEAD
    const cookieStore = await cookies();
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qqbuauryvhgssmmxiiuh.supabase.co";
    // The publishable (anon) key is used on purpose: the session JWT
    // then carries the user's identity and every read is evaluated by
    // Row Level Security. A service-role key would silently bypass it.
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as any)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if middleware or server-side revalidation
            // is managing the cookies.
          }
        },
      },
    });

    const expectedEmail = `${captainUsn.toLowerCase()}@mite.ac.in`;

    // // 1. Authenticate via Supabase Auth using the institutional email
    // // and the provided password (or initial password if given).
    // // The initial password is: TeamName + Last3DigitsOfCaptainUSN
    // const initialPassword = body.initialPassword || "";

    const { data: authData, error: authSignInError } = await supabase.auth
      .signInWithPassword({
        email: expectedEmail,
        password: body.initialPassword || "",
      });

    if (authSignInError) {
      // Differentiate between "account truly doesn't exist" vs "account exists
      // but password is wrong (initial login scenario)".
      const errLower = (authSignInError.message || "").toLowerCase();
      const isPasswordIssue =
        errLower.includes("invalid login credentials") ||
        errLower.includes("invalid password") ||
        errLower.includes("email not confirmed");

      if (isPasswordIssue) {
        // Account exists in Supabase Auth (was created during registration),
        // but the password supplied isn't correct (or this is the first login).
        // Return a helpful message with the initial password rather than
        // falsely saying "Please register first".
        return NextResponse.json(
          {
            error:
              "Incorrect password. Your initial password is: " +
              body.teamName +
              captainUsn.slice(-3) +
              ". " +
              "Please complete password change, or use the initial password above.",
          },
          { status: 401 }
        );
      }

      // Truly invalid email/password combination AND account doesn't exist
      return NextResponse.json(
        { error: "Invalid email or password. Please register first." },
        { status: 401 }
      );
    }

    // // 2. Mark the session as active (this will overwrite any stale state)
    // // Called AFTER successful login to establish the new active session
    // // But we'll do this after checking for existing sessions below.

    // // 3. Get the user details to check password change status
    // // The supabase client automatically sets cookies via the setAll callback above
    // The session cookie is already set by signInWithPassword above.
    // However, we need to call getUser() to finalize the authentication state.
    const { data: user, error: userError } = await supabase.auth.getUser();

    if (userError || !user.user) {
      return NextResponse.json(
        { error: "Authentication failed. No active session." },
        { status: 401 }
      );
    }

    // // 4. At this point, the user is successfully authenticated via Supabase Auth.
    // // Now we enforce single-device: check if this user already has an active session.
    // // This RPC is safe to call NOW because auth.uid() can resolve the user ID
    // // thanks to the session cookie set by signInWithPassword above.

    // // 4. Check if the authenticated user already has an active session
    // // (single-device enforcement). This is called AFTER authentication,
    // // never before, per the requirements.
    let sessionCheckBoolean = true;
    let singleDeviceEnforced = true;
    try {
      const sessionCheckResp = await supabase.rpc("check_session_active");
      if (sessionCheckResp.error) {
        // Migration 010 may not be deployed yet. Skip the check rather
        // than blocking every single login.
        singleDeviceEnforced = false;
        console.warn(
          "[Login API] Single-device check unavailable:",
          sessionCheckResp.error.message
        );
      } else {
        sessionCheckBoolean = sessionCheckResp.data === true;
      }
    } catch (rpcErr) {
      singleDeviceEnforced = false;
      console.warn("[Login API] Single-device check failed:", rpcErr);
    }

    // sessionCheckBoolean is true = no existing session, false = existing session
    if (singleDeviceEnforced && sessionCheckBoolean === false) {
      // User already has an active session on another device
      return NextResponse.json(
        {
          error:
            "This account is already logged in on another device. Please log out from the other device first.",
        },
        { status: 409 }
      );
    }

    // // 5. No existing session (or RPC returned true), so mark this new session as active.
    // // This overwrites any previous session record (the new login wins).
    try {
      const markResp = await supabase.rpc("mark_session_active");
      if (markResp.error) {
        console.warn(
          "[Login API] mark_session_active unavailable:",
          markResp.error.message
        );
      }
    } catch (markErr) {
      console.warn("[Login API] mark_session_active failed:", markErr);
    }

    // // 6. Verify the authenticated user's email matches the expected USN email
    const authUserId = user.user.id;
    const authEmail = user.user.email || "";

    if (authEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
      return NextResponse.json(
        {
          error: "Invalid Captain USN for this team. Please enter the correct USN used during registration.",
        },
        { status: 401 }
      );
    }

    // // 7. Check if the password needs to be changed (initial login)
    // // We check the user's app_metadata for password change status
    const userMetadata = user.user.app_metadata || {};
    const hasChangedPassword =
      userMetadata.password_changed === true || userMetadata.onboarding_complete === true;

    // // 7. Fetch the team that this captain owns.
    // The filter is mandatory: an unfiltered maybeSingle() fails as soon
    // as a second team is registered.
    const { data: initialTeam, error: teamErr } = await supabase
      .from("teams")
      .select("id, name, captain_id, locked, created_at")
      .eq("captain_id", authUserId)
=======
    const db = getDbClient();

    // 1. Strict Query: Find Team in Supabase (case-insensitive)
    let { data: team, error: teamErr } = await db
      .from("teams")
      .select("id, name, captain_id, locked, created_at")
      .ilike("name", cleanTeamName)
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198
      .maybeSingle();

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

<<<<<<< HEAD
    const team = initialTeam;

    // // 8. Fetch all members of this team
    const { data: members, error: memErr } = await supabase
=======
    // 2. Fetch all members of this team
    const { data: members, error: memErr } = await db
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198
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

<<<<<<< HEAD
    // // 9. Identify the Captain of this team
=======
    // 3. Identify the Captain of this team
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198
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

<<<<<<< HEAD
    // // 10. Verify the captain's email matches the authenticated user
    const expectedCaptainEmail = `${captainUsn.toLowerCase()}@mite.ac.in`;
=======
    // 4. Strictly match Captain USN against the Captain's registered USN/email (serving as password)
    const expectedEmail = `${cleanCaptainUsn.toLowerCase()}@mite.ac.in`;
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198
    const isCaptainMatch =
      captain?.email &&
      (captain.email.toLowerCase() === expectedEmail ||
        captain.email.toUpperCase().includes(cleanCaptainUsn) ||
        (captain.college && captain.college.toUpperCase().includes(cleanCaptainUsn)));

    if (!isCaptainMatch) {
      return NextResponse.json(
        {
          error:
            "Invalid Captain USN for this team. Please enter the correct Captain USN used during registration.",
        },
        { status: 401 }
      );
    }

<<<<<<< HEAD
    // // 10. Successful login - return team data
    // // Include onboarding_required flag if password hasn't been changed
    const response: Record<string, unknown> = {
=======
    // 5. Successful strictly verified login
    const response = NextResponse.json({
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198
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

<<<<<<< HEAD
    // // Add onboarding_required flag if this is the first login
    if (!hasChangedPassword) {
      response.onboarding_required = true;
    }
=======
    response.cookies.set("b2b_team_id", team.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed.";
    console.error("[Login API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
