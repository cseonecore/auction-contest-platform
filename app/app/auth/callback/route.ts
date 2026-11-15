import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/profile";
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  // Determine application origin (handles reverse proxies & Vercel)
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : requestUrl.origin;

  // 1. Handle incoming OAuth error from Supabase/Google
  if (error || errorDescription) {
    const errorMsg = errorDescription || error || "Google authentication failed";
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorMsg)}`
    );
  }

  // 2. Exchange authorization code for authenticated session on server
  if (code) {
    try {
      const supabase = await createClient();
      const { error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(code);

      if (!exchangeError) {
        // Successful authentication: redirect to destination (default /profile)
        return NextResponse.redirect(`${origin}${next}`);
      }

      console.error("[Auth Callback] Exchange Error:", exchangeError.message);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Unexpected error during session exchange";
      console.error("[Auth Callback] Exception:", msg);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(msg)}`
      );
    }
  }

  // Fallback if accessed directly without code
  return NextResponse.redirect(`${origin}/login`);
}
