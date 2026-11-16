import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Team profile.
 *
 * Reads the team, its members, its wallet, the questions it has won
 * and its submissions. The caller's session decides what is visible:
 * a member sees their own team, an administrator sees any team.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("id");
    const teamName = searchParams.get("name");

    if (!teamId && !teamName) {
      return NextResponse.json({ error: "Team ID or Name is required." }, { status: 400 });
    }

    // Session-bound client: the publishable key plus the session cookie,
    // so every read is evaluated by Row Level Security.
    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
    }

    const authUserId = user.id;
    const isAdmin = user.app_metadata?.role === "admin";

    // 1. Resolve the team the caller is allowed to read.
    let team;

    if (teamId) {
      const { data: teamData, error: teamErr } = await supabase
        .from("teams")
        .select("id, name, captain_id, locked, created_at")
        .eq("id", teamId)
        .maybeSingle();

      if (teamErr || !teamData) {
        return NextResponse.json({ error: "Team not found." }, { status: 404 });
      }
      team = teamData;
    } else {
      const { data: teamData, error: teamErr } = await supabase
        .from("teams")
        .select("id, name, captain_id, locked, created_at")
        .ilike("name", teamName || "")
        .maybeSingle();

      if (teamErr || !teamData) {
        return NextResponse.json({ error: "Team not found." }, { status: 404 });
      }
      team = teamData;
    }

    // 2. Verify the authenticated user belongs to this team.
    const { data: memberCheck } = await supabase
      .from("members")
      .select("id, team_id")
      .eq("team_id", team.id)
      .eq("id", authUserId)
      .maybeSingle();

    if (!memberCheck && !isAdmin) {
      return NextResponse.json(
        { error: "You are not authorized to view this team's profile." },
        { status: 403 }
      );
    }

    // 3. Fetch team members
    const { data: members, error: memErr } = await supabase
      .from("members")
      .select("id, name, email, college, created_at")
      .eq("team_id", team.id)
      .order("created_at", { ascending: true });

    if (memErr) {
      console.warn("[Profile API] Error fetching members:", memErr);
    }

    // 4. Fetch wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance")
      .eq("team_id", team.id)
      .maybeSingle();

    // 5. Won auction items = the assigned questions
    const { data: wonSlots } = await supabase
      .from("slots")
      .select(
        "id, round, status, current_bid, topic_id, sold_at, topics(id, title, description, level, criterion)"
      )
      .eq("winner_team_id", team.id)
      .eq("status", "sold")
      .order("round", { ascending: true });

    // 6. Auction liveness
    const { data: openSlots } = await supabase
      .from("slots")
      .select("id")
      .eq("status", "open")
      .limit(1);

    const isAuctionLive = Boolean(openSlots && openSlots.length > 0);

    // 7. The team's submissions
    const { data: teamSubmissions } = await supabase
      .from("submissions")
      .select("id, slot_id, repository_url, live_url, status, submitted_at, approved_at")
      .eq("team_id", team.id)
      .order("submitted_at", { ascending: false });

    const latestSubmission = teamSubmissions?.[0] ?? null;

    // 8. Format members with USN, branch, semester, phone
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
      current_bid: number;
      sold_at?: string | null;
      topics?: {
        title?: string;
        description?: string;
      } | Array<{ title?: string; description?: string }>;
    }

    const assignedProblems = (wonSlots || []).map((slot: SlotRecord, idx: number) => {
      const topic = Array.isArray(slot.topics) ? slot.topics[0] : slot.topics;
      const submission = teamSubmissions?.find((s) => s.slot_id === slot.id) ?? null;
      return {
        id: slot.id,
        number: idx + 1,
        round: slot.round,
        title: topic?.title || `Problem ${idx + 1}`,
        statement: topic?.title || "Problem statement",
        description: topic?.description || "Description in detail",
        winningBid: slot.current_bid,
        soldAt: slot.sold_at ?? null,
        submission: submission
          ? {
              id: submission.id,
              repository_url: submission.repository_url,
              live_url: submission.live_url,
              status: submission.status,
              submitted_at: submission.submitted_at,
              approved_at: submission.approved_at,
            }
          : null,
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
        submission: latestSubmission,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch team profile.";
    console.error("[Profile API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
