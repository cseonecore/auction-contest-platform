import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client configuration.
 * Uses safe fallbacks so Next.js static page prerendering and Vercel build
 * workers do not fail with "Error: supabaseUrl is required" if environment
 * variables are not yet loaded.
 */
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://qqbuauryvhgssmmxiiuh.supabase.co";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

export const supabase = createClient(supabaseUrl, supabaseKey);
export type SupabaseClient = typeof supabase;

