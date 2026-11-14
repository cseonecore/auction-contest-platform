import type { CountdownState } from "@/types/auction"

/**
 * Calculates countdown state from a server timestamp string.
 *
 * Guaranteed to be server-time aligned:
 * - When end_time is updated in DB (+5s upon new bid), this function
 *   immediately recalculates remaining time from the new end_time.
 */
export function calculateCountdown(endTime: string | null | undefined): CountdownState {
  if (!endTime) {
    return {
      secondsLeft: 0,
      isExpired: true,
      isUrgent: false,
      isCritical: false,
    }
  }

  const endMs = new Date(endTime).getTime()
  const nowMs = Date.now()
  const diffMs = endMs - nowMs

  if (diffMs <= 0) {
    return {
      secondsLeft: 0,
      isExpired: true,
      isUrgent: false,
      isCritical: false,
    }
  }

  const secondsLeft = Math.ceil(diffMs / 1000)

  return {
    secondsLeft,
    isExpired: false,
    isUrgent: secondsLeft <= 5,    // Yellow alert
    isCritical: secondsLeft <= 3,  // Red pulsing alert
  }
}

/** Formats remaining seconds as standard MM:SS or double-digit SS. */
export function formatTimeDisplay(seconds: number): string {
  if (seconds <= 0) return "00:00"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

