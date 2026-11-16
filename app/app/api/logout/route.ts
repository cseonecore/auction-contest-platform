import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  try {
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

    // 1. Invalidate the current session on the server
    // The RPC will handle session cleanup; the Supabase auth.signOut() also revokes sessions
    const { error: invalidateError } = await supabase.rpc("invalidate_current_session");

    if (invalidateError) {
      console.warn("[Logout API] Session invalidation warning:", invalidateError.message);
    }

    // 2. Sign out from Supabase Auth - this revokes the Supabase session cookies
    // The Supabase client's setAll callback will clear the cookies
    await supabase.auth.signOut();

    // 3. Return success - the Supabase auth.signOut() combined with the
    // session invalidation RPC ensures the session is properly terminated
    // The frontend should use the returned session state to clear local storage
    return NextResponse.json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Logout failed.";
    console.error("[Logout API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}