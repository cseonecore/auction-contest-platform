import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("id");
    const teamName = searchParams.get("name");

    if (!teamId && !teamName) {
      return NextResponse.json({ error: "Team ID or Name is required." }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qqbuauryvhgssmmxiiuh.supabase.co";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookiesStore.set(name, value, options as any)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
          }
        },
      },
    });

    // Get the authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
    }

    const authUserId = user.id;
    const authEmail = user.email || "";

    // Use the RLS-safe function to find the user's team
    // current_team_id() resolves the team from members table where id = auth.uid()
    let team;

    if (teamId) {
      // Fetch specific team by ID, with RLS check
      const { data: teamData, error: teamErr } = await supabase
        .from("teams")
        .select("id, name, captain_id, locked, created_at")
        .eq("id", teamId)
        .single();

      if (teamErr || !teamData) {
        return NextResponse.json({ error: "Team not found." }, { status: 404 });
      }

      team = teamData;

      // Verify the authenticated user is associated with this team
      const { data: memberCheck } = await supabase
        .from("members")
        .select("id, team_id")
        .eq("team_id", team.id)
        .eq("id", authUserId)
        .maybeSingle();

      if (!memberCheck) {
        return NextResponse.json(
          { error: "You are not authorized to view this team's profile." },
          { status: 403 }
        );
      }
    } else {
      // Fetch team by name - use RLS to find user's team
      const { data: teamData, error: teamErr } = await supabase
        .from("teams")
        .select("id, name, captain_id, locked, created_at")
        .ilike("name", teamName)
        .maybeSingle();

      if (teamErr || !teamData) {
        return NextResponse.json({ error: "Team not found." }, { status: 404 });
      }

      team = teamData;

      // Verify the authenticated user is associated with this team
      const { data: memberCheck } = await supabase
        .from("members")
        .select("id, team_id")
        .eq("team_id", team.id)
        .eq("id", authUserId)
        .maybeSingle();

      if (!memberCheck) {
        return NextResponse.json(
          { error: "You are not authorized to view this team's profile." },
          { status: 403 }
        );
      }
    }

    // 2. Fetch Team Members
    const { data: members, error: memErr } = await supabase
      .from("members")
      .select("id, name, email, college, created_at")
      .eq("team_id", team.id)
      .order("created_at", { ascending: true });

    if (memErr) {
      console.warn("[Profile API] Error fetching members:", memErr);
    }

    // 3. Fetch Wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance")
      .eq("team_id", team.id)
      .maybeSingle();

    // 4. Fetch Won Slots & Topics (Assigned Problems)
    const { data: wonSlots } = await supabase
      .from("slots")
      .select(
        "id, round, status, current_bid, topic_id, topics(id, title, description, level, criterion)"
      )
      .eq("winner_team_id", team.id);

    const isAuctionLive = Boolean(wonSlots && wonSlots.length > 0);

    // 5. Fetch Auction Status (check if any slot is currently 'open')
    const { data: openSlots } = await supabase
      .from("slots")
      .select("id")
      .eq("status", "open")
      .limit(1);

    const isAuctionLive2 = Boolean(openSlots && openSlots.length > 0);

    // 6. Fetch Team's Latest Submission
    const { data: latestSubmission } = await supabase
      .from("submissions")
      .select("id, repository_url, status, submitted_at")
      .eq("team_id", team.id)
      .order("submitted_at", { ascending: false })
      .maybeSingle();

    // 7. Format members with USN, Branch, Semester, Phone
    const formattedMembers = (members || []).map((m, index) => {
      const email = m.email || "";
      const usnMatch = email.match(/^([^@]+)@/);
      const usn = usnMatch ? usnMatch[1].toUpperCase() : `4MT24CS00${index + 1}`;

      let branch = "CSE";
      if (usn.includes("CS")) branch = "CSE";
      else if (usn.includes("IS")) branch = "ISE";
      else if (usn.includes("EC")) branch = "ECE";
      else if (usn.includes("AI")) branch = "AIML";

      let semester = "5";
      let phone = "+91 12345 67890";

      if (m.college) {
        const semMatch = m.college.match(/Sem\s*(\d+)/i);
        if (semMatch) semester = semMatch[1];

        const phoneMatch = m.college.match(/Ph:\s*([^\)]+)/i);
        if (phoneMatch) phone = `+91 ${phoneMatch[1].trim()}`;
      }

      const isCaptain = team.captain_id ? m.id === team.captain_id : index === 0;

      return {
        id: m.id,
        name: m.name,
        email: m.email,
        usn,
        branch,
        semester,
        phone,
        isCaptain,
      };
    });

    interface SlotRecord {
      id: string;
      round: number;
      status: string;
      topics?: {
        title?: string;
        description?: string;
      } | Array<{ title?: string; description?: string }>;
    }

    const assignedProblems = (wonSlots || []).map((slot: SlotRecord, idx: number) => {
      const topic = Array.isArray(slot.topics) ? slot.topics[0] : slot.topics;
      return {
        id: slot.id,
        number: idx + 1,
        title: topic?.title || `Problem ${idx + 1}`,
        statement: topic?.title || "Problem statement",
        description: topic?.description || "Description in detail",
      };
    });

    return NextResponse.json({
      success: true,
      team: {
        id: team.id,
        name: team.name,
        locked: team.locked,
        balance: wallet?.balance ?? 100,
        members: formattedMembers,
        assignedProblems,
        isAuctionLive,
        submission: latestSubmission || null,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch team profile.";
    console.error("[Profile API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}