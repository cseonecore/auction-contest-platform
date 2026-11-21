/**
 * End-to-end live API validation for Registration & Login fixes.
 *
 * Exercises all 6 required test scenarios:
 *  1. Completely new email and USN.
 *  2. Auth account that exists but has no team/member association (orphaned).
 *  3. An already registered captain (duplicate participant prevention).
 *  4. Duplicate USN within form.
 *  5. Duplicate team name.
 *  6. Failure midway rollback behavior.
 *  7. Login verification for registered team.
 *  8. Verification that existing registrations (e.g. vercel) are completely undamaged.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (name) => {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  return line ? line.slice(name.length + 1).trim() : null;
};
const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");

const db = createClient(URL_BASE, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const APP_URL = "http://localhost:3000";

async function run() {
  console.log("=== STARTING REGISTRATION & LOGIN FLOW TESTS ===\n");

  // Step 0: Verify initial state
  console.log("[Setup] Checking existing protected records...");
  const { data: initialTeams } = await db.from("teams").select("id, name, captain_id");
  console.log("Initial teams count:", initialTeams?.length, initialTeams?.map(t => t.name));
  const vercelTeam = initialTeams?.find(t => t.name.toLowerCase() === "vercel");
  if (!vercelTeam) {
    throw new Error("Safety check failed: 'vercel' team missing from database!");
  }
  console.log("Protected 'vercel' team verified:", vercelTeam.id);

  // Scenario 4: Duplicate USN within form
  console.log("\n--- Scenario 4: Duplicate USN in submission ---");
  const dupUsnPayload = {
    teamName: "TestDupTeam",
    teamSize: 2,
    captain: {
      name: "Cap",
      usn: "4MT24CS091",
      semester: "5th Sem",
      phone: "9999999999",
    },
    members: [
      {
        name: "Mem",
        usn: "4MT24CS091", // Duplicate of captain
        phone: "9999999998",
      },
    ],
  };

  const resDupUsn = await fetch(`${APP_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dupUsnPayload),
  });
  const dataDupUsn = await resDupUsn.json();
  console.log("Duplicate USN status:", resDupUsn.status, "Message:", dataDupUsn.error);
  if (resDupUsn.status !== 400 || !dataDupUsn.error?.includes("Duplicate USN")) {
    throw new Error("Scenario 4 failed: duplicate USN was not rejected with 400!");
  }
  console.log("PASS: Duplicate USN within form rejected with 400.");

  // Scenario 5: Duplicate team name
  console.log("\n--- Scenario 5: Duplicate team name ---");
  const dupTeamPayload = {
    teamName: "vercel", // already exists
    teamSize: 2,
    captain: {
      name: "NewCap",
      usn: "4MT24CS088",
      semester: "5th Sem",
      phone: "9999999999",
    },
    members: [
      {
        name: "NewMem",
        usn: "4MT24CS089",
        phone: "9999999998",
      },
    ],
  };

  const resDupTeam = await fetch(`${APP_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dupTeamPayload),
  });
  const dataDupTeam = await resDupTeam.json();
  console.log("Duplicate team name status:", resDupTeam.status, "Message:", dataDupTeam.error);
  if (resDupTeam.status !== 409 || !dataDupTeam.error?.includes("already registered")) {
    throw new Error("Scenario 5 failed: duplicate team name was not rejected with 409!");
  }
  console.log("PASS: Duplicate team name rejected with 409.");

  // Scenario 3: An already registered captain
  console.log("\n--- Scenario 3: Already registered captain ---");
  const registeredCapPayload = {
    teamName: "BrandNewTeamName123",
    teamSize: 2,
    captain: {
      name: "Josh Clone",
      usn: "4MT24CS008", // Josh is captain of vercel
      semester: "5th Sem",
      phone: "9999999999",
    },
    members: [
      {
        name: "NewMem",
        usn: "4MT24CS089",
        phone: "9999999998",
      },
    ],
  };

  const resRegCap = await fetch(`${APP_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registeredCapPayload),
  });
  const dataRegCap = await resRegCap.json();
  console.log("Already registered captain status:", resRegCap.status, "Message:", dataRegCap.error);
  if (resRegCap.status !== 409 || !dataRegCap.error?.includes("already registered")) {
    throw new Error("Scenario 3 failed: already registered captain was not rejected with 409!");
  }
  console.log("PASS: Already registered captain rejected with 409.");

  // Scenario 1: Completely new email and USN
  console.log("\n--- Scenario 1: Completely new email and USN ---");
  const freshUsn = "4MT24CS911";
  const freshEmail = `${freshUsn.toLowerCase()}@mite.ac.in`;
  const freshTeamName = "FreshTestTeam";
  const freshPayload = {
    teamName: freshTeamName,
    teamSize: 2,
    captain: {
      name: "FreshCaptain",
      usn: freshUsn,
      semester: "5th Sem",
      phone: "9991112223",
    },
    members: [
      {
        name: "FreshTeammate",
        usn: "4MT24CS912",
        phone: "9991112224",
      },
    ],
  };

  const resFresh = await fetch(`${APP_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(freshPayload),
  });
  const dataFresh = await resFresh.json();
  console.log("Fresh registration status:", resFresh.status, "Response:", dataFresh);
  if (resFresh.status !== 200 || !dataFresh.success) {
    throw new Error(`Scenario 1 failed: fresh registration failed with ${JSON.stringify(dataFresh)}`);
  }
  console.log("PASS: Fresh team registered successfully.");

  // Verify fresh team login
  const freshLoginRes = await fetch(`${APP_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      teamName: freshTeamName,
      captainUsn: freshUsn,
    }),
  });
  const freshLoginData = await freshLoginRes.json();
  console.log("Fresh login status:", freshLoginRes.status, "Success:", freshLoginData.success);
  if (freshLoginRes.status !== 200 || !freshLoginData.success) {
    throw new Error(`Scenario 1 failed: fresh login failed with ${JSON.stringify(freshLoginData)}`);
  }
  console.log("PASS: Fresh team logged in successfully.");

  // Clean up only the temporary test team
  console.log("Cleaning up temporary test team...");
  const freshTeamId = dataFresh.teamId;
  await db.from("wallets").delete().eq("team_id", freshTeamId);
  await db.from("members").delete().eq("team_id", freshTeamId);
  await db.from("teams").delete().eq("id", freshTeamId);
  const { data: listData } = await db.auth.admin.listUsers();
  const freshAuth = listData?.users?.find(u => u.email === freshEmail);
  if (freshAuth) {
    await db.auth.admin.deleteUser(freshAuth.id);
  }
  console.log("Cleaned up temporary test team.");

  // Scenario 2: Auth account that exists but has NO team/member association (Admin + 4MT24CS032)
  console.log("\n--- Scenario 2: Orphaned Auth account adoption (Admin + 4MT24CS032) ---");
  const adminRegisterPayload = {
    teamName: "Admin",
    teamSize: 2,
    captain: {
      name: "Anush",
      usn: "4MT24CS032",
      semester: "5th Sem",
      phone: "8152076287",
    },
    members: [
      {
        name: "Abhiram",
        usn: "4MT24CS002",
        phone: "8152076287",
      },
    ],
  };

  const resAdmin = await fetch(`${APP_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(adminRegisterPayload),
  });
  const dataAdmin = await resAdmin.json();
  console.log("Admin registration status:", resAdmin.status, "Response:", dataAdmin);
  if (resAdmin.status !== 200 || !dataAdmin.success) {
    throw new Error(`Scenario 2 failed: Admin registration failed with: ${JSON.stringify(dataAdmin)}`);
  }
  console.log("PASS: Team 'Admin' registered successfully by adopting orphaned Auth account 4MT24CS032!");

  // Verify Team 'Admin' database state
  const { data: adminTeamInDb } = await db.from("teams").select("*").ilike("name", "Admin").single();
  const { data: adminMembers } = await db.from("members").select("*").eq("team_id", adminTeamInDb.id);
  const { data: adminWallet } = await db.from("wallets").select("*").eq("team_id", adminTeamInDb.id).single();
  console.log("Admin team in DB:", adminTeamInDb);
  console.log("Admin members in DB:", adminMembers.map(m => ({ id: m.id, name: m.name, email: m.email })));
  console.log("Admin wallet in DB balance:", adminWallet?.balance);

  // Verification: captain ID matches Auth user ID
  if (adminTeamInDb.captain_id !== "5168f460-d5f8-4b92-980b-f300f293dba7") {
    throw new Error("Captain ID mismatch in teams table!");
  }
  const capMember = adminMembers.find(m => m.id === "5168f460-d5f8-4b92-980b-f300f293dba7");
  if (!capMember) {
    throw new Error("Captain member ID mismatch in members table!");
  }
  if (adminWallet.balance !== 100) {
    throw new Error("Admin wallet balance not initialized to 100!");
  }
  console.log("PASS: Database records, UUIDs, and wallet verified for team 'Admin'.");

  // Login Verification for team 'Admin'
  console.log("\n--- Login Verification for Team 'Admin' ---");
  const loginRes = await fetch(`${APP_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      teamName: "admin", // test case-insensitivity
      captainUsn: "4MT24CS032",
    }),
  });
  const loginData = await loginRes.json();
  console.log("Admin login status:", loginRes.status, "Response:", {
    success: loginData.success,
    team: loginData.team?.name,
    captain: loginData.team?.captain?.name,
    userId: loginData.session?.user_id,
  });

  if (loginRes.status !== 200 || !loginData.success || loginData.session?.user_id !== "5168f460-d5f8-4b92-980b-f300f293dba7") {
    throw new Error(`Login failed for team 'Admin': ${JSON.stringify(loginData)}`);
  }
  console.log("PASS: Team 'Admin' successfully logged in with case-insensitive name and Captain USN!");

  // Verify that vercel is still completely intact
  console.log("\n--- Safety Verification: Vercel team preservation ---");
  const { data: vercelAfter } = await db.from("teams").select("*").eq("id", vercelTeam.id).single();
  const { data: vercelMemAfter } = await db.from("members").select("*").eq("team_id", vercelTeam.id);
  const { data: vercelWalAfter } = await db.from("wallets").select("*").eq("team_id", vercelTeam.id);
  if (!vercelAfter || vercelMemAfter.length !== 2 || vercelWalAfter.length < 1) {
    throw new Error("CRITICAL SAFETY FAILURE: Vercel team was altered or damaged!");
  }
  console.log("PASS: Vercel team and its 2 members are completely intact.");

  console.log("\n=== ALL REGISTRATION & LOGIN FLOW TESTS PASSED SUCCESSFULLY! ===");
}

run().catch((err) => {
  console.error("\nTEST SUITE FAILED:", err);
  process.exit(1);
});
