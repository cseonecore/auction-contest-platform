import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface AdminActionBody {
  action: string;
  slotId?: string;
  teamId?: string;
  submissionId?: string;
  reason?: string;
  rule?: string;
  score?: number;
  notes?: string;
  seconds?: number;
  startingBid?: number;
  grantBonus?: boolean;
  title?: string;
  description?: string;
  level?: string;
  criterion?: unknown;
  slotsCount?: number;
}

/**
 * Auction administration.
 *
 * Every action is a call to a SECURITY DEFINER engine function that
 * performs its own authorisation check (`is_admin()` /
 * `is_admin_or_judge()`) inside PostgreSQL. This route never writes
 * to a table directly, so an authorisation bug here cannot escalate
 * into a data mutation.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AdminActionBody;
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: "An action is required." }, { status: 400 });
    }

    // Session-bound client: the JWT carries app_metadata.role.
    const db = await createClient();

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: "Admin authentication required." },
        { status: 401 }
      );
    }

    const role = authData.user.app_metadata?.role;
    if (role !== "admin" && role !== "judge") {
      return NextResponse.json(
        { error: "Admin access required for this action." },
        { status: 403 }
      );
    }

    const call = async (fn: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, data });
    };

    switch (action) {
      // ── Session lifecycle ──────────────────────────────────────
      case "start_auction":
        return call("start_auction", { p_round: 1 });
      case "select_question":
        return call("select_auction_question", { p_slot_id: body.slotId });
      case "open_bidding":
      case "open_slot":
        return call("open_bidding", { p_slot_id: body.slotId ?? null });
      case "close_bidding":
      case "close_slot":
        return call("close_bidding", { p_slot_id: body.slotId ?? null });
      case "finalize":
      case "finalize_auction":
        return call("finalize_auction", { p_slot_id: body.slotId ?? null });
      case "advance":
      case "next_slot":
        return call("advance_auction");
      case "skip_slot":
        return call("skip_slot", { p_slot_id: body.slotId });
      case "pause_auction":
        return call("pause_auction");
      case "resume_auction":
        return call("resume_auction");
      case "end_session":
        return call("end_auction_session");
      case "reset_auction":
        return call("reset_auction");

      // ── Timers ─────────────────────────────────────────────────
      case "start_timer":
        return call("start_auction_timer", {
          p_seconds: body.seconds ?? null,
        });
      case "pause_timer":
        return call("pause_auction_timer");
      case "resume_timer":
        return call("resume_auction_timer");
      case "extend_timer":
        // The bidding clock of the live item.
        return call("adjust_bidding_timer", {
          p_seconds: Math.floor(Number(body.seconds ?? 15)),
          p_slot_id: body.slotId ?? null,
          p_reason: body.reason ?? "admin",
        });
      case "extend_solving_timer":
        // The solving clock that bonus time extends.
        return call("adjust_auction_timer", {
          p_seconds: Math.floor(Number(body.seconds ?? 15)),
          p_reason: body.reason ?? "admin",
        });

      // ── Teams ──────────────────────────────────────────────────
      case "eliminate_team":
        return call("eliminate_team", {
          p_team_id: body.teamId,
          p_reason: body.reason ?? "Manual elimination",
          p_rule: body.rule ?? "manual",
        });
      case "restore_team":
        return call("restore_team", {
          p_team_id: body.teamId,
          p_note: body.reason ?? null,
        });

      // ── Judging & bonus ────────────────────────────────────────
      case "approve_solution":
        return call("approve_submission", {
          p_submission_id: body.submissionId,
          p_score: Number(body.score ?? 0),
          p_notes: body.notes ?? null,
          p_grant_bonus: body.grantBonus ?? true,
        });
      case "grant_bonus":
        return call("grant_bonus_time", {
          p_submission_id: body.submissionId,
          p_reason: body.reason ?? null,
        });

      // ── Topics ─────────────────────────────────────────────────
      case "create_topic":
        return call("create_auction_topic", {
          p_title: body.title,
          p_description: body.description ?? null,
          p_level: body.level ?? "easy",
          p_starting_bid:
            body.startingBid && Number(body.startingBid) > 0
              ? Math.floor(Number(body.startingBid))
              : null,
          p_criterion: (body.criterion ?? null) as never,
          p_slots_count: body.slotsCount ?? 1,
        });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Admin action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
