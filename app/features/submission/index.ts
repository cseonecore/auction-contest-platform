// Submission feature — barrel exports
// Follows the same pattern as features/auction/index.ts

// Hooks
export { useSubmissionSession } from "./hooks/useSubmissionSession"
export { useTeamDeadline } from "./hooks/useTeamDeadline"
export { useEvaluationStatus } from "./hooks/useEvaluationStatus"
export { useChallengeProblems } from "./hooks/useChallengeProblems"

// Utilities
export { submitOneSlot, submitBothSlots } from "./utils/submitProject"
export { submitSolution } from "./utils/submitSolution"

// Re-export types that consumers will need
export type {
  SubmissionSession,
} from "./hooks/useSubmissionSession"

export type {
  SubmitOneSlotParams,
  SubmitBothSlotsParams,
} from "./utils/submitProject"

export type {
  SubmitSolutionParams,
} from "./utils/submitSolution"

