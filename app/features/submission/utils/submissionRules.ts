/**
 * Bid2Build — Submission, Evaluation & Scoring Business Rules
 *
 * Authoritative, pure business logic functions used across:
 * - /api/submission (participant submissions & admin queries)
 * - /api/auction/admin (judge evaluation, approval, rejection, reopening)
 * - scoring.service.ts (Rule Book §9.8 calculations)
 * - Automated verification & regression test suite
 */

export const JUDGE_ALLOWED_ACTIONS = new Set<string>([
  "approve_solution",
  "reject_solution",
  "reopen_solution",
  "grant_bonus",
]);

export const ADMIN_ONLY_ACTIONS = new Set<string>([
  "start_auction",
  "select_question",
  "open_bidding",
  "open_slot",
  "close_bidding",
  "close_slot",
  "finalize",
  "end_auction",
  "pause_auction",
  "resume_auction",
  "advance",
  "next_slot",
  "skip_slot",
  "reset_auction",
  "extend_timer",
  "adjust_timer",
  "eliminate_team",
  "restore_team",
  "create_topic",
]);

/**
 * Validates that a string is a well-formed HTTP or HTTPS URL.
 */
export function isValidHttpUrl(str: string): boolean {
  if (!str || typeof str !== "string") return false;
  try {
    const url = new URL(str.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates that a string is a legitimate GitHub repository URL:
 * - Must be HTTP or HTTPS
 * - Hostname must be github.com or www.github.com
 * - Must contain NO user credentials (e.g. user:pass@ or token@)
 * - Pathname must have EXACTLY two non-empty segments: owner and repository
 * - Path segments must not contain whitespace (raw or URI-encoded)
 * - Rejects generic domains (example.com, etc.), malformed paths, and subresource pages (/pulls, /blob, etc.)
 * - Preserves legitimate repository URLs with optional .git suffix, query strings, and fragments
 */
export function isValidGitHubRepoUrl(str: string): boolean {
  if (!str || typeof str !== "string") return false;
  const trimmed = str.trim();
  if (!trimmed) return false;

  // Reject strings containing whitespace
  if (/\s/.test(trimmed)) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  // Must be HTTP or HTTPS
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  // Reject credentials (e.g. user:pass@github.com or token@github.com)
  if (url.username || url.password) {
    return false;
  }

  // Host must be github.com or www.github.com
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return false;
  }

  // Require exactly two non-empty path segments: owner and repo
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return false;
  }

  const [rawOwner, rawRepo] = segments;
  if (!rawOwner || !rawRepo) return false;

  let decodedOwner: string;
  let decodedRepo: string;
  try {
    decodedOwner = decodeURIComponent(rawOwner);
    decodedRepo = decodeURIComponent(rawRepo);
  } catch {
    return false;
  }

  // Reject whitespace in decoded segments
  if (/\s/.test(decodedOwner) || /\s/.test(decodedRepo)) {
    return false;
  }

  // Reject invalid repository names like just ".git" or navigational paths
  if (
    decodedRepo === ".git" ||
    decodedRepo === "." ||
    decodedRepo === ".." ||
    decodedOwner === "." ||
    decodedOwner === ".."
  ) {
    return false;
  }

  return true;
}

/**
 * Validates slot assignment selection for a team:
 * - If team has no won slots -> error
 * - If requestedSlotId is provided -> must match one of the team's won slots
 * - If requestedSlotId is omitted:
 *   - Exactly 1 won slot -> acceptable to default to wonSlots[0].id
 *   - Multiple won slots -> requires explicit slotId selection
 */
export function validateSlotSelection(
  wonSlots: Array<{ id: string }>,
  requestedSlotId?: string | null
): { valid: boolean; slotId?: string; error?: string } {
  if (!wonSlots || wonSlots.length === 0) {
    return {
      valid: false,
      error: "Your team does not own an assigned question yet. Win an auction item first.",
    };
  }

  if (requestedSlotId) {
    const match = wonSlots.find((s) => s.id === requestedSlotId);
    if (!match) {
      return {
        valid: false,
        error: "That question is not assigned to your team.",
      };
    }
    return { valid: true, slotId: match.id };
  }

  if (wonSlots.length === 1) {
    return { valid: true, slotId: wonSlots[0].id };
  }

  return {
    valid: false,
    error:
      "Your team has won multiple assigned questions. You must explicitly select which question (slotId) you are submitting for.",
  };
}

/**
 * Validates evaluation score:
 * - Accepts finite numeric values from 0 through 100 inclusive.
 * - Accepts numeric strings only if they contain a valid numeric representation.
 * - Rejects whitespace-only strings, booleans, null, undefined, NaN, Infinity, and values outside the permitted range.
 * - Never silently converts invalid input to zero.
 */
export function validateEvaluationScore(score: unknown): {
  valid: boolean;
  score?: number;
  error?: string;
} {
  if (score === null || score === undefined || typeof score === "boolean") {
    return { valid: false, error: "Score is required and must be a number." };
  }

  let num: number;

  if (typeof score === "number") {
    if (!Number.isFinite(score)) {
      return { valid: false, error: "Score must be a finite number." };
    }
    num = score;
  } else if (typeof score === "string") {
    const trimmed = score.trim();
    if (!trimmed) {
      return { valid: false, error: "Score is required and must be a number." };
    }
    // Accept only valid decimal numeric representations
    // Rejects hexadecimal (0x..), binary (0b..), multiple dots, strings like "100px", "1 2"
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      return { valid: false, error: "Score must be a valid numeric string." };
    }
    num = Number(trimmed);
    if (!Number.isFinite(num)) {
      return { valid: false, error: "Score must be a finite number." };
    }
  } else {
    // Arrays, objects, symbols, functions, etc.
    return { valid: false, error: "Score must be a number or numeric string." };
  }

  if (num < 0 || num > 100) {
    return { valid: false, error: "Evaluation score must be between 0 and 100." };
  }

  return { valid: true, score: num };
}

