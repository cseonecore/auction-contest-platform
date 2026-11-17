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

<<<<<<< HEAD
    // 3. The frontend clears its local state from the returned session
    return NextResponse.json({
=======
    // 3. Return success - the Supabase auth.signOut() combined with the
    // session invalidation RPC ensures the session is properly terminated
    // The frontend should use the returned session state to clear local storage
    const response = NextResponse.json({
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198
      success: true,
      message: "Logged out successfully.",
    });

    response.cookies.delete("b2b_team_id");
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Logout failed.";
    console.error("[Logout API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
<<<<<<< HEAD
=======

export async function POST(request: Request) {
  return GET(request);
}
>>>>>>> 109203f413e158aa8bfb75fcb084aea4c4173198
