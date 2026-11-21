import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side admin sign-in.
 *
 * The admin console used to call `supabase.auth.signInWithPassword()`
 * directly from the browser. When the browser cannot reach the Supabase
 * auth endpoint (offline, blocked network, paused project, proxy), that
 * call rejects with the opaque `TypeError: Failed to fetch`, which is
 * what the admin login card used to show.
 *
 * This route performs the same password sign-in on the server — where
 * connectivity is reliable — verifies that the account actually carries
 * the `admin` role, and only then returns the session tokens. The
 * browser adopts them with `supabase.auth.setSession()`, so no
 * privileged key ever leaves the server.
 */

const FALLBACK_URL = "https://qqbuauryvhgssmmxiiuh.supabase.co";
const FALLBACK_KEY = "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function getAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    FALLBACK_KEY;

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "Invalid admin email or password.";
  }
  if (/email not confirmed/i.test(message)) {
    return "This admin account has not been confirmed yet. Contact the Supabase project owner.";
  }
  if (/failed to fetch|fetch failed|network|econnrefused|enotfound|timeout/i.test(message)) {
    return "The server could not reach the authentication service. Check the Supabase project status and the server's network connection.";
  }
  return message;
}

export async function POST(request: Request) {
  let body: LoginBody | null = null;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    body = null;
  }

  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Admin email and password are required." },
      { status: 400 }
    );
  }

  try {
    const authClient = getAuthClient();

    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      const message = friendlyAuthError(
        error?.message ?? "Authentication failed."
      );
      const status = error?.status && error.status >= 400 && error.status < 500 ? 401 : 502;
      return NextResponse.json({ error: message }, { status });
    }

    const role = (data.user.app_metadata?.role as string | undefined) ?? null;
    if (role !== "admin") {
      // Never hand a non-admin a session from the admin login form.
      await authClient.auth
        .signOut({ scope: "local" })
        .catch(() => undefined);

      return NextResponse.json(
        {
          error:
            role
              ? `This account has the "${role}" role, not "admin". Use an administrator account.`
              : 'This account does not have the "admin" role. Ask an organiser to grant it in Supabase (auth.users.raw_app_meta_data).',
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      user: {
        id: data.user.id,
        email: data.user.email ?? null,
        role,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Admin authentication failed.";
    console.error("[Admin Login API] Exception:", message);

    return NextResponse.json(
      { error: friendlyAuthError(message) },
      { status: 502 }
    );
  }
}
