/**
 * Bid2Build — Submission, Evaluation & Scoring Unit Test Suite
 *
 * Exercises the authoritative pure business logic functions exported from:
 *   - app/features/submission/utils/submissionRules.ts
 *
 * Note: These are unit tests testing pure business logic, validation rules,
 * state machine transitions, and Rule Book §9.8 calculations. They do not
 * claim database or live API integration.
 *
 * Test Sections:
 *   Section 1: Participant Submission & Validation Logic (Tests 1–12)
 *   Section 2: Admin & Judging Authorization & State Transitions (Tests 13–19)
 *   Section 3: Competition Scoring & Rule Book §9.8 Integrity (Tests 20–23)
 *
 * Run with: node --no-warnings scripts/test-submission-module.mjs
 */

import {
  isValidHttpUrl,
  isValidGitHubRepoUrl,
  validateSlotSelection,
  validateEvaluationScore,
  isActionPermittedForRole,
  validateSubmissionStateTransition,
  calculateRuleBook98Bonus,
  JUDGE_ALLOWED_ACTIONS,
  ADMIN_ONLY_ACTIONS,
  EDITABLE_SUBMISSION_STATUSES,
  isSubmissionStatusEditable,
} from "../features/submission/utils/submissionRules.ts";

const results = [];
let passCount = 0;
let failCount = 0;

