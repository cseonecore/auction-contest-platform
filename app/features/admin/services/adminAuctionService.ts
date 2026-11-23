"use client";

import type { AuctionTimerStatus } from "@/types/auction";

/**
 * Admin auction service.
 *
 * Every administrative action is a call to a SECURITY DEFINER engine
 * function that performs its own authorisation check inside
 * PostgreSQL. There is deliberately no direct table write anywhere in
 * this file — the admin UI can never set the auction status or move
 * a wallet by itself.
 */

import { supabase } from "@/lib/supabase";
import type {
  ServiceResult,
  OpenSlotResult,
  BiddingResultTeam,
  BiddingResultProblem,
  BiddingResultMember,
} from "@/features/admin/types/auctionAdmin";

import { openSlot as adminOpenSlot } from "@/features/admin/services/auctionAdminService";

export interface AdminActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function toMessage(error: { message?: string } | null): string {
  if (!error) return "Unknown error";
  return (error.message || "Unknown error").trim();
}

async function call<T>(
  fn: string,
  args: Record<string, unknown> = {}
): Promise<AdminActionResult<T>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)(fn, args);

    if (error) {
      return { success: false, error: toMessage(error) };
    }

    return { success: true, data: data as T };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "The action could not be completed",
    };
  }
}

// ── Session lifecycle ────────────────────────────────────────────
export const startAuction = (round: 1 | 2 | 3 = 1) =>
  call("start_auction", { p_round: round });

export const setAuctionRound = async (
  round: 1 | 2 | 3
): Promise<AdminActionResult> => {
  // 1. Primary path: dedicated set_auction_round RPC (migration 023+)
  const res = await call("set_auction_round", { p_round: round });
  if (res.success) return res;

  // 2. Check if the error is due to set_auction_round missing in Supabase schema cache
  const isMissingRpc =
    res.error &&
    (res.error.includes("set_auction_round") ||
      res.error.includes("schema cache") ||
      res.error.includes("PGRST202"));

  if (isMissingRpc) {
    // 3. Fallback: try start_auction(p_round). In migration 023 start_auction also switches round,
    // and if no session is active yet, it starts a session in the chosen round.
    const startRes = await call("start_auction", { p_round: round });
    if (startRes.success) {
      const data = startRes.data as
        | { already_started?: boolean; round?: number }
        | undefined;
      // If session was freshly started or round actually matches target
      if (!data?.already_started || data?.round === round) {
        return startRes;
      }
    }

    return {
      success: false,
      error:
        "Database function 'public.set_auction_round' is not installed in Supabase. Please apply migration 023 (or docs/production-deploy-021-023.sql) in your Supabase SQL Editor.",
    };
  }

  return res;
};

export const finalizeRound3Eliminations = async (): Promise<AdminActionResult> => {
  const res = await call("finalize_round_3_eliminations");
  if (
    !res.success &&
    res.error &&
    (res.error.includes("finalize_round_3_eliminations") ||
      res.error.includes("schema cache") ||
      res.error.includes("PGRST202"))
  ) {
    return {
      success: false,
      error:
        "Database function 'public.finalize_round_3_eliminations' is not installed in Supabase. Please apply migration 023 (or docs/production-deploy-021-023.sql) in your Supabase SQL Editor.",
    };
  }
  return res;
};

export const selectAuctionQuestion = (slotId: string) =>
  call("select_auction_question", { p_slot_id: slotId });

export const openBidding = (slotId?: string | null) =>
  call("open_bidding", { p_slot_id: slotId ?? null });

export const closeBidding = (slotId?: string | null) =>
  call("close_bidding", { p_slot_id: slotId ?? null });

export const finalizeAuction = (slotId?: string | null) =>
  call("finalize_auction", { p_slot_id: slotId ?? null });

export const advanceAuction = () => call("advance_auction");

export const skipSlot = (slotId: string) =>
  call("skip_slot", { p_slot_id: slotId });

export const pauseAuction = () => call("pause_auction");

export const resumeAuction = () => call("resume_auction");

export const endAuctionSession = () => call("end_auction_session");

export const resetAuction = () => call("reset_auction");

