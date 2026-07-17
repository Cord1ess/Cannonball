/**
 * Card data (idea.md §3): every card is a data entry. M3 ships the flow with
 * these as NAMES ONLY; M4 adds the ModifierStack that makes them do things.
 * The lists mirror the provisional set in idea.md — finalized in playtesting.
 */

export type CardPool = 'ability' | 'equipment' | 'advantage'
export type Rarity = 'common' | 'rare' | 'epic'

export interface CardDef {
  id: string
  name: string
  pool: CardPool
  rarity: Rarity
  blurb: string
}

export const DRAFT_CARDS: readonly CardDef[] = [
  // ability
  { id: 'dash', name: 'Dash', pool: 'ability', rarity: 'common', blurb: 'Quick burst in your movement direction.' },
  { id: 'shove', name: 'Shove', pool: 'ability', rarity: 'common', blurb: 'Radial push on nearby players and the ball.' },
  { id: 'ballstop', name: 'Ball Stop', pool: 'ability', rarity: 'common', blurb: 'Freeze the ball dead on contact.' },
  { id: 'shield', name: 'Shield Bubble', pool: 'ability', rarity: 'rare', blurb: 'Brief bubble that reflects the ball with force.' },
  { id: 'grapple', name: 'Grapple Hook', pool: 'ability', rarity: 'rare', blurb: 'Pull yourself to a point.' },
  { id: 'tractor', name: 'Tractor Beam', pool: 'ability', rarity: 'epic', blurb: 'Pull the ball toward you from range.' },
  // equipment
  { id: 'anklet', name: 'Speed Anklet', pool: 'equipment', rarity: 'common', blurb: '+15% run speed.' },
  { id: 'springs', name: 'Spring Boots', pool: 'equipment', rarity: 'common', blurb: 'Noticeably higher jump.' },
  { id: 'bumper', name: 'Bumper Shell', pool: 'equipment', rarity: 'common', blurb: 'Body contact pushes the ball much harder.' },
  { id: 'magboots', name: 'Magnetic Boots', pool: 'equipment', rarity: 'rare', blurb: 'Immune to wind and stagger.' },
  { id: 'hardhat', name: 'Hard Hat', pool: 'equipment', rarity: 'rare', blurb: '+30% header power.' },
  { id: 'moonsuit', name: 'Moon Suit', pool: 'equipment', rarity: 'epic', blurb: 'Personal low gravity. Aerial dominance.' },
  // gameplay advantage
  { id: 'slimwedge', name: 'Slim Wedge', pool: 'advantage', rarity: 'common', blurb: 'Your wedge is 10% narrower.' },
  { id: 'padded', name: 'Padded Meter', pool: 'advantage', rarity: 'common', blurb: 'Your meter fills 10% slower.' },
  { id: 'reload', name: 'Quick Reload', pool: 'advantage', rarity: 'common', blurb: 'Ability cooldown 25% shorter.' },
  { id: 'freesave', name: 'Free Save', pool: 'advantage', rarity: 'rare', blurb: 'Once per interval, auto-punt the first ball entering your wedge.' },
  { id: 'crystal', name: 'Crystal Ball', pool: 'advantage', rarity: 'rare', blurb: 'See the ball trajectory prediction.' },
  { id: 'comeback', name: 'Comeback Engine', pool: 'advantage', rarity: 'epic', blurb: '+20% speed & header power while your meter is highest.' },
]

export interface RestartCardDef {
  id: string
  name: string
  kind: 'advantage' | 'curse'
  blurb: string
}

/** deliberately mirrored pairs — one modifier system, two signs (idea.md §3) */
export const RESTART_ADVANTAGES: readonly RestartCardDef[] = [
  { id: 'overdrive', name: 'Overdrive', kind: 'advantage', blurb: '+20% move speed this interval.' },
  { id: 'titan', name: 'Titan Header', kind: 'advantage', blurb: '+40% header power this interval.' },
  { id: 'slimzone', name: 'Slim Zone', kind: 'advantage', blurb: 'Your wedge narrows 20% this interval.' },
  { id: 'slowmeter', name: 'Slow Meter', kind: 'advantage', blurb: 'Your meter fills 25% slower this interval.' },
  { id: 'bodyguard', name: 'Bodyguard', kind: 'advantage', blurb: 'One auto-save this interval.' },
  { id: 'doubleboost', name: 'Double Boost', kind: 'advantage', blurb: 'Ability cooldown halved this interval.' },
]

export const RESTART_CURSES: readonly RestartCardDef[] = [
  { id: 'leadboots', name: 'Lead Boots', kind: 'curse', blurb: '-20% move speed this interval.' },
  { id: 'softheader', name: 'Soft Header', kind: 'curse', blurb: '-30% header power this interval.' },
  { id: 'widezone', name: 'Wide Zone', kind: 'curse', blurb: 'Your wedge widens 20% this interval.' },
  { id: 'fastmeter', name: 'Fast Meter', kind: 'curse', blurb: 'Your meter fills 25% faster this interval.' },
  { id: 'magnet', name: 'Magnet Curse', kind: 'curse', blurb: 'The ball drifts toward your wedge this interval.' },
  { id: 'jammed', name: 'Jammed Ability', kind: 'curse', blurb: 'Ability cooldown doubled this interval.' },
]

export const CARD_BY_ID: ReadonlyMap<string, CardDef | RestartCardDef> = new Map<string, CardDef | RestartCardDef>([
  ...DRAFT_CARDS.map((c) => [c.id, c] as const),
  ...RESTART_ADVANTAGES.map((c) => [c.id, c] as const),
  ...RESTART_CURSES.map((c) => [c.id, c] as const),
])

const RARITY_ROLL: ReadonlyArray<readonly [Rarity, number]> = [
  ['common', 0.6],
  ['rare', 0.3],
  ['epic', 0.1],
]

interface OfferRng {
  next(): number
}

/** three rarity-weighted options from one pool, no duplicates within the offer */
export function rollDraftOffer(rng: OfferRng, pool: CardPool): CardDef[] {
  const inPool = DRAFT_CARDS.filter((c) => c.pool === pool)
  const offer: CardDef[] = []
  let guard = 0
  while (offer.length < 3 && guard++ < 50) {
    const roll = rng.next()
    let acc = 0
    let rarity: Rarity = 'common'
    for (const [r, w] of RARITY_ROLL) {
      acc += w
      if (roll < acc) {
        rarity = r
        break
      }
    }
    const candidates = inPool.filter((c) => c.rarity === rarity && !offer.includes(c))
    const pick = candidates[Math.floor(rng.next() * candidates.length)]
    if (pick) offer.push(pick)
    else {
      const any = inPool.filter((c) => !offer.includes(c))
      const fallback = any[Math.floor(rng.next() * any.length)]
      if (fallback) offer.push(fallback)
    }
  }
  return offer
}

/** one advantage + one curse, uniform random (idea.md §3), avoiding excluded ids */
export function rollRestartPair(
  rng: OfferRng,
  exclude: ReadonlySet<string>,
): { advantage: RestartCardDef; curse: RestartCardDef } {
  const advPool = RESTART_ADVANTAGES.filter((c) => !exclude.has(c.id))
  const cursePool = RESTART_CURSES.filter((c) => !exclude.has(c.id))
  const advantage = advPool[Math.floor(rng.next() * advPool.length)] ?? RESTART_ADVANTAGES[0]!
  const curse = cursePool[Math.floor(rng.next() * cursePool.length)] ?? RESTART_CURSES[0]!
  return { advantage, curse }
}