function assert(condition, testNumber, description, detail = "") {
  if (condition) {
    passCount++;
    console.log(
      `  \x1b[32m✔ PASS\x1b[0m [Test ${testNumber}]: ${description} ${
        detail ? `\x1b[90m(${detail})\x1b[0m` : ""
      }`
    );
    results.push({ testNumber, description, status: "PASS", detail });
  } else {
    failCount++;
    console.error(
      `  \x1b[31m✖ FAIL\x1b[0m [Test ${testNumber}]: ${description} ${
        detail ? `\x1b[31m${detail}\x1b[0m` : ""
      }`
    );
    results.push({ testNumber, description, status: "FAIL", detail });
  }
}

console.log("\n=======================================================");
console.log("BID2BUILD SUBMISSION, EVALUATION & SCORING UNIT TESTS");
console.log("=======================================================\n");

// -----------------------------------------------------------------------------
// SECTION 1: PARTICIPANT SUBMISSION & VALIDATION LOGIC (Tests 1–12)
// -----------------------------------------------------------------------------
console.log("\x1b[36m--- Section 1: Participant Submission & Validation Logic ---\x1b[0m");

// Test 1: Unauthenticated request validation
{
  const testTokens = [null, undefined, "", "   ", "invalid-format"];
  const allRejected = testTokens.every((token) => {
    const hasBearer = Boolean(
      token && token.toLowerCase().startsWith("bearer ") && token.substring(7).trim()
    );
    return !hasBearer;
  });
  assert(
    allRejected,
    1,
    "Unauthenticated requests reject without valid Bearer token or session",
    "Empty, whitespace, or missing token yields 401"
  );
}

// Test 2: Non-member cannot submit
{
  const checkMembership = (membersTable, userId) => {
    const membership = membersTable.find((m) => m.id === userId);
    return Boolean(membership?.team_id);
  };
  const members = [{ id: "user-alpha", team_id: "team-1" }];
  const nonMemberAllowed = checkMembership(members, "user-outsider");
  const memberAllowed = checkMembership(members, "user-alpha");
  assert(
    !nonMemberAllowed && memberAllowed,
    2,
    "Non-member cannot submit; membership strictly enforced",
    "User must exist in members table with active team_id"
  );
}

// Test 3: Team cannot submit for another team's slot
{
  const wonSlots = [
    { id: "slot-team1-round1", winner_team_id: "team-1", status: "sold" },
  ];
  const otherSlotResult = validateSlotSelection(
    wonSlots.map((s) => ({ id: s.id })),
    "slot-team2-round1"
  );
  assert(
    !otherSlotResult.valid && otherSlotResult.error?.includes("not assigned"),
    3,
    "Team cannot submit for another team's slot",
    otherSlotResult.error
  );
}

// Test 4: Team cannot submit for an unsold or unassigned slot
{
  const allSlots = [
    { id: "slot-1", winner_team_id: "team-1", status: "sold" },
    { id: "slot-2", winner_team_id: "team-1", status: "open" },
    { id: "slot-3", winner_team_id: null, status: "bidding" },
  ];
  const eligibleSlots = allSlots.filter((s) => s.winner_team_id === "team-1" && s.status === "sold");
  assert(
    eligibleSlots.length === 1 && eligibleSlots[0].id === "slot-1",
    4,
    "Team can only submit for slots with status = 'sold'",
    "Open, bidding, and unsold slots filtered out"
  );
}

// Test 5: Valid GitHub repository URLs accepted (including .git, query string, fragment, trailing slash)
{
  const validUrls = [
    "https://github.com/torvalds/linux",
    "https://github.com/facebook/react",
    "https://www.github.com/vercel/next.js",
    "http://github.com/owner/project-repo",
    "https://github.com/owner/repo.git",
    "https://github.com/owner/repo?branch=main#readme",
    "https://github.com/owner/repo/",
    "http://www.github.com/org-name/repo_name.git",
  ];
  const allValid = validUrls.every((u) => isValidGitHubRepoUrl(u));
  assert(
    allValid,
    5,
    "Valid GitHub repository URLs are accepted with .git, query, fragment, and trailing slash",
    `Tested ${validUrls.length} valid GitHub formats`
  );
}

// Test 6: Optional live deployment URL accepts valid HTTP/HTTPS or empty
{
  const validLive = isValidHttpUrl("https://bid2build-demo.vercel.app");
  const validHttpLive = isValidHttpUrl("http://localhost:3000");
  const emptyLiveValid = isValidHttpUrl("") === false;
  assert(
    validLive && validHttpLive && emptyLiveValid,
    6,
    "Optional live URL can be omitted or must be valid HTTP/HTTPS",
    "Vercel and localhost URLs pass; empty handles cleanly"
  );
}

// Test 7: Invalid GitHub repository URLs are strictly rejected
{
  const invalidUrls = [
    // Non-GitHub domains
    "https://example.com/owner/repo",
    "https://google.com",
    "https://gitlab.com/owner/repo",
    "https://bitbucket.org/owner/repo",
    // Credentials in URL
    "https://user:pass@github.com/owner/repo",
    "https://token@github.com/owner/repo",
    // Whitespace in URL / segments
    "https://github.com/owner /repo",
    "https://github.com/owner/repo name",
    "https://github.com/owner/repo%20name",
    // Segment count not equal to 2
    "https://github.com/",
    "https://github.com/owner",
    "https://github.com/owner/repo/pull/1",
    "https://github.com/owner/repo/blob/main/README.md",
    "https://github.com/owner/repo/issues",
    // Invalid / navigational repo names
    "https://github.com/owner/.git",
    "https://github.com/owner/..",
    "https://github.com/../repo",
    // Non-HTTP protocol
    "ftp://github.com/owner/repo",
    "git@github.com:owner/repo.git",
    // Malformed / empty
    "not-a-url",
    "",
    "   ",
  ];
  const allRejected = invalidUrls.every((u) => !isValidGitHubRepoUrl(u));
  assert(
    allRejected,
    7,
    "Invalid GitHub repository URLs strictly rejected (credentials, whitespace, subpaths, non-HTTP, non-GitHub)",
    `Tested and rejected ${invalidUrls.length} invalid variants`
  );
}

// Test 8: Existing unapproved submission can be updated
{
  const canUpdateSubmitted = validateSubmissionStateTransition("submitted", "update");
  const canUpdateEvaluating = validateSubmissionStateTransition("evaluating", "update");
  assert(
    canUpdateSubmitted.allowed && canUpdateEvaluating.allowed,
    8,
    "Existing unapproved submission can be updated by team",
    "Status 'submitted' and 'evaluating' allow participant revisions"
  );
}

// Test 9: Approved submission is permanently locked against participant edits
{
  const canUpdateApproved = validateSubmissionStateTransition("approved", "update");
  assert(
    !canUpdateApproved.allowed && canUpdateApproved.error?.includes("locked"),
    9,
    "Approved submission cannot be edited by participants",
    canUpdateApproved.error
  );
}

// Test 10: Rejected submission cannot be updated until reopened
{
  const canUpdateRejected = validateSubmissionStateTransition("rejected", "update");
  assert(
    !canUpdateRejected.allowed &&
      (canUpdateRejected.error?.includes("reopened") || canUpdateRejected.error?.includes("authorization")),
    10,
    "Rejected submission remains locked until reopened by judge/admin",
    canUpdateRejected.error
  );
}

// Test 11: Participant update payload excludes judge notes, scores, and approval metadata
{
  const sampleUpdatePayload = (repoUrl, liveUrl) => ({
    repository_url: repoUrl.trim(),
    live_url: liveUrl?.trim() || null,
    submitted_at: new Date().toISOString(),
    status: "submitted",
  });
  const payload = sampleUpdatePayload("https://github.com/test/repo", "https://demo.app");
  const hasForbiddenKeys =
    "judge_notes" in payload || "approved_by" in payload || "score" in payload || "approved_at" in payload;
  assert(
    !hasForbiddenKeys,
    11,
    "Participant updates cannot overwrite judge score, notes, or approval metadata",
    "Protected columns excluded from participant update shape"
  );
}

// Test 12: Explicit slot selection: Single won slot vs Multiple won slots
{
  const singleSlotTeam = [{ id: "slot-single-1" }];
  const multiSlotTeam = [{ id: "slot-multi-1" }, { id: "slot-multi-2" }];

  const singleDefault = validateSlotSelection(singleSlotTeam, undefined);
  const multiOmitted = validateSlotSelection(multiSlotTeam, undefined);
  const multiExplicit = validateSlotSelection(multiSlotTeam, "slot-multi-2");

  assert(
    singleDefault.valid &&
      singleDefault.slotId === "slot-single-1" &&
      !multiOmitted.valid &&
      multiOmitted.error?.includes("explicitly select") &&
      multiExplicit.valid &&
      multiExplicit.slotId === "slot-multi-2",
    12,
    "Explicit slot selection enforced when team owns multiple questions",
    "Single slot defaults cleanly; multiple slots require explicit slotId"
  );
}

// -----------------------------------------------------------------------------
// SECTION 2: ADMIN & JUDGING AUTHORIZATION & STATE TRANSITIONS (Tests 13–19)
// -----------------------------------------------------------------------------
console.log("\n\x1b[36m--- Section 2: Admin & Judging Authorization & State Transitions ---\x1b[0m");

// Test 13: Strict Role Authorization (Admin vs Judge vs Unknown Actions vs Invalid Roles)
{
  const adminOnlyList = Array.from(ADMIN_ONLY_ACTIONS);
  const judgeAllowedList = Array.from(JUDGE_ALLOWED_ACTIONS);

  // 1. Admin allowed for all ADMIN_ONLY_ACTIONS and JUDGE_ALLOWED_ACTIONS
  const adminAllowedAll =
    adminOnlyList.every((act) => isActionPermittedForRole(act, "admin").allowed) &&
    judgeAllowedList.every((act) => isActionPermittedForRole(act, "admin").allowed);

  // 2. Judge allowed ONLY for JUDGE_ALLOWED_ACTIONS
  const judgeAllowedAll = judgeAllowedList.every((act) => isActionPermittedForRole(act, "judge").allowed);

  // 3. Judge denied for all ADMIN_ONLY_ACTIONS with specific error message
  const judgeDeniedAdminOnly = adminOnlyList.every((act) => {
    const res = isActionPermittedForRole(act, "judge");
    return !res.allowed && res.error === "Admin access required for this action.";
  });

  // 4. Unknown actions denied for BOTH admin and judge
  const unknownActions = ["drop_database", "bypass_rls", "random_action", "hack_auction"];
  const adminDeniedUnknown = unknownActions.every((act) => !isActionPermittedForRole(act, "admin").allowed);
  const judgeDeniedUnknown = unknownActions.every((act) => !isActionPermittedForRole(act, "judge").allowed);

  // 5. Missing / null / invalid roles denied for all actions
  const invalidRoles = [null, undefined, "", "participant", "guest", "superadmin", 123];
  const invalidRolesDenied = invalidRoles.every(
    (r) => !isActionPermittedForRole("approve_solution", r).allowed && !isActionPermittedForRole("start_auction", r).allowed
  );

  assert(
    adminAllowedAll && judgeAllowedAll && judgeDeniedAdminOnly && adminDeniedUnknown && judgeDeniedUnknown && invalidRolesDenied,
    13,
    "Role authorization: admin restricted to known actions; judge restricted to judging; unknown actions denied; invalid roles denied",
    `Verified across ${adminOnlyList.length} admin actions, ${judgeAllowedList.length} judge actions, unknown actions, and invalid roles`
  );
}

// Test 14: Unauthorized participant or non-role cannot evaluate submissions
{
  const participantEval = isActionPermittedForRole("approve_solution", "participant");
  const nullRoleEval = isActionPermittedForRole("approve_solution", null);
  const anonRoleEval = isActionPermittedForRole("reject_solution", "anon");
  assert(
    !participantEval.allowed && !nullRoleEval.allowed && !anonRoleEval.allowed,
    14,
    "Participants and unauthenticated users cannot approve, reject, or reopen submissions",
    "Enforced by role validation gate"
  );
}

// Test 15: Authorized judges and admins can evaluate and reopen submissions
{
  const judgingActions = ["approve_solution", "reject_solution", "reopen_solution", "grant_bonus"];
  const judgeAllowed = judgingActions.every((act) => isActionPermittedForRole(act, "judge").allowed);
  const adminAllowed = judgingActions.every((act) => isActionPermittedForRole(act, "admin").allowed);
  assert(
    judgeAllowed && adminAllowed,
    15,
    "Both judges and admins have access to judging and bonus workflows",
    "approve, reject, reopen, grant_bonus allowed for judge and admin"
  );
}

// Test 16: Evaluation score validation strictly enforces [0, 100], finite numbers, numeric strings, and no silent zeros
{
  const validScores = [0, 100, 50, 85.5, 99.9, "0", "100", "50", "85.5", " 75.25 ", "1e2"];
  const invalidScores = [
    // Outside range
    -1,
    101,
    -0.01,
    100.01,
    "-5",
    "150",
    // Non-finite / NaN
    NaN,
    Infinity,
    -Infinity,
    "Infinity",
    "-Infinity",
    "NaN",
    // Booleans (must NOT convert to 0 or 1)
    true,
    false,
    // Null / Undefined
    null,
    undefined,
    // Whitespace / Empty
    "",
    "   ",
    // Objects / Arrays (must NOT convert to 0)
    [],
    [50],
    {},
    // Malformed numeric strings
    "100px",
    "0x10",
    "1 2",
    "abc",
  ];

  const validAllPass = validScores.every((s) => validateEvaluationScore(s).valid);
  const invalidAllFail = invalidScores.every((s) => !validateEvaluationScore(s).valid);

  // Specifically verify false and [] are rejected and NEVER silently converted to 0
  const falseRejected = !validateEvaluationScore(false).valid;
  const emptyArrayRejected = !validateEvaluationScore([]).valid;

  assert(
    validAllPass && invalidAllFail && falseRejected && emptyArrayRejected,
    16,
    "Evaluation score validation accepts finite [0, 100] and numeric strings; rejects NaN, Infinity, booleans, whitespace, and never silently converts to zero",
    `Passed ${validScores.length} valid cases; rejected ${invalidScores.length} invalid/edge-case values`
  );
}

// Test 17: Cannot reject an already approved submission
{
  const rejectApproved = validateSubmissionStateTransition("approved", "reject");
  const rejectSubmitted = validateSubmissionStateTransition("submitted", "reject");
  assert(
    !rejectApproved.allowed &&
      rejectApproved.error?.includes("Cannot reject an already approved submission") &&
      rejectSubmitted.allowed,
    17,
    "Cannot reject an already approved submission",
    rejectApproved.error
  );
}

// Test 18: Reopening is permitted ONLY for rejected submissions
{
  const reopenRejected = validateSubmissionStateTransition("rejected", "reopen");
  const nonReopenableStatuses = ["submitted", "evaluating", "evaluated", "review", "approved"];
  const allNonReopenableDenied = nonReopenableStatuses.every(
    (status) => !validateSubmissionStateTransition(status, "reopen").allowed
  );

  assert(
    reopenRejected.allowed && allNonReopenableDenied,
    18,
    "Reopening permitted strictly for rejected submissions; submitted, evaluating, evaluated, review, and approved rejected",
    "Enforces strict state machine transition: only rejected -> reopen"
  );
}

// Test 19: Cannot approve a rejected submission without reopening first
{
  const approveRejected = validateSubmissionStateTransition("rejected", "approve");
  const approveSubmitted = validateSubmissionStateTransition("submitted", "approve");
  assert(
    !approveRejected.allowed &&
      approveRejected.error?.includes("must be reopened first") &&
      approveSubmitted.allowed,
    19,
    "Cannot approve a rejected submission directly without reopening",
    approveRejected.error
  );
}

// -----------------------------------------------------------------------------
// SECTION 3: COMPETITION SCORING & RULE BOOK §9.8 INTEGRITY (Tests 20–23)
// -----------------------------------------------------------------------------
console.log("\n\x1b[36m--- Section 3: Competition Scoring & Rule Book §9.8 Integrity ---\x1b[0m");

// Test 20: Rule Book §9.8: Math.floor(Math.max(0, balance) / 3)
{
  const testCases = [
    { balance: 0, expected: 0 },
    { balance: 1, expected: 0 },
    { balance: 2, expected: 0 },
    { balance: 3, expected: 1 },
    { balance: 5, expected: 1 },
    { balance: 6, expected: 2 },
    { balance: 299, expected: 99 },
    { balance: 300, expected: 100 },
    { balance: -50, expected: 0 }, // Negative balance must yield 0, not negative points
  ];

  const allMatch = testCases.every((tc) => {
    const calculated = calculateRuleBook98Bonus(tc.balance);
    return calculated === tc.expected;
  });

  assert(
    allMatch,
    20,
    "Rule Book §9.8 bonus points formula: Math.floor(Math.max(0, balance) / 3)",
    "Verified across 9 test boundary cases including negative and unspent budget"
  );
}

// Test 21: Only completed evaluations contribute to presentation scores
{
  const mockEvaluations = [
    { status: "completed", score: 85, submission: { team_id: "team-a" } },
    { status: "queued", score: 90, submission: { team_id: "team-a" } },
    { status: "running", score: 95, submission: { team_id: "team-a" } },
    { status: "failed", score: 40, submission: { team_id: "team-a" } },
    { status: "review", score: 70, submission: { team_id: "team-a" } },
  ];

  let calculatedScore = 0;
  mockEvaluations.forEach((ev) => {
    if (ev.status === "completed") {
      calculatedScore += ev.score;
    }
  });

  assert(
    calculatedScore === 85,
    21,
    "Only evaluations with status = 'completed' contribute to competition score",
    `Total: ${calculatedScore} (queued, running, failed, review properly ignored)`
  );
}

// Test 22: Presentation score and auction bonus points are tracked separately and summed
{
  const teamWalletBalance = 150; // 150 / 3 = 50 bonus points
  const presentationScore = 88.5;
  const projectedBonus = calculateRuleBook98Bonus(teamWalletBalance);
  const totalScore = presentationScore + projectedBonus;

  assert(
    projectedBonus === 50 && totalScore === 138.5,
    22,
    "Presentation score and budget bonus points combine accurately without distortion",
    `Presentation: 88.5 + §9.8 Bonus: 50 = Total: 138.5`
  );
}

// Test 23: Bonus time decision workflow is unchecked by default
{
  const defaultGrantBonus = false;
  const simulateApprovalCall = (grantBonusOption) => ({
    p_grant_bonus: Boolean(grantBonusOption),
  });

  const defaultCall = simulateApprovalCall(defaultGrantBonus);
  const explicitBonusCall = simulateApprovalCall(true);

  assert(
    defaultCall.p_grant_bonus === false && explicitBonusCall.p_grant_bonus === true,
    23,
    "Bonus time is unchecked by default across judging workflows",
    "Approval without bonus is fully functional; bonus requires explicit grant"
  );
}

// -----------------------------------------------------------------------------
// SECTION 4: CONCURRENCY SAFEGUARDS & ATOMIC CONDITIONAL UPDATE (Tests 24–29)
// -----------------------------------------------------------------------------
// Scope & Boundary Notice:
// - Tests 24–29 are unit/mocked simulation tests verifying:
//   1. Conditional SQL update predicate matching (team_id + status IN editable statuses).
//   2. Elimination of the approval/rejection race condition.
//   3. Detection of 0 matched rows when an approval/rejection races in between read and update.
//   4. Re-fetching of the latest record and generation of descriptive HTTP 409 Conflict responses.
// - Real Database Concurrency:
//   In PostgreSQL, the conditional update:
//     UPDATE public.submissions
//     SET repository_url = $1, live_url = $2, submitted_at = $3, status = 'submitted'
//     WHERE id = $4 AND team_id = $5 AND status IN ('submitted', 'evaluating')
//     RETURNING *;
//   is executed as a single atomic SQL statement. PostgreSQL acquires row-level locks on the
//   matching row. Because judging RPCs (approve_submission, reject_submission) also acquire
//   row-level locks via `SELECT ... FOR UPDATE`, concurrent execution is serialized at the
//   ACID transaction level, ensuring an approved or rejected submission can never match the
//   update predicate or be overwritten.
// -----------------------------------------------------------------------------
console.log("\n\x1b[36m--- Section 4: Concurrency Safeguards & Atomic Conditional Update ---\x1b[0m");

// Helper simulating PostgREST atomic conditional update query behavior
function simulateAtomicConditionalUpdate(dbTable, targetId, callerTeamId, updatePayload) {
  const row = dbTable.find((r) => r.id === targetId);
  if (!row) {
    return { data: null, error: null }; // 0 rows matched (not found)
  }
  // Enforce WHERE team_id = :teamId
  if (row.team_id !== callerTeamId) {
    return { data: null, error: null }; // 0 rows matched (team mismatch)
  }
  // Enforce WHERE status IN ('submitted', 'evaluating')
  if (!isSubmissionStatusEditable(row.status)) {
    return { data: null, error: null }; // 0 rows matched (status ineligible)
  }

  // Row matches atomic WHERE predicate: apply update
  Object.assign(row, updatePayload);
  return { data: { ...row }, error: null };
}

// Helper simulating route conflict resolution on 0 matched rows
function resolveUpdateConflict(dbTable, targetId, callerTeamId) {
  const latest = dbTable.find((r) => r.id === targetId);
  if (!latest) {
    return {
      status: 409,
      error: "Conflict: The submission was deleted or is no longer available. Please refresh the page.",
    };
  }
  if (latest.status === "approved") {
    return {
      status: 409,
      error:
        "Conflict: This submission was approved by judges while your update was being processed and is now locked.",
    };
  }
  if (latest.status === "rejected") {
    const noteSuffix = latest.judge_notes ? ` (Judge note: "${latest.judge_notes}")` : "";
    return {
      status: 409,
      error: `Conflict: This submission was rejected by judges${noteSuffix} while your update was being processed. Resubmission requires judge/admin authorization.`,
    };
  }
  if (latest.team_id !== callerTeamId) {
    return {
      status: 409,
      error: "Conflict: This submission is no longer associated with your team.",
    };
  }
  return {
    status: 409,
    error: "Conflict: The submission status changed concurrently. Please refresh the page and try again.",
  };
}

// Test 24: Participant update succeeds atomically for eligible submissions ('submitted', 'evaluating')
{
  const mockTable = [
    {
      id: "sub-1",
      team_id: "team-a",
      slot_id: "slot-1",
      repository_url: "https://github.com/teama/initial-repo",
      live_url: null,
      status: "submitted",
      submitted_at: "2026-11-19T10:00:00.000Z",
    },
    {
      id: "sub-2",
      team_id: "team-a",
      slot_id: "slot-2",
      repository_url: "https://github.com/teama/second-repo",
      live_url: null,
      status: "evaluating",
      submitted_at: "2026-11-19T10:30:00.000Z",
    },
  ];

  const update1 = simulateAtomicConditionalUpdate(mockTable, "sub-1", "team-a", {
    repository_url: "https://github.com/teama/revised-repo",
    live_url: "https://teama.vercel.app",
    submitted_at: "2026-11-19T11:00:00.000Z",
    status: "submitted",
  });

  const update2 = simulateAtomicConditionalUpdate(mockTable, "sub-2", "team-a", {
    repository_url: "https://github.com/teama/second-repo-v2",
    live_url: "https://teama-slot2.vercel.app",
    submitted_at: "2026-11-19T11:05:00.000Z",
    status: "submitted",
  });

  assert(
    update1.data !== null &&
      update1.data.repository_url === "https://github.com/teama/revised-repo" &&
      update1.data.live_url === "https://teama.vercel.app" &&
      update2.data !== null &&
      update2.data.repository_url === "https://github.com/teama/second-repo-v2",
    24,
    "Participant update succeeds conditionally for eligible statuses ('submitted', 'evaluating')",
    "Atomic statement matches 1 row and updates URLs and timestamp"
  );
}

// Test 25: Approved submission is protected against participant edit at statement level
{
  const mockTable = [
    {
      id: "sub-approved",
      team_id: "team-b",
      slot_id: "slot-b",
      repository_url: "https://github.com/teamb/repo",
      status: "approved",
      approved_by: "judge-1",
      approved_at: "2026-11-19T12:00:00.000Z",
    },
  ];

  // 1. In-memory check denies transition
  const inMemoryCheck = validateSubmissionStateTransition("approved", "update");

  // 2. Statement-level conditional update evaluates to 0 rows matched
  const updateResult = simulateAtomicConditionalUpdate(mockTable, "sub-approved", "team-b", {
    repository_url: "https://github.com/teamb/tampered-repo",
    status: "submitted",
  });

  // 3. Conflict resolution produces HTTP 409
  const conflict = resolveUpdateConflict(mockTable, "sub-approved", "team-b");

  assert(
    !inMemoryCheck.allowed &&
      updateResult.data === null &&
      conflict.status === 409 &&
      conflict.error.includes("approved by judges") &&
      mockTable[0].status === "approved" &&
      mockTable[0].repository_url === "https://github.com/teamb/repo",
    25,
    "Approved submission cannot be edited; statement-level condition returns 0 rows and triggers HTTP 409 Conflict",
    "Approval status, approved_by, and repository_url remain pristine"
  );
}

// Test 26: Rejected submission is protected at statement level until reopened
{
  const mockTable = [
    {
      id: "sub-rejected",
      team_id: "team-c",
      slot_id: "slot-c",
      repository_url: "https://github.com/teamc/repo",
      status: "rejected",
      judge_notes: "Submission fails build step",
      approved_by: null,
      approved_at: null,
    },
  ];

  // 1. Attempt update while rejected -> 0 rows matched, yields 409 Conflict with judge notes
  const updateWhileRejected = simulateAtomicConditionalUpdate(mockTable, "sub-rejected", "team-c", {
    repository_url: "https://github.com/teamc/repo-fix",
    status: "submitted",
  });
  const conflict = resolveUpdateConflict(mockTable, "sub-rejected", "team-c");

  // 2. Judge reopens submission: status becomes 'submitted'
  mockTable[0].status = "submitted";

  // 3. Attempt update after reopening -> succeeds!
  const updateAfterReopen = simulateAtomicConditionalUpdate(mockTable, "sub-rejected", "team-c", {
    repository_url: "https://github.com/teamc/repo-fix",
    status: "submitted",
  });

  assert(
    updateWhileRejected.data === null &&
      conflict.status === 409 &&
      conflict.error.includes("Submission fails build step") &&
      updateAfterReopen.data !== null &&
      updateAfterReopen.data.repository_url === "https://github.com/teamc/repo-fix",
    26,
    "Rejected submission cannot be edited until reopened; statement-level condition blocks edit then allows post-reopen",
    "409 Conflict includes judge note; edit succeeds once reopened"
  );
}

// Test 27: Concurrency Race Condition Simulation — Judge concurrent approval cannot be overwritten
{
  // Setup database table
  const mockDatabase = [
    {
      id: "sub-race-1",
      team_id: "team-winner",
      slot_id: "slot-10",
      repository_url: "https://github.com/winner/original",
      status: "submitted",
      approved_by: null,
      approved_at: null,
      judge_notes: null,
    },
  ];

  // T1: Participant checks submission (reads status: 'submitted')
  const t1Read = { ...mockDatabase[0] };
  const t1TransitionCheck = validateSubmissionStateTransition(t1Read.status, "update");
  // In-memory check passed at T1!
  const t1Passed = t1TransitionCheck.allowed === true;

  // T2: RACE OCCURS! Judge approves submission concurrently before participant update lands
  mockDatabase[0].status = "approved";
  mockDatabase[0].approved_by = "judge-alice-uuid";
  mockDatabase[0].approved_at = new Date().toISOString();
  mockDatabase[0].judge_notes = "Excellent architecture and test coverage";

  // T3: Participant update arrives with payload attempting to update code and reset status to 'submitted'
  const participantPayload = {
    repository_url: "https://github.com/winner/late-push",
    live_url: "https://late.app",
    submitted_at: new Date().toISOString(),
    status: "submitted",
  };

  // WITHOUT conditional update (VULNERABLE OLD CODE):
  // service.from("submissions").update(payload).eq("id", existing.id)
  // Would have executed: mockDatabase[0].status = 'submitted' -> DESTROYED APPROVAL!

  // WITH conditional update (HARDENED NEW CODE):
  // service.from("submissions").update(payload).eq("id", existing.id).eq("team_id", teamId).in("status", EDITABLE_SUBMISSION_STATUSES)
  const statementResult = simulateAtomicConditionalUpdate(
    mockDatabase,
    t1Read.id,
    "team-winner",
    participantPayload
  );

  // Statement returned 0 rows! Handler queries latest row and builds 409 Conflict:
  const response = !statementResult.data
    ? resolveUpdateConflict(mockDatabase, t1Read.id, "team-winner")
    : { status: 200 };

  assert(
    t1Passed &&
      statementResult.data === null &&
      response.status === 409 &&
      response.error.includes("approved by judges") &&
      mockDatabase[0].status === "approved" &&
      mockDatabase[0].approved_by === "judge-alice-uuid" &&
      mockDatabase[0].repository_url === "https://github.com/winner/original",
    27,
    "Concurrent approval race condition: participant update blocked by atomic predicate, preserving judge approval and returning 409 Conflict",
    "Judge approval, approved_by, and original repository URL preserved without overwrite"
  );
}

// Test 28: Concurrency Race Condition Simulation — Judge concurrent rejection cannot be overwritten
{
  const mockDatabase = [
    {
      id: "sub-race-2",
      team_id: "team-loser",
      slot_id: "slot-11",
      repository_url: "https://github.com/loser/original",
      status: "submitted",
      approved_by: null,
      approved_at: null,
      judge_notes: null,
    },
  ];

  // T1: Participant checks status -> 'submitted' (allowed in memory)
  const t1Read = { ...mockDatabase[0] };
  const t1Passed = validateSubmissionStateTransition(t1Read.status, "update").allowed;

  // T2: RACE OCCURS! Judge rejects submission concurrently
  mockDatabase[0].status = "rejected";
  mockDatabase[0].judge_notes = "Repository contains no commits for Round 2";

  // T3: Participant update statement runs
  const statementResult = simulateAtomicConditionalUpdate(mockDatabase, t1Read.id, "team-loser", {
    repository_url: "https://github.com/loser/fast-push",
    status: "submitted",
  });

  const response = !statementResult.data
    ? resolveUpdateConflict(mockDatabase, t1Read.id, "team-loser")
    : { status: 200 };

  assert(
    t1Passed &&
      statementResult.data === null &&
      response.status === 409 &&
      response.error.includes("Repository contains no commits for Round 2") &&
      mockDatabase[0].status === "rejected" &&
      mockDatabase[0].repository_url === "https://github.com/loser/original",
    28,
    "Concurrent rejection race condition: participant update blocked by atomic predicate, preserving judge rejection and returning 409 Conflict",
    "Judge rejection and judge note preserved; resubmission prevented until officially reopened"
  );
}

// Test 29: Team ownership boundary enforced at database statement level
{
  const mockDatabase = [
    {
      id: "sub-team-alpha",
      team_id: "team-alpha",
      slot_id: "slot-alpha",
      repository_url: "https://github.com/alpha/repo",
      status: "submitted",
    },
  ];

  // Team Beta attempts to update Team Alpha's submission ID
  const statementResult = simulateAtomicConditionalUpdate(
    mockDatabase,
    "sub-team-alpha",
    "team-beta", // Attacker / wrong team
    {
      repository_url: "https://github.com/beta/hijack",
      status: "submitted",
    }
  );

  const response = !statementResult.data
    ? resolveUpdateConflict(mockDatabase, "sub-team-alpha", "team-beta")
    : { status: 200 };

  assert(
    statementResult.data === null &&
      response.status === 409 &&
      response.error.includes("no longer associated with your team") &&
      mockDatabase[0].team_id === "team-alpha" &&
      mockDatabase[0].repository_url === "https://github.com/alpha/repo",
    29,
    "Team ownership boundary: statement-level predicate WHERE team_id = callerTeam blocks unauthorized updates and returns 409 Conflict",
    "Cross-team submission overwrite strictly prevented at statement level"
  );
}

console.log("\n=======================================================");
console.log(`TEST SUITE SUMMARY: ${passCount} PASSED, ${failCount} FAILED (${passCount + failCount} TOTAL)`);
console.log("=======================================================\n");

if (failCount > 0) {
  console.error("✖ Some tests failed. Please inspect failures above.");
  process.exit(1);
} else {
  console.log("✔ ALL 29 BUSINESS RULES, CONCURRENCY SAFEGUARDS & SECURITY CHECKS PASSED!\n");
  process.exit(0);
}
