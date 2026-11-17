import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request) {
  try {
    const supabase = await createClient();

    const { error: invalidateError } = await supabase.rpc("invalidate_current_session");

    if (invalidateError) {
      console.warn("[Logout API] Session invalidation warning:", invalidateError.message);
    }

    await supabase.auth.signOut();

    const response = NextResponse.json({
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

export async function POST(request: Request) {
  return GET(request);
}
