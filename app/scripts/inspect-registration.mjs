import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (name) => {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  return line ? line.slice(name.length + 1).trim() : null;
};
const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(URL_BASE, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("Checking foreign keys involving members and teams...");
  const { data, error } = await supabase.rpc("validate_auction_schema");
  console.log("Schema validation:", { data, error });
  return;
  console.log("=== CHECKING AUTH USERS ===");
  const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers();
  if (usersErr) {
    console.error("Error listing users:", usersErr);
  } else {
    console.log(`Found ${usersData.users.length} auth user(s):`);
    for (const u of usersData.users) {
      console.log(`- ID: ${u.id}, Email: ${u.email}, CreatedAt: ${u.created_at}, Metadata:`, u.user_metadata);
    }
  }

  console.log("\n=== CHECKING TEAMS ===");
  const { data: teams, error: teamsErr } = await supabase.from("teams").select("*");
  if (teamsErr) {
    console.error("Error fetching teams:", teamsErr);
  } else {
    console.log(`Found ${teams.length} team(s):`, JSON.stringify(teams, null, 2));
  }

  console.log("\n=== CHECKING MEMBERS ===");
  const { data: members, error: memErr } = await supabase.from("members").select("*");
  if (memErr) {
    console.error("Error fetching members:", memErr);
  } else {
    console.log(`Found ${members.length} member(s):`, JSON.stringify(members, null, 2));
  }

  console.log("\n=== CHECKING WALLETS ===");
  const { data: wallets, error: walErr } = await supabase.from("wallets").select("*");
  if (walErr) {
    console.error("Error fetching wallets:", walErr);
  } else {
    console.log(`Found ${wallets.length} wallet(s):`, JSON.stringify(wallets, null, 2));
  }

  console.log("\n=== CHECKING SETTINGS ===");
  const { data: settings, error: setErr } = await supabase.from("settings").select("*");
  if (setErr) {
    console.error("Error fetching settings:", setErr);
  } else {
    console.log(`Settings:`, JSON.stringify(settings, null, 2));
  }

  console.log("\n=== CHECKING ALL AUDIT LOGS FOR 4MT24CS032 OR RECENT DELETIONS ===");
  const { data: allAudit, error: aErr } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false });
  if (aErr) {
    console.error("Error fetching all audit:", aErr);
  } else {
    console.log(`Total audit records: ${allAudit.length}`);
    const relevant = allAudit.filter(a => JSON.stringify(a).includes("4mt24cs032") || JSON.stringify(a).includes("4MT24CS032") || JSON.stringify(a).includes("Admin") || a.action === "team_deleted");
    console.log("Relevant audit records:", JSON.stringify(relevant, null, 2));
  }
}

main().catch(console.error);