// ── Timers ───────────────────────────────────────────────────────
export const startAuctionTimer = (seconds?: number) =>
  call("start_auction_timer", { p_seconds: seconds ?? null });

export const pauseAuctionTimer = () => call("pause_auction_timer");

export const resumeAuctionTimer = () => call("resume_auction_timer");

/** Extends the bidding clock of the live auction item. */
export const adjustBiddingTimer = (seconds: number, slotId?: string | null, reason?: string) =>
  call("adjust_bidding_timer", {
    p_seconds: Math.floor(seconds),
    p_slot_id: slotId ?? null,
    p_reason: reason ?? "admin",
  });

/** Extends the solving clock that bonus time also extends. */
export const adjustSolvingTimer = (seconds: number, reason?: string) =>
  call("adjust_auction_timer", {
    p_seconds: Math.floor(seconds),
    p_reason: reason ?? "admin",
  });

// ── Teams ────────────────────────────────────────────────────────
export const eliminateTeam = (teamId: string, reason: string, rule = "manual") =>
  call("eliminate_team", {
    p_team_id: teamId,
    p_reason: reason,
    p_rule: rule,
  });

export const restoreTeam = (teamId: string, note?: string) =>
  call("restore_team", { p_team_id: teamId, p_note: note ?? null });

export const fetchEliminationHistory = () => call("get_elimination_history");

// ── Judging & bonus ──────────────────────────────────────────────
export const approveSubmission = (
  submissionId: string,
  score: number,
  notes?: string,
  grantBonus = false
) =>
  call("approve_submission", {
    p_submission_id: submissionId,
    p_score: score,
    p_notes: notes ?? null,
    p_grant_bonus: grantBonus,
  });

export const grantBonusTime = (submissionId: string, reason?: string) =>
  call("grant_bonus_time", {
    p_submission_id: submissionId,
    p_reason: reason ?? null,
  });

export const rejectSubmission = async (
  submissionId: string,
  reason?: string
): Promise<AdminActionResult<{ success: boolean }>> => {
  // 1. Direct RPC
  const rpcRes = await call<{ success: boolean }>("reject_submission", {
    p_submission_id: submissionId,
    p_reason: reason ?? "Rejected by judges",
  });
  if (rpcRes.success) return rpcRes;

  // 2. Server route
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch("/api/auction/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        action: "reject_solution",
        submissionId,
        reason,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, data };
    }
  } catch {}

  // 3. Client direct database update fallback
  try {
    const { error: dbError } = await supabase
      .from("submissions")
      .update({
        status: "rejected",
        judge_notes: reason ?? null,
      })
      .eq("id", submissionId);
    if (!dbError) {
      return { success: true, data: { success: true } };
    }
  } catch {}

  return { success: false, error: rpcRes.error || "Failed to reject submission" };
};

export const reopenSubmission = async (
  submissionId: string,
  notes?: string
): Promise<AdminActionResult<{ success: boolean }>> => {
  // 1. Direct RPC
  const rpcRes = await call<{ success: boolean }>("reopen_submission", {
    p_submission_id: submissionId,
    p_notes: notes ?? "Reopened for revisions",
  });
  if (rpcRes.success) return rpcRes;

  // 2. Server route
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch("/api/auction/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        action: "reopen_solution",
        submissionId,
        notes,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, data };
    }
  } catch {}

  // 3. Client direct database update fallback
  try {
    const { error: dbError } = await supabase
      .from("submissions")
      .update({
        status: "submitted",
        judge_notes: notes ?? null,
      })
      .eq("id", submissionId);
    if (!dbError) {
      return { success: true, data: { success: true } };
    }
  } catch {}

  return { success: false, error: rpcRes.error || "Failed to reopen submission" };
};

export interface AdminSubmissionsResult {
  success: boolean;
  submissions: unknown[];
  error?: string;
}

