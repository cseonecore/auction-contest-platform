import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://qqbuauryvhgssmmxiiuh.supabase.co";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

  return createBrowserClient(supabaseUrl, supabaseKey);
}
