/**
 * useChallengeProblems — fetch challenge problems + team solve status.
 *
 * This hook queries challenge_problems using ONLY the safe columns
 * (id, topic_id, title, description, difficulty, points, created_at).
 *
 * The test_cases column is blocked by column-level security in
 * migration 040 — even if someone tried to query it, the database
 * would reject the request.
 *
 * Also fetches the team's challenge_solves to show which problems
 * have already been solved.
 */

"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import type { ProblemWithStatus } from "@/types/submission"

export function useChallengeProblems(teamId: string | null) {
  const [problems, setProblems] = useState<ProblemWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProblems = useCallback(async () => {
    try {
      setError(null)

      // 1. Fetch problems — only the safe columns (no test_cases)
      const { data: problemData, error: problemErr } = await supabase
        .from("challenge_problems")
        .select("id, topic_id, title, description, difficulty, points, created_at")
        .order("difficulty", { ascending: true })
        .order("points", { ascending: true })

      if (problemErr) throw problemErr

      // 2. If the user is on a team, fetch their solves
      type SolveRecord = { problem_id: string; solved_at: string }
      let solveMap = new Map<string, string>()

      if (teamId) {
        const { data: solveData, error: solveErr } = await supabase
          .from("challenge_solves")
          .select("problem_id, solved_at")
          .eq("team_id", teamId)

        if (solveErr) throw solveErr

        const solves = (solveData || []) as SolveRecord[]
        solveMap = new Map(solves.map((s) => [s.problem_id, s.solved_at]))
      }

      // 3. Combine: mark each problem as solved or not
      const combined: ProblemWithStatus[] = (problemData || []).map(
        (p: Record<string, unknown>) => ({
          id: p.id as string,
          topic_id: p.topic_id as string,
          title: p.title as string,
          description: p.description as string,
          difficulty: p.difficulty as "easy" | "medium" | "hard",
          points: p.points as number,
          created_at: p.created_at as string,
          solved: solveMap.has(p.id as string),
          solved_at: solveMap.get(p.id as string) ?? null,
        })
      )

      setProblems(combined)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load challenge problems"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => {
    void fetchProblems()
  }, [fetchProblems])

  return {
    problems,
    /** Number of problems the team has solved. */
    solvedCount: problems.filter((p) => p.solved).length,
    loading,
    error,
    refetch: fetchProblems,
  }
}

