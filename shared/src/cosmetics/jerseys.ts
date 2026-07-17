/**
 * Team kits (idea.md §5): every bean wears a jersey picked in the lobby.
 * Shared so the SERVER can run the clash rule (two too-similar primaries ->
 * the later seat wears its away kit) and clients just paint what the state
 * says. This is the fallback colorway set — the real-team content pass
 * swaps names/colors later. Patterns stay solid|stripes|hoops; crests never.
 */

export type KitPattern = 'solid' | 'stripes' | 'hoops'

export interface KitColors {
  readonly primary: number
  readonly secondary: number
  readonly pattern: KitPattern
  readonly shorts: number
}

export interface Kit {
  readonly id: string
  readonly name: string
  readonly home: KitColors
  readonly away: KitColors
}

export const KITS: readonly Kit[] = [
  {
    id: 'crimson',
    name: 'Crimson Rovers',
    home: { primary: 0xd6453d, secondary: 0xefebe0, pattern: 'solid', shorts: 0xefebe0 },
    away: { primary: 0xf1e9d7, secondary: 0xd6453d, pattern: 'hoops', shorts: 0x4a443c },
  },
  {
    id: 'azure',
    name: 'Azure United',
    home: { primary: 0x4fa3d8, secondary: 0xefebe0, pattern: 'solid', shorts: 0x4a443c },
    away: { primary: 0x35567a, secondary: 0x4fa3d8, pattern: 'stripes', shorts: 0xefebe0 },
  },
  {
    id: 'amber',
    name: 'Amber Wasps',
    home: { primary: 0xefb53c, secondary: 0x4a443c, pattern: 'stripes', shorts: 0x4a443c },
    away: { primary: 0x4a443c, secondary: 0xefb53c, pattern: 'hoops', shorts: 0xefb53c },
  },
  {
    id: 'jade',
    name: 'Jade Celtic',
    home: { primary: 0x58ae7c, secondary: 0xefebe0, pattern: 'hoops', shorts: 0xefebe0 },
    away: { primary: 0x2e5c44, secondary: 0xd7cfa8, pattern: 'solid', shorts: 0x2e5c44 },
  },
  {
    id: 'violet',
    name: 'Violet Royale',
    home: { primary: 0x9678c8, secondary: 0xefebe0, pattern: 'solid', shorts: 0xefebe0 },
    away: { primary: 0xf1e9d7, secondary: 0x9678c8, pattern: 'stripes', shorts: 0x9678c8 },
  },
  {
    id: 'tangerine',
    name: 'Tangerine Total',
    home: { primary: 0xe98a2b, secondary: 0xefebe0, pattern: 'solid', shorts: 0xefebe0 },
    away: { primary: 0x5d7b8c, secondary: 0xe98a2b, pattern: 'hoops', shorts: 0x4a443c },
  },
  {
    id: 'rose',
    name: 'Rose Athletic',
    home: { primary: 0xd98aa6, secondary: 0x4a443c, pattern: 'hoops', shorts: 0x4a443c },
    away: { primary: 0x6e5560, secondary: 0xd98aa6, pattern: 'solid', shorts: 0xefebe0 },
  },
  {
    id: 'mono',
    name: 'Mono County',
    home: { primary: 0x4a443c, secondary: 0xefebe0, pattern: 'stripes', shorts: 0xefebe0 },
    away: { primary: 0xefebe0, secondary: 0x4a443c, pattern: 'solid', shorts: 0x4a443c },
  },
]

export const KIT_BY_ID: ReadonlyMap<string, Kit> = new Map(KITS.map((kit) => [kit.id, kit]))

/** per-seat kit for bots and players who never pick (matches the old SEAT_COLORS order) */
export const DEFAULT_KIT_IDS: readonly string[] = [
  'crimson',
  'azure',
  'amber',
  'jade',
  'violet',
  'tangerine',
]

export function kitColors(kitId: string, away: boolean): KitColors | null {
  const kit = KIT_BY_ID.get(kitId)
  if (!kit) return null
  return away ? kit.away : kit.home
}

function colorDistance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** primaries closer than this (rgb distance, 0..441) read as the same team —
 *  just under the tightest default pair (amber vs tangerine ≈ 47) */
export const KIT_CLASH_DISTANCE = 45

/**
 * The clash rule: walk seats in order; whoever's HOME primary sits too close
 * to an already-placed primary flips to their AWAY kit (best effort — an
 * away-vs-away clash keeps the away, it's still the more distinct option).
 * Returns the away flag per input index.
 */
export function resolveKitClashes(kitIds: readonly string[]): boolean[] {
  const placed: number[] = []
  const away: boolean[] = []
  for (const id of kitIds) {
    const kit = KIT_BY_ID.get(id)
    if (!kit) {
      away.push(false)
      continue
    }
    const clashes = (primary: number): boolean =>
      placed.some((other) => colorDistance(primary, other) < KIT_CLASH_DISTANCE)
    const useAway = clashes(kit.home.primary)
    away.push(useAway)
    placed.push(useAway ? kit.away.primary : kit.home.primary)
  }
  return away
}
