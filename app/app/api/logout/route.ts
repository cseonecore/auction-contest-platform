import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request) {
  try {
    // Session-bound client: the publishable key plus the session cookie, so
    // the sign-out revokes the caller's own session.
    const supabase = await createClient();

    // 1. Invalidate the current session on the server
    // The RPC handles the session cleanup; Supabase's signOut() also revokes
    // the session cookies.
    const { error: invalidateError } = await supabase.rpc("invalidate_current_session");

    if (invalidateError) {
      console.warn("[Logout API] Session invalidation warning:", invalidateError.message);
    }

    // 2. Sign out from Supabase Auth — this revokes the Supabase session cookies
    await supabase.auth.signOut();

    // 3. The frontend clears its local state from the returned session
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
