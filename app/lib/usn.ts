/**
 * Accepted MITE USN formats across registration and login:
 *
 *   - 4MT24CS001 / 5MT24CS001 — senior students
 *   - MT26CS001               — first-year students (2026 intake onwards)
 */
export const USN_PATTERN = /^(?:[45]?MT)\d{2}[A-Z]{2}\d{3}$/i;

/** Short human-readable format hint used in validation messages. */
export const USN_FORMAT_HINT =
  "4MT2XBBMMM or MT2XBBMMM (e.g., 4MT24CS001 / MT26CS001)";

/** Trims, uppercases, and removes spaces/hyphens from a USN. */
export function normalizeUsn(usn: string): string {
  return usn.trim().replace(/[\s-]/g, "").toUpperCase();
}

/** Returns true when the USN matches an accepted MITE format. */
export function isValidUsn(usn: string): boolean {
  return USN_PATTERN.test(normalizeUsn(usn));
}
