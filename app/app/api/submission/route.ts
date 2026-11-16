import { NextResponse } from "next/server";
import { getServerDb } from "@/lib/serverDb";

interface SubmissionBody {
  teamId: string;
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

export async function POST(request: Request) {
  try {
    const body: SubmissionBody = await request.json();
    const { teamId, repoUrl, liveUrl } = body;

    if (!teamId) {
      return NextResponse.json({ error: "Team ID is required." }, { status: 400 });
    }
    if (!repoUrl || !repoUrl.trim()) {
      return NextResponse.json({ error: "GitHub repository URL is required." }, { status: 400 });
    }
    if (!isValidHttpUrl(repoUrl)) {
      return NextResponse.json({ error: "Repository URL must be a valid HTTP/HTTPS URL." }, { status: 400 });
    }
    if (liveUrl && liveUrl.trim() && !isValidHttpUrl(liveUrl)) {
      return NextResponse.json({ error: "Live deployment URL must be a valid HTTP/HTTPS URL." }, { status: 400 });
    }

    const db = getServerDb();

    // 1. Verify team exists
    const { data: team, error: teamErr } = await db
      .from("teams")
      .select("id, name")
      .eq("id", teamId)
      .maybeSingle();

    if (teamErr || !team) {
      return NextResponse.json({ error: "Team not found." }, { status: 404 });
    }

    // 2. Upsert submission (allow re-submission to update)
    const { data: existing } = await db
      .from("submissions")
      .select("id")
      .eq("team_id", teamId)
      .maybeSingle();

    if (existing) {
      // Update existing submission
      const { error: updateErr } = await db
        .from("submissions")
        .update({
          repo_url: repoUrl.trim(),
          live_url: liveUrl?.trim() || null,
          submitted_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateErr) {
        return NextResponse.json({ error: "Failed to update submission. Please try again." }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: "Submission updated successfully.",
        isUpdate: true,
      });
    } else {
      // Insert new submission
      const { error: insertErr } = await db.from("submissions").insert({
        team_id: teamId,
        repo_url: repoUrl.trim(),
        live_url: liveUrl?.trim() || null,
      });

      if (insertErr) {
        return NextResponse.json({ error: "Failed to record submission. Please try again." }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: "Solution submitted successfully!",
        isUpdate: false,
      });
    }
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

    const db = getServerDb();
    const { data, error } = await db
      .from("submissions")
      .select("id, team_id, repo_url, live_url, submitted_at")
      .eq("team_id", teamId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, submission: data || null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load submission";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
