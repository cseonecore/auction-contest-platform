import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceDb } from "@/lib/serverDb";
import {
  isValidHttpUrl,
  isValidGitHubRepoUrl,
  validateSlotSelection,
  validateSubmissionStateTransition,
  EDITABLE_SUBMISSION_STATUSES,
} from "@/features/submission/utils/submissionRules";

interface SubmissionBody {
  teamId?: string;
  slotId?: string;
  repoUrl: string;
  liveUrl?: string;
}

/**
 * Resolves the authenticated user from either:
 * 1. An Authorization: Bearer <token> header (cryptographically verified by Supabase Auth).
 * 2. A session cookie evaluated by the SSR server client.
 */
async function resolveAuthenticatedUser(request: Request): Promise<{
  user: import("@supabase/supabase-js").User | null;
  client: SupabaseClient | null;
  error: Error | null;
}> {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token) {
      try {
        const supabaseUrl =
          process.env.NEXT_PUBLIC_SUPABASE_URL ||
          "https://qqbuauryvhgssmmxiiuh.supabase.co";
        const anonKey =
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
          "sb_publishable_nRvQFOW3SK82rWBY6VsDGw_yw5-3Itj";

        const userClient = createSupabaseClient(supabaseUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        });

        const { data, error } = await userClient.auth.getUser(token);
        if (!error && data?.user) {
          return { user: data.user, client: userClient, error: null };
        }
      } catch {
        // Bearer verification failed, proceed to cookie check
      }
    }
  }

  // Fallback: check session cookies
  try {
    const db = await createClient();
    const { data, error } = await db.auth.getUser();
    if (!error && data?.user) {
      return { user: data.user, client: db, error: null };
    }
  } catch {
    // Cookie read failed
  }

  return { user: null, client: null, error: new Error("Unauthorized") };
}

function getDbClient(fallbackClient?: SupabaseClient | null): SupabaseClient {
  try {
    return getServiceDb();
  } catch {
    if (fallbackClient) return fallbackClient;
    throw new Error("No database client available.");
  }
}

