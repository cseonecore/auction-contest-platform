/**
 * useEvaluationStatus — live evaluation state for the team's submissions.
 *
 * Reads evaluations and eval_updates for the current team.
 * RLS ensures the team can only see their own data.
 *
 * Subscribes to Supabase Realtime so the UI gets live updates
 * as the evaluator progresses (queued → running → completed).
 *
 * The UI will be built later — this hook provides the data contract.
 */

"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import type {
  SubmissionRow,
  EvaluationRow,
  EvalUpdateRow,
} from "@/types/database"
import type { SubmissionEvaluation } from "@/types/submission"

export function useEvaluationStatus(teamId: string | null) {
  const [evaluations, setEvaluations] = useState<SubmissionEvaluation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEvaluations = useCallback(async () => {
    if (!teamId) {
      setLoading(false)
      return
    }

    try {
      setError(null)

      // 1. Get the team's submissions
      const { data: subData, error: subErr } = await supabase
        .from("submissions")
        .select("*")
        .eq("team_id", teamId)

      if (subErr) throw subErr

      const subs = (subData || []) as SubmissionRow[]

      if (subs.length === 0) {
        setEvaluations([])
        setLoading(false)
        return
      }

      // 2. Get evaluations for those submissions
      const subIds = subs.map((s) => s.id)
      const { data: evalData, error: evalErr } = await supabase
        .from("evaluations")
        .select("*")
        .in("submission_id", subIds)

      if (evalErr) throw evalErr

      const evals = (evalData || []) as EvaluationRow[]

      // 3. Get eval_updates for those evaluations
      let updates: EvalUpdateRow[] = []
      if (evals.length > 0) {
        const evalIds = evals.map((e) => e.id)
        const { data: updateData, error: updateErr } = await supabase
          .from("eval_updates")
          .select("*")
          .in("evaluation_id", evalIds)
          .order("created_at", { ascending: true })

        if (updateErr) throw updateErr
        updates = (updateData || []) as EvalUpdateRow[]
      }

      // 4. Assemble: one SubmissionEvaluation per submission
      const result: SubmissionEvaluation[] = subs.map((sub) => {
        const eval_ = evals.find((e) => e.submission_id === sub.id) ?? null
        const evalUpdates = eval_
          ? updates.filter((u) => u.evaluation_id === eval_.id)
          : []

        return {
          submission: sub,
          evaluation: eval_
            ? { ...eval_, updates: evalUpdates }
            : null,
        }
      })

      setEvaluations(result)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load evaluations"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => {
    void fetchEvaluations()

    // Subscribe to realtime changes on evaluations and eval_updates.
    // RLS ensures we only receive events for our own team's data.
    const channel = supabase
      .channel(`eval-status-${teamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "evaluations" },
        () => { void fetchEvaluations() }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "eval_updates" },
        () => { void fetchEvaluations() }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "submissions" },
        () => { void fetchEvaluations() }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [teamId, fetchEvaluations])

  return {
    evaluations,
    loading,
    error,
    refetch: fetchEvaluations,
  }
}

