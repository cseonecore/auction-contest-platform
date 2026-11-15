/**
 * POST /api/challenge/judge
 *
 * Server-side API route that handles challenge solution submissions.
 * This is the SECURE BOUNDARY between the browser and the judge system.
 *
 * Flow:
 *   1. Authenticate the caller via their Supabase session token
 *   2. Look up the caller's team
 *   3. Fetch the problem's hidden test cases (service-role client)
 *   4. Run the solution in a sandbox against every hidden test
 *   5. ONLY if the sandbox confirms every test passed → record_solve()
 *   6. Return result (never expose test case answers)
 *
 * FAIL-CLOSED: If the sandbox is not connected, the route returns 501
 * and record_solve is never reached.  There is no flag or bypass.
 */

import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase-server"
import type { JudgeRequest, JudgeResponse, RecordSolveResult } from "@/types/submission"

// ─── Sandbox integration point ──────────────────────────────
//
// Replace the body of executeSandbox() with a real sandbox call.
// The route ONLY records a solve when this function returns
// { allPassed: true }.  Returning null means "sandbox unavailable"
// and the route responds 501 — record_solve is never called.
//
// There is intentionally no flag to skip this function.
// ─────────────────────────────────────────────────────────────

interface SandboxResult {
  /** True only when every hidden test case produced correct output. */
  allPassed: boolean
  /** Zero-based indices of test cases that failed (empty when allPassed). */
  failedIndices: number[]
}

/**
 * Execute untrusted code against hidden test cases in an isolated sandbox.
 *
 * Returns a SandboxResult when a sandbox is connected, or null when
 * no sandbox is available.  The caller treats null as "cannot judge."
 *
 * To connect a real sandbox (Judge0, Piston, Docker, etc.):
 *   1. Send `code` + `language` + each test case's `input` to the sandbox.
 *   2. Compare each run's stdout to the test case's `expected_output`.
 *   3. Return { allPassed, failedIndices }.
 */
async function executeSandbox(
  _code: string,
  _language: string,
  _testCases: ReadonlyArray<{ input: string; expected_output: string }>,
): Promise<SandboxResult | null> {
  //  ┌──────────────────────────────────────────────────────┐
  //  │  🚧  NO SANDBOX CONNECTED                           │
  //  │  Returning null makes the route respond 501.         │
  //  │  record_solve() is never reached.                    │
  //  └──────────────────────────────────────────────────────┘
  return null
}

// ─── Route handler ──────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse<JudgeResponse>> {
  // ── 1. Read and validate the request body ──────────────────
  let body: JudgeRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 },
    )
  }

  const { problem_id, solution_code, language } = body

  if (!problem_id || !solution_code || !language) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing required fields: problem_id, solution_code, language.",
      },
      { status: 400 },
    )
  }

  // ── 2. Authenticate the caller ────────────────────────────
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.replace("Bearer ", "")

  if (!token) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    )
  }

  const serviceClient = createServiceClient()

  const {
    data: { user },
    error: authError,
  } = await serviceClient.auth.getUser(token)

  if (authError || !user) {
    return NextResponse.json(
      { success: false, message: "Invalid or expired session." },
      { status: 401 },
    )
  }

  // ── 3. Resolve the user's team ────────────────────────────
  const { data: member } = await serviceClient
    .from("members")
    .select("team_id")
    .eq("id", user.id)
    .maybeSingle()

  const teamId = (member as { team_id: string } | null)?.team_id

  if (!teamId) {
    return NextResponse.json(
      { success: false, message: "You must be in a team to submit solutions." },
      { status: 403 },
    )
  }

  // ── 4. Fetch the problem and its hidden test cases ─────────
  //    The service-role client bypasses column-level security,
  //    so it CAN read test_cases (the browser cannot).
  const { data: problem, error: problemErr } = await serviceClient
    .from("challenge_problems")
    .select("id, title, test_cases")
    .eq("id", problem_id)
    .maybeSingle()

  if (problemErr || !problem) {
    return NextResponse.json(
      { success: false, message: "Challenge problem not found." },
      { status: 404 },
    )
  }

  const testCases = problem.test_cases as Array<{
    input: string
    expected_output: string
  }>

  if (!Array.isArray(testCases) || testCases.length === 0) {
    return NextResponse.json(
      { success: false, message: "This problem has no test cases configured." },
      { status: 500 },
    )
  }

  // ── 5. Execute in sandbox ─────────────────────────────────
  //    executeSandbox returns null when no sandbox is connected.
  //    It returns { allPassed, failedIndices } when one is.
  //    record_solve is ONLY reachable when allPassed === true.
  const sandboxResult = await executeSandbox(solution_code, language, testCases)

  if (sandboxResult === null) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Code execution sandbox is not yet connected. " +
          "The judge endpoint is ready — it authenticates you, finds your team, " +
          "and loads the hidden test cases — but it cannot run your code until " +
          "a sandbox service (e.g. Judge0, Piston) is integrated. " +
          "Please check back when the sandbox dependency is deployed.",
      },
      { status: 501 },
    )
  }

  if (!sandboxResult.allPassed) {
    return NextResponse.json({
      success: false,
      message: `${sandboxResult.failedIndices.length} of ${testCases.length} test cases failed.`,
      failed_tests: sandboxResult.failedIndices,
    })
  }

  // ── 6. ALL tests verified by sandbox → record the solve ────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: solveData, error: solveErr } = await (serviceClient.rpc as any)(
    "record_solve",
    {
      p_team_id: teamId,
      p_problem_id: problem_id,
    },
  )

  if (solveErr) {
    return NextResponse.json(
      { success: false, message: solveErr.message || "Failed to record solve." },
      { status: 500 },
    )
  }

  const solveResult = solveData as unknown as RecordSolveResult

  if (!solveResult.success) {
    return NextResponse.json({
      success: false,
      message: solveResult.reason || "Could not record solve.",
    })
  }

  return NextResponse.json({
    success: true,
    message: `All ${testCases.length} test cases passed! +${solveResult.bonus_minutes} minutes bonus time.`,
    solve: {
      solve_number: solveResult.solve_number!,
      bonus_minutes: solveResult.bonus_minutes!,
      new_deadline: solveResult.new_deadline!,
    },
  })
}

