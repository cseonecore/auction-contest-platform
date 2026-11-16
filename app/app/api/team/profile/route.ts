import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("id");
    const teamName = searchParams.get("name");

    if (!teamId && !teamName) {
      return NextResponse.json({ error: "Team ID or Name is required." }, { status: 400 });
    }

    const db = getServerDb();

    // 1. Fetch Team
    let teamQuery = db.from("teams").select("id, name, captain_id, locked, created_at");
    if (teamId) {
      teamQuery = teamQuery.eq("id", teamId);
    } else if (teamName) {
      teamQuery = teamQuery.ilike("name", teamName);
    }

    const { data: team, error: teamErr } = await teamQuery.maybeSingle();

    if (teamErr || !team) {
      return NextResponse.json({ error: "Team not found." }, { status: 404 });
    }

    // 2. Fetch Team Members
    const { data: members, error: memErr } = await db
      .from("members")
      .select("id, name, email, college, created_at")
      .eq("team_id", team.id)
      .order("created_at", { ascending: true });

    if (memErr) {
      console.warn("[Profile API] Error fetching members:", memErr);
    }

    // 3. Fetch Wallet
    const { data: wallet } = await db
      .from("wallets")
      .select("balance")
      .eq("team_id", team.id)
      .maybeSingle();

    // 4. Fetch Won Slots & Topics (Assigned Problems)
    const { data: wonSlots } = await db
      .from("slots")
      .select("id, round, status, current_bid, topic_id, topics(id, title, description, level, criterion)")
      .eq("winner_team_id", team.id);

    // 5. Fetch Auction Status (check if any slot is currently 'open')
    const { data: openSlots } = await db
      .from("slots")
      .select("id")
      .eq("status", "open")
      .limit(1);

    const isAuctionLive = Boolean(openSlots && openSlots.length > 0);

    // 6. Fetch Team's Latest Submission
    const { data: latestSubmission } = await db
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
