import { createClient } from "@supabase/supabase-js";

/**
 * Creates a server-side Supabase client with elevated service role (if available)
 * or publishable/anon key fallback for server-rendered endpoints.
 */
export function getServerDb() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://qqbuauryvhgssmmxiiuh.supabase.co";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
