/**
 * submitSolution — send a challenge solution to the server-side judge.
 *
 * This does NOT call record_solve directly (that would be insecure).
 * Instead it POSTs the solution to /api/challenge/judge, which:
 *   1. Authenticates the user via their Supabase session token
 *   2. Fetches hidden test cases using the service-role client
 *   3. Runs the solution against the tests (sandbox — NOT YET BUILT)
 *   4. If all tests pass, calls record_solve via service role
 *
 * The browser never sees hidden test cases and cannot directly create
 * solve records. This is the secure integration boundary.
 */

import { supabase } from "@/lib/supabase"
import type { JudgeRequest, JudgeResponse } from "@/types/submission"

export interface SubmitSolutionParams {
  problemId: string
  solutionCode: string
  language: string
}

export async function submitSolution({
  problemId,
  solutionCode,
  language,
}: SubmitSolutionParams): Promise<JudgeResponse> {
  // Client-side validation
  if (!solutionCode || solutionCode.trim() === "") {
    return {
      success: false,
      message: "Solution code is required.",
    }
  }

  if (!problemId) {
    return {
      success: false,
      message: "Problem ID is required.",
    }
  }

  try {
    // Get the current session token to authenticate with the API route
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      return {
        success: false,
        message: "You must be logged in to submit solutions.",
      }
    }

    const body: JudgeRequest = {
      problem_id: problemId,
      solution_code: solutionCode.trim(),
      language: language.trim().toLowerCase(),
    }

    const response = await fetch("/api/challenge/judge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })

    const result: JudgeResponse = await response.json()
    return result
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred"
    return {
      success: false,
      message,
    }
  }
}