export const fetchAdminSubmissionsFallback = async (): Promise<AdminSubmissionsResult> => {
  try {
    const [subsRes, evalsRes, bonusesRes] = await Promise.all([
      supabase
        .from("submissions")
        .select(`
          id,
          team_id,
          slot_id,
          repository_url,
          live_url,
          status,
          submitted_at,
          approved_at,
          approved_by,
          judge_notes,
          team:teams(id, name),
          slot:slots(id, round, topic:topics(id, title, description, level))
        `)
        .order("submitted_at", { ascending: false }),
      supabase.from("evaluations").select("submission_id, score, report, status"),
      supabase.from("bonus_transactions").select("submission_id, bonus_seconds, created_at"),
    ]);

    if (subsRes.error) {
      return { success: false, error: subsRes.error.message, submissions: [] };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evalMap = new Map((evalsRes.data || []).map((e: any) => [e.submission_id, e]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bonusMap = new Map((bonusesRes.data || []).map((b: any) => [b.submission_id, b]));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const submissions = (subsRes.data || []).map((sub: any) => {
      const ev = evalMap.get(sub.id);
      const bo = bonusMap.get(sub.id);
      const teamRel = sub.team as { id: string; name: string } | null;
      const slotRel = sub.slot as {
        id: string;
        round: number;
        topic?: { id: string; title: string; description: string; level: string };
      } | null;

      return {
        id: sub.id,
        team_id: sub.team_id,
        team_name: teamRel?.name ?? "Unknown Team",
        slot_id: sub.slot_id,
        round: slotRel?.round ?? 1,
        topic_title: slotRel?.topic?.title ?? "Problem Statement",
        topic_description: slotRel?.topic?.description ?? "",
        repository_url: sub.repository_url,
        live_url: sub.live_url,
        status: sub.status,
        submitted_at: sub.submitted_at,
        approved_at: sub.approved_at,
        approved_by: sub.approved_by,
        judge_notes: sub.judge_notes,
        evaluation: ev
          ? {
              score: ev.score,
              report: ev.report,
              status: ev.status,
            }
          : null,
        bonus: bo
          ? {
              bonus_seconds: bo.bonus_seconds,
              created_at: bo.created_at,
            }
          : null,
      };
    });

    return { success: true, submissions };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load submissions";
    return { success: false, error: msg, submissions: [] };
  }
};

export const fetchAdminSubmissions = async (): Promise<AdminSubmissionsResult> => {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch("/api/submission?all=true", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.submissions)) {
        return { success: true, submissions: data.submissions };
      }
    }
  } catch {
    // API route unreachable, try direct query fallback below
  }

  return fetchAdminSubmissionsFallback();
};

export const fetchBonusHistory = async (): Promise<AdminActionResult<unknown>> => {
  const res = await call("get_bonus_history");
  if (res.success) return res;

  // Fallback: direct database query
  try {
    const { data, error } = await supabase
      .from("bonus_transactions")
      .select(`
        id,
        team_id,
        slot_id,
        topic_id,
        submission_id,
        approved_by,
        bonus_seconds,
        reason,
        created_at,
        team:teams(name)
      `)
      .order("created_at", { ascending: false });

    if (!error && data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formatted = data.map((b: any) => ({
        id: b.id,
        team_id: b.team_id,
        team_name: b.team?.name || "Unknown Team",
        slot_id: b.slot_id,
        topic_id: b.topic_id,
        submission_id: b.submission_id,
        approved_by: b.approved_by,
        bonus_seconds: b.bonus_seconds,
        reason: b.reason,
        created_at: b.created_at,
      }));
      return { success: true, data: formatted };
    }
  } catch {}

  return res;
};

// ── Topics ───────────────────────────────────────────────────────
export const createAuctionTopic = (values: {
  title: string;
  description?: string;
  level: "easy" | "hard";
  startingBid?: number;
  criterion?: unknown;
}) =>
  call("create_auction_topic", {
    p_title: values.title,
    p_description: values.description ?? null,
    p_level: values.level,
    p_starting_bid: values.startingBid ?? null,
    p_criterion: (values.criterion ?? null) as never,
    p_slots_count: 1,
  });

/** Admin open-slot wrapper calling RPC `open_slot(p_slot_id, p_starting_bid)`. */
export const openSlot = async (
  slotId: string,
  startingBid: number = 10
): Promise<ServiceResult<OpenSlotResult>> => adminOpenSlot(slotId, startingBid);

