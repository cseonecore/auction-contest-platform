/**
 * Team Mascot avatar resolution utility for Bid2Build.
 * Maps team identities to the 10 mascot character assets located in /characters/.
 */

const MASCOT_COUNT = 10

export function getMascotSrc(identifier?: string | null, index?: number): string {
  if (typeof index === 'number' && index >= 0) {
    const num = (index % MASCOT_COUNT) + 1
    return `/characters/Character-${num.toString().padStart(2, '0')}.png`
  }

  if (!identifier) {
    return `/characters/Character-01.png`
  }

  // Consistent hash for stable mascot assignment per team
  let hash = 0
  for (let i = 0; i < identifier.length; i++) {
    hash = (hash * 31 + identifier.charCodeAt(i)) >>> 0
  }
  const mascotNum = (hash % MASCOT_COUNT) + 1
  return `/characters/Character-${mascotNum.toString().padStart(2, '0')}.png`
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
