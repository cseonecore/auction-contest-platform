/**
 * Server-side Supabase client using the SERVICE ROLE key.
 *
 * ⚠️  THIS FILE MUST ONLY BE IMPORTED IN SERVER-SIDE CODE:
 *     - Next.js API routes (e.g. app/api/challenge/judge/route.ts)
 *     - Server Components / Server Actions
 *
 * The service role key bypasses Row Level Security and has full
 * read/write access to every table. It must NEVER be exposed to
 * the browser. The environment variable intentionally has no
 * NEXT_PUBLIC_ prefix, so Next.js will not bundle it for the client.
 *
 * Required .env (NOT .env.local with NEXT_PUBLIC_ prefix):
 *   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
 */

import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * Create a fresh Supabase client with the service role key.
 *
 * We use a function (not a singleton) so that each API request
 * gets its own client instance — important for serverless
 * environments where a shared global may leak state between
 * requests.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      "Missing server environment variables. "
      + "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
      + "in your .env file (without NEXT_PUBLIC_ prefix for the key)."
    )
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      // Service role client doesn't need to persist sessions
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

