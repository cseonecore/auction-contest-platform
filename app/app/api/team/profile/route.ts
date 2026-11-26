import { NextResponse } from "next/server";
import { getDbClient } from "@/lib/supabaseServer";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let teamId = searchParams.get("id");
    const teamName = searchParams.get("name");

    // Fallback: check session cookie if query params are missing
    if (!teamId && !teamName) {
      const cookieStore = await cookies();
      const cookieTeamId = cookieStore.get("b2b_team_id")?.value;
      if (cookieTeamId) {
        teamId = cookieTeamId;
      }
    }

    // Fallback: check Bearer token if id/name and cookie are missing
    if (!teamId && !teamName) {
      const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
      if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
        const token = authHeader.substring(7).trim();
        if (token) {
          const service = getDbClient();
          const { data: authData } = await service.auth.getUser(token);
          if (authData?.user) {
            const { data: member } = await service
              .from("members")
              .select("team_id")
              .eq("id", authData.user.id)
              .maybeSingle();
            if (member?.team_id) {
              teamId = member.team_id;
            }
          }
        }
      }
    }

    if (!teamId && !teamName) {
      return NextResponse.json(
        { error: "Unauthenticated. Please log in first." },
        { status: 401 }
      );
    }

    const db = getDbClient();

    // 1. Fetch Team (by ID or Name)
    let team = null;

    if (teamId) {
      const { data, error } = await db
        .from("teams")
        .select("id, name, captain_id, locked, created_at, character_index")
        .eq("id", teamId)
        .maybeSingle();

      if (error) {
        console.error("[Profile API] Error fetching team by ID:", error);
      }
      team = data;
    }

    if (!team && teamName) {
      const cleanTeamName = teamName.trim();
      const { data, error } = await db
        .from("teams")
        .select("id, name, captain_id, locked, created_at, character_index")
        .ilike("name", cleanTeamName)
        .maybeSingle();

      if (error) {
        console.error("[Profile API] Error fetching team by name:", error);
      }
      team = data;

      // Try compact name without spaces
      if (!team) {
        const compactName = cleanTeamName.replace(/\s+/g, "");
        const { data: altTeam } = await db
          .from("teams")
          .select("id, name, captain_id, locked, created_at, character_index")
          .ilike("name", compactName)
          .maybeSingle();
        if (altTeam) team = altTeam;
      }
    }

    if (!team) {
      return NextResponse.json({ error: "Team not found." }, { status: 404 });
    }

    // Team-specific development timer state (028). get_team_dev_status()
    // computes the per-team duration (base + add-on + bonus) and applies
    // DQ statuses idempotently before returning live window/DQ fields.
    const { data: devStatusData } = await db
      .rpc("get_team_dev_status", { p_team_id: team.id })
      .single();
    // get_team_dev_status() returns the JSON object directly (PostgREST
    // scalar RPC). Keep the `.status` fallback for older wrappers.
    const devStatusRaw = (devStatusData ?? {}) as Record<string, unknown>;
    const devStatus =
      devStatusRaw.status && typeof devStatusRaw.status === "object"
        ? (devStatusRaw.status as Record<string, unknown>)
        : devStatusRaw;
    const devDeadline = devStatus.dev_deadline as string | null | undefined;
    const devRemaining = devStatus.dev_timer_remaining_seconds as number | null | undefined;
    const devTotal = devStatus.dev_timer_total_seconds as number | null | undefined;
    const devOpensAt = devStatus.submission_opens_at as string | null | undefined;

    // 2. Fetch Team Members
    const { data: members, error: memErr } = await db
      .from("members")
      .select("id, name, email, college, phone, created_at")
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

    // 4. Fetch Won Slots & Topics (Assigned Problems) with Dev Time & Bonus Data
    const [
      { data: wonSlots },
      { data: devTimeSetting },
      { data: addonSetting },
      { data: bonuses },
    ] = await Promise.all([
      db
        .from("slots")
        .select(
          "id, round, status, current_bid, question_number, topic_id, topics(id, title, description, level, criterion)"
        )
        .eq("winner_team_id", team.id)
        .eq("status", "sold"),
      db
        .from("settings")
        .select("value")
        .eq("key", "solving_timer_seconds")
        .maybeSingle(),
      // Admin-configured development time add-on (public.settings, admin-managed).
      db
        .from("settings")
        .select("value")
        .eq("key", "admin_dev_addon_seconds")
        .maybeSingle(),
      db
        .from("bonus_transactions")
        .select("slot_id, bonus_seconds")
        .eq("team_id", team.id),
    ]);

    // Base development time: 1h15m by default.
    const baseDevSeconds =
      typeof devTimeSetting?.value === "number"
        ? devTimeSetting.value
        : typeof devTimeSetting?.value === "string"
          ? parseInt(devTimeSetting.value, 10) || 4500
          : 4500;

    // Admin add-on development time (validated server-side; default 0).
    const adminAddonSeconds =
      typeof addonSetting?.value === "number"
        ? Math.max(0, addonSetting.value)
        : typeof addonSetting?.value === "string"
          ? Math.max(0, parseInt(addonSetting.value, 10) || 0)
          : 0;

    const bonusMap = new Map<string, number>();
    (bonuses || []).forEach((b: { slot_id: string; bonus_seconds: number }) => {
      if (b.slot_id) {
        bonusMap.set(b.slot_id, (bonusMap.get(b.slot_id) ?? 0) + (b.bonus_seconds ?? 0));
      }
    });

    // 5. Fetch Auction Status
    // "Live" means the participant can enter the arena right now:
    // either an auction SESSION is active (Start → Stop cycles between
    // sessions, so a restarted session is live again) or an individual
    // item is open for bidding (the host may open bidding without a
    // session). Checking only "some slot is open" left participants
    // locked out of every restarted session between Stop and Open Slot.
    const [activeSessionRes, openSlotsRes] = await Promise.all([
      db.rpc("get_active_session"),
      db.from("slots").select("id").eq("status", "open").limit(1),
    ]);

    const activeSessions = activeSessionRes.data;
    const hasActiveSession = Array.isArray(activeSessions) && activeSessions.length > 0;
    const openSlots = openSlotsRes.data;
    const hasOpenSlot = Boolean(openSlots && openSlots.length > 0);

    const isAuctionLive = hasActiveSession || hasOpenSlot;

    // 6. Fetch Team's Submissions (for all assigned problems)
    const { data: teamSubmissions } = await db
      .from("submissions")
      .select("id, slot_id, repository_url, live_url, status, submitted_at, approved_at, judge_notes")
      .eq("team_id", team.id)
      .order("submitted_at", { ascending: false });

    const submissionBySlotId = new Map(
      (teamSubmissions || []).map((s) => [s.slot_id, s])
    );
    const latestSubmissionRaw = teamSubmissions?.[0] ?? null;
    const latestSubmission = latestSubmissionRaw
      ? {
        ...latestSubmissionRaw,
        repo_url: latestSubmissionRaw.repository_url,
      }
      : null;

    // Helper to format contact phone numbers consistently
    const formatPhoneNumber = (rawPhone?: string | null): string => {
      if (!rawPhone || typeof rawPhone !== "string") return "";
      const trimmed = rawPhone.trim();
      if (!trimmed) return "";

      const digits = trimmed.replace(/\D/g, "");
      if (digits.length === 10) {
        return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
      }
      if (digits.length === 11 && digits.startsWith("0")) {
        const local = digits.slice(1);
        return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
      }
      if (digits.length === 12 && digits.startsWith("91")) {
        const local = digits.slice(2);
        return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
      }
      return trimmed.startsWith("+") ? trimmed : `+91 ${trimmed}`;
    };

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

      const isCaptain = team.captain_id ? m.id === team.captain_id : index === 0;

      let semester = "5";
      // Only the captain's phone number is collected and displayed.
      let phone = isCaptain ? formatPhoneNumber(m.phone) : "";

      if (m.college) {
        const semMatch = m.college.match(/Sem\s*(\d+)/i);
        if (semMatch) semester = semMatch[1];

        if (isCaptain && !phone) {
          const phoneMatch =
            m.college.match(/(?:Ph(?:one)?|Mob(?:ile)?|Contact):\s*([+0-9\s-]+)/i) ||
            m.college.match(/Ph:\s*([^\)]+)/i);
          if (phoneMatch) {
            phone = formatPhoneNumber(phoneMatch[1]);
          }
        }
      }

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
      current_bid?: number;
      question_number?: number | null;
      topics?: {
        title?: string;
        description?: string;
        level?: string;
      } | Array<{ title?: string; description?: string; level?: string }>;
    }

    const assignedProblems = (wonSlots || []).map((slot: SlotRecord, idx: number) => {
      const topic = Array.isArray(slot.topics) ? slot.topics[0] : slot.topics;
      const sub = submissionBySlotId.get(slot.id);
      // Admin add-on + any auction bonus time, added to the base duration.
      const addOnSeconds = adminAddonSeconds + (bonusMap.get(slot.id) ?? 0);

      return {
        id: slot.id,
        number: idx + 1,
        questionNumber: slot.question_number ?? idx + 1,
        round: slot.round ?? 1,
        title: topic?.title || `Problem ${idx + 1}`,
        statement: topic?.title || "Problem statement",
        description: topic?.description || "Description in detail",
        difficulty: topic?.level || "easy",
        winningBid: slot.current_bid ?? 0,
        baseDevSeconds,
        addOnSeconds,
        totalDevSeconds: baseDevSeconds + addOnSeconds,
        status: slot.status || "sold",
        submission: sub
          ? {
            id: sub.id,
            repository_url: sub.repository_url,
            repo_url: sub.repository_url,
            live_url: sub.live_url,
            status: sub.status,
            submitted_at: sub.submitted_at,
            approved_at: sub.approved_at,
            judge_notes: sub.judge_notes,
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
        submission: latestSubmission || null,
        characterIndex: (team as any).character_index ?? 1,
        dev_timer_status: devStatus.dev_timer_status ?? null,
        dev_timer_total_seconds: devTotal ?? null,
        dev_timer_remaining_seconds: devRemaining ?? null,
        dev_timer_started_at_ms: devStatus.dev_timer_started_at_ms ?? null,
        dev_deadline: devDeadline ?? null,
        submission_opens_at: devOpensAt ?? null,
        dq_at: devStatus.dq_at ?? null,
        dq_pending: Boolean(devStatus.dq_pending),
        dev_timer_window_open: devStatus.submission_window_open === true,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch team profile.";
    console.error("[Profile API] Exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