/** Consolidated authoritative bidding results across all teams. */
export const fetchBiddingResults = async (): Promise<
  AdminActionResult<BiddingResultTeam[]>
> => {
  // 1. Primary path: try PostgreSQL RPC get_bidding_results
  const res = await call<
    BiddingResultTeam[] | { teams?: BiddingResultTeam[]; base_dev_seconds?: number }
  >("get_bidding_results");

  if (res.success && res.data) {
    const rawData = res.data;
    const teamsList = Array.isArray(rawData)
      ? rawData
      : Array.isArray((rawData as { teams?: BiddingResultTeam[] }).teams)
      ? (rawData as { teams: BiddingResultTeam[] }).teams
      : null;

    if (teamsList) {
      return { success: true, data: teamsList };
    }
  }

  // 2. If get_bidding_results is missing in schema cache, fall back to direct table queries
  const isMissingRpc =
    res.error &&
    (res.error.includes("get_bidding_results") ||
      res.error.includes("schema cache") ||
      res.error.includes("PGRST202"));

  if (isMissingRpc) {
    try {
      const fallbackData = await fetchBiddingResultsFallback();
      return { success: true, data: fallbackData };
    } catch (err: unknown) {
      console.warn("fetchBiddingResults fallback query failed:", err);
      return {
        success: false,
        error:
          "Database function 'public.get_bidding_results' is missing in Supabase. Please apply migration 021/023 (docs/production-deploy-021-023.sql) in your Supabase SQL Editor.",
      };
    }
  }

  return {
    success: res.success,
    error: res.error,
    data: [],
  };
};