/**
 * Record (or update) a team's solution for the question it owns.
 *
 * Rules:
 * - Only authenticated team members can submit.
 * - Team ID is resolved strictly from Auth/members, never from request body.
 * - Must belong to a slot the team won in the auction (status = 'sold').
 * - Valid GitHub repository URL required (e.g. github.com/<owner>/<repo>).
 * - Explicit slotId selection required when team won multiple slots.
 * - Once approved, the submission is locked and cannot be edited.
 * - If rejected, requires judge authorization (reopening) before resubmission.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SubmissionBody;
    const { repoUrl, liveUrl } = body;

    if (!repoUrl || !repoUrl.trim()) {
      return NextResponse.json(
        { error: "GitHub repository URL is required." },
        { status: 400 }
      );
    }
    if (!isValidGitHubRepoUrl(repoUrl.trim())) {
      return NextResponse.json(
        {
          error:
            "Repository URL must be a valid GitHub repository URL (e.g. https://github.com/owner/repo).",
        },
        { status: 400 }
      );
    }
    if (liveUrl && liveUrl.trim() && !isValidHttpUrl(liveUrl.trim())) {
      return NextResponse.json(
        { error: "Live deployment URL must be a valid HTTP/HTTPS URL." },
        { status: 400 }
      );
    }

    // Authenticate user via Bearer token or cookies
    const { user, client: authClient, error: authError } = await resolveAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in to submit a solution." },
        { status: 401 }
      );
    }

    const service = getDbClient(authClient);

    // Resolve caller's team strictly from members table
    const { data: membership, error: memberErr } = await service
      .from("members")
      .select("team_id")
      .eq("id", user.id)
      .maybeSingle();

    if (memberErr || !membership?.team_id) {
      return NextResponse.json(
        { error: "You are not registered with any team." },
        { status: 403 }
      );
    }

    const teamId = membership.team_id;

    // Verify auction slots won by this team
    const { data: wonSlots, error: slotsErr } = await service
      .from("slots")
      .select("id, topic_id")
      .eq("winner_team_id", teamId)
      .eq("status", "sold");

    if (slotsErr) {
      return NextResponse.json(
        { error: "Failed to load assigned questions." },
        { status: 500 }
      );
    }

    // Validate slot assignment and explicit selection
    const slotValidation = validateSlotSelection(wonSlots || [], body.slotId);
    if (!slotValidation.valid || !slotValidation.slotId) {
      const statusCode =
        slotValidation.error?.includes("not assigned")
          ? 403
          : 400;
      return NextResponse.json({ error: slotValidation.error }, { status: statusCode });
    }

    const slotId = slotValidation.slotId;

    // Check if an existing submission exists for (team_id, slot_id)
    const { data: existing, error: existingErr } = await service
      .from("submissions")
      .select("id, status, approved_at, judge_notes")
      .eq("team_id", teamId)
      .eq("slot_id", slotId)
      .maybeSingle();

    if (existingErr) {
      return NextResponse.json(
        { error: `Failed to check existing submission: ${existingErr.message}` },
        { status: 500 }
      );
    }

    if (existing) {
      // Validate state transition using authoritative state rules
      const transition = validateSubmissionStateTransition(existing.status, "update");
      if (!transition.allowed) {
        return NextResponse.json(
          {
            error:
              existing.status === "rejected" && existing.judge_notes
                ? `${transition.error} (Judge note: "${existing.judge_notes}")`
                : transition.error,
          },
          { status: 403 }
        );
      }

      // Update existing unapproved submission (strictly updates code URLs and timestamp)
      // Concurrency safeguard: Conditional atomic update at database statement level.
      // Prevents participant update from overwriting an approved/rejected status if a judge
      // approved or rejected concurrently between the read above and this update.
      const updatePayload = {
        repository_url: repoUrl.trim(),
        live_url: liveUrl?.trim() || null,
        submitted_at: new Date().toISOString(),
        status: "submitted",
      };

      const { data: updated, error: updateErr } = await service
        .from("submissions")
        .update(updatePayload)
        .eq("id", existing.id)
        .eq("team_id", teamId)
        .in("status", [...EDITABLE_SUBMISSION_STATUSES])
        .select()
        .maybeSingle();

      if (updateErr) {
        return NextResponse.json(
          { error: "Failed to update submission. Please try again." },
          { status: 500 }
        );
      }

      if (!updated) {
        // Concurrency conflict: 0 rows updated because the submission status or ownership
        // changed concurrently between initial read and statement execution.
        const { data: latest } = await service
          .from("submissions")
          .select("id, status, team_id, judge_notes")
          .eq("id", existing.id)
          .maybeSingle();

        if (latest?.status === "approved") {
          return NextResponse.json(
            {
              error:
                "Conflict: This submission was approved by judges while your update was being processed and is now locked.",
            },
            { status: 409 }
          );
        }

        if (latest?.status === "rejected") {
          const noteSuffix = latest.judge_notes ? ` (Judge note: "${latest.judge_notes}")` : "";
          return NextResponse.json(
            {
              error: `Conflict: This submission was rejected by judges${noteSuffix} while your update was being processed. Resubmission requires judge/admin authorization.`,
            },
            { status: 409 }
          );
        }

        if (latest && latest.team_id !== teamId) {
          return NextResponse.json(
            {
              error: "Conflict: This submission is no longer associated with your team.",
            },
            { status: 409 }
          );
        }

        return NextResponse.json(
          {
            error:
              "Conflict: The submission status changed concurrently. Please refresh the page and try again.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Submission updated successfully.",
        isUpdate: true,
        slotId,
        submission: updated,
      });
    }

    // Insert new submission
    const insertPayload = {
      team_id: teamId,
      slot_id: slotId,
      repository_url: repoUrl.trim(),
      live_url: liveUrl?.trim() || null,
      submitted_by: user.id,
      submitted_at: new Date().toISOString(),
      status: "submitted",
    };

    const { data: inserted, error: insertErr } = await service
      .from("submissions")
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr) {
      // Handle potential race condition on unique index (team_id, slot_id)
      if (insertErr.code === "23505") {
        return NextResponse.json(
          { error: "A submission for this question is already being processed. Please refresh." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to record submission. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Solution submitted successfully!",
      isUpdate: false,
      slotId,
      submission: inserted,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process submission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Retrieve submissions:
 * - Admin/Judge: can fetch all submissions (when teamId is omitted or all=true) or for a specific team.
 * - Participant: can ONLY fetch submissions for their own team.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedTeamId = searchParams.get("teamId");
    const fetchAll = searchParams.get("all") === "true";

    const { user, client: authClient, error: authError } = await resolveAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
    }

    const service = getDbClient(authClient);
    const isAdminOrJudge =
      user.app_metadata?.role === "admin" || user.app_metadata?.role === "judge";

    let targetTeamId: string | null = requestedTeamId;

    if (!isAdminOrJudge) {
      // Participant: derive team strictly from members
      const { data: membership, error: memErr } = await service
        .from("members")
        .select("team_id")
        .eq("id", user.id)
        .maybeSingle();

      if (memErr) {
        return NextResponse.json(
          { error: `Failed to verify team membership: ${memErr.message}` },
          { status: 500 }
        );
      }

      if (!membership?.team_id) {
        return NextResponse.json({ error: "Not registered with any team." }, { status: 403 });
      }

      if (requestedTeamId && requestedTeamId !== membership.team_id) {
        return NextResponse.json(
          { error: "You are not authorized to view other teams' submissions." },
          { status: 403 }
        );
      }

      targetTeamId = membership.team_id;
    }

    // Admin requesting all submissions
    if (isAdminOrJudge && (fetchAll || !targetTeamId)) {
      const { data, error } = await service
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
        .order("submitted_at", { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Also fetch evaluations and bonus transactions to enrich admin view
      const [{ data: evaluations, error: evalErr }, { data: bonusTxs, error: bonusErr }] =
        await Promise.all([
          service.from("evaluations").select("submission_id, score, report, status"),
          service.from("bonus_transactions").select("submission_id, bonus_seconds, created_at"),
        ]);

      if (evalErr) {
        return NextResponse.json(
          { error: `Failed to fetch evaluations: ${evalErr.message}` },
          { status: 500 }
        );
      }
      if (bonusErr) {
        return NextResponse.json(
          { error: `Failed to fetch bonus transactions: ${bonusErr.message}` },
          { status: 500 }
        );
      }

      const evalMap = new Map((evaluations || []).map((e) => [e.submission_id, e]));
      const bonusMap = new Map((bonusTxs || []).map((b) => [b.submission_id, b]));

      const enriched = (data || []).map((sub) => {
        const ev = evalMap.get(sub.id);
        const bo = bonusMap.get(sub.id);
        const teamRel = sub.team as unknown as { id: string; name: string } | null;
        const slotRel = sub.slot as unknown as {
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
          evaluation: ev ? { score: ev.score, report: ev.report, status: ev.status } : null,
          bonus: bo ? { bonus_seconds: bo.bonus_seconds, created_at: bo.created_at } : null,
        };
      });

      return NextResponse.json({
        success: true,
        submissions: enriched,
      });
    }

    // Specific team submissions
    const { data, error } = await service
      .from("submissions")
      .select("id, team_id, slot_id, repository_url, live_url, status, submitted_at, approved_at, judge_notes")
      .eq("team_id", targetTeamId!)
      .order("submitted_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      submission: data?.[0] ?? null,
      submissions: data ?? [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load submissions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
