import { createClient } from "@supabase/supabase-js";

/**
 * Server client with the service-role key.
 *
 * ─────────────────────────────────────────────────────────────────
 * DANGER — this client BYPASSES Row Level Security.
 *
 * It must only be used for operations that cannot be performed by a
 * participant and that are validated in application code before the
 * call:
 *   • creating the Auth account during registration
 *   • inserting the team / member / wallet rows during registration
 *   • inserting a submission for a team whose ownership was just
 *     verified from the caller's session
 *
 * It must NEVER be used for auction state, bids, wallets, bonuses,
 * eliminations or admin actions — those are exclusively owned by the
 * SECURITY DEFINER engine functions in PostgreSQL.
 * ─────────────────────────────────────────────────────────────────
 */
export function getServiceDb() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://qqbuauryvhgssmmxiiuh.supabase.co";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
