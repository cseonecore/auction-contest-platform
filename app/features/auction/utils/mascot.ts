/**
 * Team Mascot avatar resolution utility for Bid2Build.
 * Maps team identities to the 10 mascot character assets located in /characters/.
 *
 * Canonical behavior: when a team has a character_index (1..10, from the
 * teams.character_index database column), the mascot is
 * `/characters/Character-0N.png` — the exact same file the /profile page
 * displays for that team. Fallbacks use a deterministic hash of the
 * identifier so every consumer agrees without extra state.
 */

const MASCOT_COUNT = 10;

/**
 * Returns the canonical mascot src for a team.
 * @param characterIndex The team's database character_index (1..10), when known.
 * @param fallbackIdentifier Team id or name used for the hash fallback.
 */
export function getTeamMascotSrc(characterIndex?: number | null, fallbackIdentifier?: string | null): string {
  if (
    typeof characterIndex === 'number' &&
    Number.isInteger(characterIndex) &&
    characterIndex >= 1 &&
    characterIndex <= MASCOT_COUNT
  ) {
    return `/characters/Character-${String(characterIndex).padStart(2, '0')}.png`;
  }

  // Deterministic fallback assignment from an identifier.
  const id = (fallbackIdentifier ?? String(characterIndex ?? '')).trim() || 'team';
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  const mascotNum = (hash % MASCOT_COUNT) + 1
  return `/characters/Character-${mascotNum.toString().padStart(2, '0')}.png`
}

/**
 * Legacy-compatible wrapper: resolves a mascot src.
 * Callers that used to pass `(id, index)` can keep passing the team's
 * characterIndex as the first argument and an identifier as fallback.
 */
export function getMascotSrc(characterIndex?: number | null, fallbackIdentifier?: string | null): string {
  return getTeamMascotSrc(characterIndex, fallbackIdentifier)
}

/**
 * Mascot background color palette for circular avatars
 */
export const MASCOT_BG_PALETTE = [
  'bg-amber-500/20 border-amber-500/40',
  'bg-emerald-500/20 border-emerald-500/40',
  'bg-sky-500/20 border-sky-500/40',
  'bg-purple-500/20 border-purple-500/40',
  'bg-rose-500/20 border-rose-500/40',
  'bg-indigo-500/20 border-indigo-500/40',
  'bg-orange-500/20 border-orange-500/40',
  'bg-teal-500/20 border-teal-500/40',
  'bg-violet-500/20 border-violet-500/40',
  'bg-fuchsia-500/20 border-fuchsia-500/40',
]
