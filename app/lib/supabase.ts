import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * Supabase browser client with strong typing from Database schema.
 *
 * Uses the publishable (anon) key — safe to expose in the browser.
 * RLS policies (migrations 003 & 004) enforce authorization based on auth.uid() / JWT.
 */
export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

export type SupabaseClient = typeof supabase
