import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://qqbuauryvhgssmmxiiuh.supabase.co";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

/**
 * Server client bound to the caller's session cookie.
 *
 * This client carries the signed-in user's JWT, so every request it
 * makes is evaluated by PostgreSQL Row Level Security exactly as it
 * would be from the browser. Use this for anything that reads or
 * writes participant or admin data — it is the only server client
 * that must be used for authorization.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseKey, {
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
          // `setAll` may only be called from a Server Action or Route Handler.
        }
      },
    },
  });
}

/**
 * Anonymous read-only client.
 *
 * Used for public auction state (the projector and the public
 * leaderboard). It is restricted by the public read policies that
 * migration 018 defines, so it can never read submissions, wallets
 * or audit records.
 */
export function createPublicClient() {
  return createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