/**
 * Validates role-based authorization for administrative and judging actions.
 * - admin may execute only actions explicitly listed in ADMIN_ONLY_ACTIONS or JUDGE_ALLOWED_ACTIONS.
 * - judge may execute only actions explicitly listed in JUDGE_ALLOWED_ACTIONS.
 * - Unknown actions must be denied for both roles.
 * - Missing, null, or unsupported roles must be denied.
 */
export function isActionPermittedForRole(
  action: string,
  role?: string | null
): { allowed: boolean; error?: string } {
  if (!action || typeof action !== "string") {
    return {
      allowed: false,
      error: "An action is required.",
    };
  }

  if (!role || (role !== "admin" && role !== "judge")) {
    return {
      allowed: false,
      error: "Admin or Judge access required for this action.",
    };
  }

  if (role === "admin") {
    if (ADMIN_ONLY_ACTIONS.has(action) || JUDGE_ALLOWED_ACTIONS.has(action)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      error: `Unknown action: ${action}`,
    };
  }

  // Judge role
  if (JUDGE_ALLOWED_ACTIONS.has(action)) {
    return { allowed: true };
  }

  if (ADMIN_ONLY_ACTIONS.has(action)) {
    return {
      allowed: false,
      error: "Admin access required for this action.",
    };
  }

  return {
    allowed: false,
    error: `Unknown action: ${action}`,
  };
}

export const EDITABLE_SUBMISSION_STATUSES = ["submitted", "evaluating"] as const;
export type EditableSubmissionStatus = (typeof EDITABLE_SUBMISSION_STATUSES)[number];

/**
 * Checks whether a submission status is currently eligible for participant editing.
 * Only 'submitted' and 'evaluating' are editable; 'approved' and 'rejected' are locked.
 */
export function isSubmissionStatusEditable(status?: string | null): boolean {
  if (!status || typeof status !== "string") return false;
  return (EDITABLE_SUBMISSION_STATUSES as readonly string[]).includes(status);
}

/**
 * State machine validation for submissions:
 * - 'submitted': can be updated, approved, or rejected.
 * - 'approved': is locked against updates, rejections, and direct reopening.
 * - 'rejected': cannot be updated until reopened; cannot be approved directly.
 */
export function validateSubmissionStateTransition(
  currentStatus: string,
  action: "update" | "approve" | "reject" | "reopen"
): { allowed: boolean; error?: string } {
  switch (action) {
    case "update":
      if (currentStatus === "approved") {
        return {
          allowed: false,
          error: "This submission has already been approved by judges and is locked against modifications.",
        };
      }
      if (currentStatus === "rejected") {
        return {
          allowed: false,
          error: "This submission was rejected by judges. Resubmission requires judge/admin authorization.",
        };
      }
      if (!isSubmissionStatusEditable(currentStatus)) {
        return {
          allowed: false,
          error: `Submissions with status "${currentStatus}" cannot be modified.`,
        };
      }
      return { allowed: true };

    case "approve":
      if (currentStatus === "rejected") {
        return {
          allowed: false,
          error: "Cannot approve a rejected submission directly. It must be reopened first.",
        };
      }
      return { allowed: true };

    case "reject":
      if (currentStatus === "approved") {
        return {
          allowed: false,
          error: "Cannot reject an already approved submission.",
        };
      }
      return { allowed: true };

    case "reopen":
      if (currentStatus !== "rejected") {
        return {
          allowed: false,
          error: `Only rejected submissions can be reopened for revision (current status: ${currentStatus}).`,
        };
      }
      return { allowed: true };

    default:
      return { allowed: false, error: `Invalid transition action: ${action}` };
  }
}

/**
 * Rule Book §9.8 unspent auction budget bonus points calculation:
 * 1 bonus point for every 10 unspent coins, rounded down.
 * Negative balance or zero yields 0 bonus points.
 */
export function calculateRuleBook98Bonus(remainingBudget: number): number {
  const coins = Number(remainingBudget) || 0;
  return Math.floor(Math.max(0, coins) / 10);
}