/** Fallback builder that aggregates bidding results directly from database tables if RPC is missing. */
async function fetchBiddingResultsFallback(): Promise<BiddingResultTeam[]> {
  // 1. Fetch solving timer setting and the admin-managed add-on (both in
  //    public.settings, authoritative via get_admin_dev_time_config as well).
  let baseDevSeconds = 4500; // 1h15m base development time
  let addonDevSeconds = 0;
  try {
    const [settingRes, addonRes] = await Promise.all([
      supabase
        .from("settings")
        .select("value")
        .eq("key", "solving_timer_seconds")
        .maybeSingle(),
      supabase
        .from("settings")
        .select("value")
        .eq("key", "admin_dev_addon_seconds")
        .maybeSingle(),
    ]);

    if (settingRes.data?.value != null) {
      const val = Number(settingRes.data.value);
      if (!isNaN(val) && val > 0) baseDevSeconds = val;
    }
    if (addonRes.data?.value != null) {
      const val = Number(addonRes.data.value);
      if (!isNaN(val) && val >= 0) addonDevSeconds = val;
    }
  } catch {
    // Keep defaults (4500 + 0)
  }
  const totalDevSeconds = baseDevSeconds + addonDevSeconds;

  // 2. Fetch teams, members, wallets, topics, sold slots, bonus_transactions, eliminations in parallel
  const [
    teamsRes,
    membersRes,
    walletsRes,
    topicsRes,
    slotsRes,
    bonusesRes,
    elimsRes,
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, captain_id, created_at")
      .order("name", { ascending: true }),
    supabase
      .from("members")
      .select("id, team_id, name, email, created_at")
      .order("created_at", { ascending: true }),
    supabase.from("wallets").select("team_id, balance"),
    supabase.from("topics").select("id, title, level"),
    supabase
      .from("slots")
      .select("id, question_number, round, current_bid, status, sold_at, winner_team_id, topic_id")
      .eq("status", "sold"),
    supabase.from("bonus_transactions").select("slot_id, team_id, bonus_seconds"),
    supabase
      .from("team_eliminations")
      .select("team_id, reason, restored_at, eliminated_at")
      .is("restored_at", null),
  ]);

  if (teamsRes.error) {
    throw new Error(teamsRes.error.message || "Failed to load teams");
  }

  const teams = teamsRes.data || [];
  const members = membersRes.data || [];
  const wallets = walletsRes.data || [];
  const topics = topicsRes.data || [];
  const soldSlots = slotsRes.data || [];
  const bonuses = bonusesRes.data || [];
  const elims = elimsRes.data || [];

  // Index maps
  const topicsMap = new Map<string, { title: string; level: string }>();
  topics.forEach((tp) => topicsMap.set(tp.id, { title: tp.title, level: tp.level }));

  const membersByTeam = new Map<string, typeof members>();
  members.forEach((m) => {
    if (!m.team_id) return;
    const list = membersByTeam.get(m.team_id) || [];
    list.push(m);
    membersByTeam.set(m.team_id, list);
  });

  const walletByTeam = new Map<string, number>();
  wallets.forEach((w) => {
    if (w.team_id) walletByTeam.set(w.team_id, Number(w.balance) || 0);
  });

  const bonusesBySlotAndTeam = new Map<string, number>();
  bonuses.forEach((b) => {
    const key = `${b.slot_id}_${b.team_id}`;
    bonusesBySlotAndTeam.set(
      key,
      (bonusesBySlotAndTeam.get(key) || 0) + (Number(b.bonus_seconds) || 0)
    );
  });

  const slotsByTeam = new Map<string, typeof soldSlots>();
  soldSlots.forEach((s) => {
    if (!s.winner_team_id) return;
    const list = slotsByTeam.get(s.winner_team_id) || [];
    list.push(s);
    slotsByTeam.set(s.winner_team_id, list);
  });

  const activeElimByTeam = new Map<string, string>();
  elims.forEach((e) => {
    if (e.team_id) activeElimByTeam.set(e.team_id, e.reason || "Eliminated");
  });

  return teams.map((t): BiddingResultTeam => {
    const teamMembers = membersByTeam.get(t.id) || [];
    const captainMember =
      teamMembers.find((m) => m.id === t.captain_id) || teamMembers[0];

    const captainName = captainMember?.name || "—";
    const captainEmail = captainMember?.email || "";
    const captainUsn = captainEmail.split("@")[0]?.toUpperCase() || "—";

    const membersList: BiddingResultMember[] = teamMembers.map((m) => ({
      name: m.name || "—",
      usn: (m.email || "").split("@")[0]?.toUpperCase() || "—",
      is_captain: m.id === t.captain_id,
    }));

    const wonSlots = slotsByTeam.get(t.id) || [];
    let totalSpent = 0;
    let totalBonusDevSeconds = 0;

    const problemsList: BiddingResultProblem[] = wonSlots.map((s) => {
      const topic = topicsMap.get(s.topic_id);
      const winningBid = Number(s.current_bid) || 0;
      totalSpent += winningBid;

      const bonusSecs = bonusesBySlotAndTeam.get(`${s.id}_${t.id}`) || 0;
      totalBonusDevSeconds += bonusSecs;

      return {
        slot_id: s.id,
        question_number: s.question_number,
        round: s.round,
        difficulty: topic?.level || "easy",
        topic_title: topic?.title || "Problem Statement",
        winning_bid: winningBid,
        status: s.status,
        sold_at: s.sold_at,
        base_dev_seconds: baseDevSeconds,
        bonus_dev_seconds: bonusSecs,
        total_dev_seconds: totalDevSeconds + bonusSecs,
      };
    });

    const wonCount = problemsList.length;
    const totalBaseDevSeconds = baseDevSeconds * wonCount;
    const totalAddonDevSeconds = addonDevSeconds * wonCount;
    const totalDevSeconds = totalBaseDevSeconds + totalAddonDevSeconds + totalBonusDevSeconds;
    const isEliminated = activeElimByTeam.has(t.id);

    return {
      team_id: t.id,
      team_name: t.name,
      captain_name: captainName,
      captain_usn: captainUsn,
      members: membersList,
      member_count: teamMembers.length,
      registered_at: t.created_at,
      balance: walletByTeam.get(t.id) ?? 100,
      total_spent: totalSpent,
      problems: problemsList,
      won_count: wonCount,
      total_base_dev_seconds: totalBaseDevSeconds,
      total_addon_dev_seconds: totalAddonDevSeconds,
      total_bonus_dev_seconds: totalBonusDevSeconds,
      total_dev_seconds: totalDevSeconds,
      qualified: wonCount >= 2,
      eliminated: isEliminated,
      elimination_reason: activeElimByTeam.get(t.id) ?? null,
    };
  });
}
