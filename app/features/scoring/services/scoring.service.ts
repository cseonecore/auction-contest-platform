"use client";

/**
 * Scoring service.
 *
 * Competition scoring is deliberately separate from the auction
 * budget: a team's auction wallet says how much it spent, while the
 * evaluation score says how good its solution was. Bonus time is an
 * auction-side award and never changes the competition score.
 */

import { supabase } from "@/lib/supabase";

export interface TeamScore {
  teamId: string;
  teamName: string;
  /** Sum of the judge scores for the team's approved solutions. */
  score: number;
  /** Auction points still unspent (converted to bonus points at the end). */
  remainingBudget: number;
  /** Projected bonus points for the unspent budget (Rule Book §9.8). */
  projectedBonusPoints: number;
  solvedQuestions: number;
}

export interface ScoringSnapshot {
  teams: TeamScore[];
  generatedAt: string;
}

export async function fetchScoringSnapshot(): Promise<ScoringSnapshot> {
  const [{ data: teams }, { data: evaluations }, { data: solves }, { data: wallets }] =
    await Promise.all([
      supabase.from("teams").select("id, name"),
      supabase.from("evaluations").select("score, status, submission:submissions(team_id)"),
      supabase.from("challenge_solves").select("team_id"),
      supabase.from("wallets").select("team_id, balance"),
    ]);

  const scoreByTeam = new Map<string, number>();
  (evaluations ?? []).forEach((evaluation) => {
    if (evaluation.status !== "completed") return;
    const submission = evaluation.submission as unknown as
      | { team_id: string }
      | { team_id: string }[]
      | null;
    const teamId = Array.isArray(submission) ? submission[0]?.team_id : submission?.team_id;
    if (!teamId) return;
    scoreByTeam.set(teamId, (scoreByTeam.get(teamId) ?? 0) + Number(evaluation.score ?? 0));
  });

  const solvesByTeam = new Map<string, number>();
  (solves ?? []).forEach((solve) => {
    solvesByTeam.set(solve.team_id, (solvesByTeam.get(solve.team_id) ?? 0) + 1);
  });

  const balanceByTeam = new Map<string, number>();
  (wallets ?? []).forEach((wallet) => {
    balanceByTeam.set(wallet.team_id, Number(wallet.balance ?? 0));
  });

  return {
    teams: (teams ?? []).map((team) => {
      const remainingBudget = balanceByTeam.get(team.id) ?? 0;
      return {
        teamId: team.id,
        teamName: team.name,
        score: scoreByTeam.get(team.id) ?? 0,
        remainingBudget,
        projectedBonusPoints: Math.floor(Math.max(0, remainingBudget) / 3),
        solvedQuestions: solvesByTeam.get(team.id) ?? 0,
      };
    }),
    generatedAt: new Date().toISOString(),
  };
}
