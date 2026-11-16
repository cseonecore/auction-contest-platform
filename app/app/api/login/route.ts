import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const teamName = body.teamName;
    const captainUsn = (body.captainUsn || "").trim().toUpperCase();

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
    const cookieStore = await cookies();
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qqbuauryvhgssmmxiiuh.supabase.co";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
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

    // 1. Check if the user already has an active session (single-device enforcement)
    // This is called BEFORE login to check if the account is already logged in elsewhere
    const { data: sessionCheck, error: sessionCheckError } = await supabase
      .rpc("check_session_active");

    if (sessionCheckError) {
      console.error("[Login API] Session check error:", sessionCheckError.message);
      // Continue with login if session check fails (best-effort)
    } else if (sessionCheck === false) {
      // User already has an active session on another device
      return NextResponse.json(
        {
          error:
            "This account is already logged in on another device. Please log out from the other device first.",
        },
        { status: 409 }
      );
    }

    // 2. Authenticate via Supabase Auth using the institutional email
    // The email format is USN@mite.ac.in
    const expectedEmail = `${captainUsn.toLowerCase()}@mite.ac.in`;

    // The initial password is: TeamName + Last3DigitsOfCaptainUSN
    const initialPassword = body.initialPassword || "";

    const { data: authData, error: authSignInError } = await supabase.auth
      .signInWithPassword({
        email: expectedEmail,
        password: initialPassword,
      });

    if (authSignInError) {
      console.error("[Login API] Supabase sign in error:", authSignInError.message);
      return NextResponse.json(
        { error: "Invalid email or password. Please register first." },
        { status: 401 }
      );
    }

    // 3. Mark the session as active (this will overwrite any stale state)
    // Called AFTER successful login to establish the new active session
    await supabase.rpc("mark_session_active");

    // 4. Get the user details to check password change status
    // The supabase client automatically sets cookies via the setAll callback above
    const { data: user, error: userError } = await supabase.auth.getUser();

    if (userError || !user.user) {
      return NextResponse.json(
        { error: "Authentication failed. No active session." },
        { status: 401 }
      );
    }

    const authUserId = user.user.id;
    const authEmail = user.user.email || "";

    // Verify the authenticated user's email matches the expected USN email
    if (authEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
      return NextResponse.json(
        {
          error: "Invalid Captain USN for this team. Please enter the correct USN used during registration.",
        },
        { status: 401 }
      );
    }

    // 5. Check if the password needs to be changed (initial login)
    // We check the user's app_metadata for password change status
    const userMetadata = user.user.app_metadata || {};
    const hasChangedPassword =
      userMetadata.password_changed === true || userMetadata.onboarding_complete === true;

    // 6. Fetch the team using the RLS-safe approach
    const { data: initialTeam, error: teamErr } = await supabase
      .from("teams")
      .select("id, name, captain_id, locked, created_at")
      .maybeSingle();

    if (teamErr) {
      console.error("[Login API] Supabase query error:", teamErr);
      return NextResponse.json(
        { error: "Database error occurred while verifying credentials." },
        { status: 500 }
      );
    }

    if (!initialTeam) {
      return NextResponse.json(
        { error: `Team "${cleanTeamName}" was not found in the database. Please register first.` },
        { status: 404 }
      );
    }

    const team = initialTeam;

    // 7. Fetch all members of this team
    const { data: members, error: memErr } = await supabase
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

    // 8. Identify the Captain of this team
    let captain = null;
    if (team.captain_id) {
      captain = members.find((m) => m.id === team.captain_id);
    }
    if (!captain) {
      // Fallback: find captain by looking at the member linked to the team
      captain = members.find(
        (m) => m.college && m.college.toLowerCase().includes("sem")
      ) || members[0];
    }

    // 9. Verify the captain's email matches the authenticated user
    const expectedCaptainEmail = `${captainUsn.toLowerCase()}@mite.ac.in`;
    const isCaptainMatch =
      captain?.email && captain.email.toLowerCase() === expectedCaptainEmail;

    if (!isCaptainMatch) {
      return NextResponse.json(
        {
          error: "Invalid Captain USN for this team. Please enter the correct USN used during registration.",
        },
        { status: 401 }
      );
    }

    // 10. Successful login - return team data
    // Include onboarding_required flag if password hasn't been changed
    const response: Record<string, unknown> = {
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
      session: authData.session
        ? {
            accessToken: authData.session.access_token,
            refreshToken: authData.session.refresh_token,
            expiresAt: authData.session.expires_at,
          }
        : null,
    };

    // Add onboarding_required flag if this is the first login
    if (!hasChangedPassword) {
      response.onboarding_required = true;
    }

    return NextResponse.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Authentication failed.";
    console.error("[Login API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}