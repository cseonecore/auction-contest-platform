import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceDb } from "@/lib/serverDb";

interface SubmissionBody {
  teamId?: string;
  slotId?: string;
  repoUrl: string;
  liveUrl?: string;
}

function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Record (or update) a team's solution for the question it owns.
 *
 * The caller's team is resolved from the session. The submission must
 * reference an auction item the team actually won — that link is what
 * the bonus-time engine later uses, and it is re-verified inside
 * `approve_submission()`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SubmissionBody;
    const { repoUrl, liveUrl } = body;

    if (!repoUrl || !repoUrl.trim()) {
      return NextResponse.json({ error: "GitHub repository URL is required." }, { status: 400 });
    }
    if (!isValidHttpUrl(repoUrl)) {
      return NextResponse.json({ error: "Repository URL must be a valid HTTP/HTTPS URL." }, { status: 400 });
    }
    if (liveUrl && liveUrl.trim() && !isValidHttpUrl(liveUrl)) {
      return NextResponse.json({ error: "Live deployment URL must be a valid HTTP/HTTPS URL." }, { status: 400 });
    }

    // Session-bound client: RLS decides what this caller may read.
    const db = await createClient();

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: "You must be signed in to submit a solution." },
        { status: 401 }
      );
    }

    // Resolve the team from the session — never from the request body.
    const { data: membership, error: memberErr } = await db
      .from("members")
      .select("team_id")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (memberErr || !membership?.team_id) {
      return NextResponse.json(
        { error: "You are not registered with a team." },
        { status: 403 }
      );
    }

    const teamId = membership.team_id;

    // The auction item the team must own.
    const { data: wonSlots, error: slotsErr } = await db
      .from("slots")
      .select("id, topic_id")
      .eq("winner_team_id", teamId)
      .eq("status", "sold");

    if (slotsErr) {
      return NextResponse.json(
        { error: "Failed to load the assigned questions." },
        { status: 500 }
      );
    }

    if (!wonSlots || wonSlots.length === 0) {
      return NextResponse.json(
        { error: "Your team does not own an assigned question yet." },
        { status: 400 }
      );
    }

    const requestedSlot = body.slotId
      ? wonSlots.find((s) => s.id === body.slotId)
      : undefined;

    if (body.slotId && !requestedSlot) {
      return NextResponse.json(
        { error: "That question is not assigned to your team." },
        { status: 403 }
      );
    }

    const slotId = requestedSlot?.id ?? wonSlots[0].id;

    // The insert needs the service role (participants may not write to
    // `submissions` directly) — the ownership above was already proven
    // from the session.
    const service = getServiceDb();

    const { data: existing } = await service
      .from("submissions")
      .select("id")
      .eq("team_id", teamId)
      .eq("slot_id", slotId)
      .maybeSingle();

    const payload = {
      team_id: teamId,
      slot_id: slotId,
      repository_url: repoUrl.trim(),
      live_url: liveUrl?.trim() || null,
      submitted_at: new Date().toISOString(),
      status: "submitted",
    };

    if (existing) {
      const { error: updateErr } = await service
        .from("submissions")
        .update(payload)
        .eq("id", existing.id);

      if (updateErr) {
        return NextResponse.json(
          { error: "Failed to update submission. Please try again." },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Submission updated successfully.",
        isUpdate: true,
        slotId,
      });
    }

    const { error: insertErr } = await service
      .from("submissions")
      .insert(payload);

    if (insertErr) {
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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process submission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json({ error: "teamId is required." }, { status: 400 });
    }

    const db = await createClient();

    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
    }

    const { data: membership } = await db
      .from("members")
      .select("team_id")
      .eq("id", authData.user.id)
      .maybeSingle();

    const isSelf = membership?.team_id === teamId;
    const isAdmin = authData.user.app_metadata?.role === "admin";

    if (!isSelf && !isAdmin) {
      return NextResponse.json(
        { error: "You are not authorised to view this submission." },
        { status: 403 }
      );
    }

    const { data, error } = await db
      .from("submissions")
      .select("id, team_id, slot_id, repository_url, live_url, status, submitted_at, approved_at")
      .eq("team_id", teamId)
      .order("submitted_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, submission: data?.[0] ?? null, submissions: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load submission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
