import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isActionPermittedForRole,
  validateEvaluationScore,
} from "@/features/submission/utils/submissionRules";

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
 * Auction administration & judging actions.
 *
 * Enforces authenticated admin/judge identity via Bearer token or SSR session cookies.
 * Preserves the authentic caller JWT when invoking PostgreSQL RPCs so that
 * auth.jwt() and auth.uid() are populated inside the database transaction.
 *
 * Enforces role-based action authorization:
 * - Admin-only: auction lifecycle, timers, team elimination/restoration, topic creation.
 * - Admin & Judge: submission evaluation, approval, rejection, reopening, permitted bonus actions.
 *
 * Transactional database RPCs guarantee atomic execution and state consistency.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AdminActionBody;
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: "An action is required." }, { status: 400 });
    }

    // 1. Resolve user client carrying the authentic caller JWT (Bearer token or SSR cookies)
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
    const bearerToken =
      authHeader && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.substring(7).trim()
        : null;

    let userClient: SupabaseClient;

    if (bearerToken) {
      const supabaseUrl =
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
        "https://qqbuauryvhgssmmxiiuh.supabase.co";
      const anonKey =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

      userClient = createSupabaseClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: {
            Authorization: `Bearer ${bearerToken}`,
          },
        },
      });
    } else {
      userClient = await createServerClient();
    }

    // 2. Authenticate the caller and verify cryptographic token validity
    const { data: authData, error: authError } = await (bearerToken
      ? userClient.auth.getUser(bearerToken)
      : userClient.auth.getUser());
    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: "Admin authentication required." },
        { status: 401 }
      );
    }

    const user = authData.user;

    // 3. Application-level role authorization
    const role = user.app_metadata?.role as string | undefined;
    const roleCheck = isActionPermittedForRole(action, role);
    if (!roleCheck.allowed) {
      return NextResponse.json(
        { error: roleCheck.error || "Forbidden." },
        { status: 403 }
      );
    }

    // 4. Helper to invoke PostgreSQL RPCs carrying the user's authentic JWT context
    const call = async (fn: string, args: Record<string, unknown> = {}) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (userClient.rpc as any)(fn, args);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, data });
    };

    switch (action) {
      // ── Session lifecycle (Admin Only) ──────────────────────────
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
      case "end_auction":
        return call("end_auction");
      case "pause_auction":
        return call("pause_auction");
      case "resume_auction":
        return call("resume_auction");
      case "advance":
      case "next_slot":
        return call("advance_auction_slot");
      case "skip_slot":
        return call("skip_slot", {
          p_slot_id: body.slotId,
          p_reason: body.reason ?? "Skipped by admin",
        });
      case "reset_auction":
        return call("full_auction_reset");

      // ── Timer controls (Admin Only) ─────────────────────────────
      case "extend_timer":
        return call("extend_auction_timer", {
          p_seconds: Math.floor(Number(body.seconds ?? 15)),
          p_reason: body.reason ?? "admin",
        });
      case "adjust_timer":
        return call("adjust_auction_timer", {
          p_seconds: Math.floor(Number(body.seconds ?? 15)),
          p_reason: body.reason ?? "admin",
        });

      // ── Teams (Admin Only) ──────────────────────────────────────
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

      // ── Judging & bonus (Admin & Judge) ─────────────────────────
      case "approve_solution": {
        if (!body.submissionId) {
          return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
        }
        const scoreValidation = validateEvaluationScore(body.score ?? 0);
        if (!scoreValidation.valid || scoreValidation.score === undefined) {
          return NextResponse.json(
            { error: scoreValidation.error || "Invalid score." },
            { status: 400 }
          );
        }

        return call("approve_submission", {
          p_submission_id: body.submissionId,
          p_score: scoreValidation.score,
          p_notes: body.notes ?? null,
          p_grant_bonus: Boolean(body.grantBonus),
        });
      }

      case "reject_solution": {
        if (!body.submissionId) {
          return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
        }
        const reason = (body.notes || body.reason || "Rejected by judges").trim();

        return call("reject_submission", {
          p_submission_id: body.submissionId,
          p_reason: reason,
        });
      }

      case "reopen_solution": {
        if (!body.submissionId) {
          return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
        }
        const notes = (body.notes || body.reason || "Reopened for revisions").trim();

        return call("reopen_submission", {
          p_submission_id: body.submissionId,
          p_notes: notes,
        });
      }

      case "grant_bonus":
        return call("grant_bonus_time", {
          p_submission_id: body.submissionId,
          p_reason: body.reason ?? null,
        });

      // ── Topics (Admin Only) ─────────────────────────────────────
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
