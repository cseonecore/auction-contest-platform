/**
 * Preset bid buttons add their increment to the minimum legal next bid,
 * matching the existing "minimum next bid + selected raise" rule used by
 * the participant panel. The backend still validates the final amount.
 */
export const BID_PRESET_INCREMENTS = [20, 15, 10, 5] as const;

export function calculatePresetBid(
  minNextBid: number,
  increment: number
): number {
  const base = Number.isFinite(minNextBid) ? Math.max(0, Math.floor(minNextBid)) : 0;
  const raise = Number.isFinite(increment) ? Math.max(0, Math.floor(increment)) : 0;
  return base + raise;
}
