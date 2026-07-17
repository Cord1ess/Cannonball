/**
 * M4: the ModifierStack (architecture.md §3) — cards are data entries that
 * multiply base stats. One system, queried by the sim; restart advantage/
 * curse pairs are literally the same modifiers with the sign flipped.
 *
 * computeMods() is pure and runs identically on server (authority) and
 * client (self-prediction), from replicated card ids.
 */

export interface PlayerMods {
  speed: number
  jump: number
  header: number
  gravity: number
  /** multiplier on the knock impulse a player RECEIVES */
  knockTaken: number
  /** multiplier on the impulse this player's body imparts to the ball */
  nudge: number
  /** ability cooldown multiplier (lower = faster) */
  cooldown: number
  /** judgment-side (server only) */
  meterRate: number
  wedgeWidth: number
}

export const DEFAULT_MODS: Readonly<PlayerMods> = {
  speed: 1,
  jump: 1,
  header: 1,
  gravity: 1,
  knockTaken: 1,
  nudge: 1,
  cooldown: 1,
  meterRate: 1,
  wedgeWidth: 1,
}

interface ModContext {
  /** Comeback Engine condition: my meter is currently the highest */
  meterIsHighest: boolean
}

/** loadout card ids + active restart card ids -> a fresh mods object */
export function computeMods(cardIds: readonly string[], ctx: ModContext): PlayerMods {
  const mods: PlayerMods = { ...DEFAULT_MODS }
  for (const id of cardIds) {
    switch (id) {
      // equipment
      case 'anklet':
        mods.speed *= 1.15
        break
      case 'springs':
        mods.jump *= 1.25
        break
      case 'bumper':
        mods.nudge *= 2.4
        break
      case 'magboots':
        mods.knockTaken *= 0.45 // stagger-resistant
        break
      case 'hardhat':
        mods.header *= 1.3
        break
      case 'moonsuit':
        mods.gravity *= 0.55
        mods.jump *= 1.1
        break
      // gameplay advantage
      case 'slimwedge':
        mods.wedgeWidth *= 0.9
        break
      case 'padded':
        mods.meterRate *= 0.9
        break
      case 'reload':
        mods.cooldown *= 0.75
        break
      case 'comeback':
        if (ctx.meterIsHighest) {
          mods.speed *= 1.2
          mods.header *= 1.2
        }
        break
      // restart pairs (idea.md §3 mirrors)
      case 'overdrive':
        mods.speed *= 1.2
        break
      case 'leadboots':
        mods.speed *= 0.8
        break
      case 'titan':
        mods.header *= 1.4
        break
      case 'softheader':
        mods.header *= 0.7
        break
      case 'slimzone':
        mods.wedgeWidth *= 0.8
        break
      case 'widezone':
        mods.wedgeWidth *= 1.2
        break
      case 'slowmeter':
        mods.meterRate *= 0.75
        break
      case 'fastmeter':
        mods.meterRate *= 1.25
        break
      case 'doubleboost':
        mods.cooldown *= 0.5
        break
      case 'jammed':
        mods.cooldown *= 2
        break
      // freesave / bodyguard / magnet / crystal handled as flags below
    }
  }
  return mods
}

/** flag-style effects that aren't stat multipliers */
export function hasFreeSave(cardIds: readonly string[]): boolean {
  return cardIds.includes('freesave') || cardIds.includes('bodyguard')
}
export function hasMagnetCurse(cardIds: readonly string[]): boolean {
  return cardIds.includes('magnet')
}
export function hasCrystal(cardIds: readonly string[]): boolean {
  return cardIds.includes('crystal')
}

// --- abilities -------------------------------------------------------------------

export interface AbilitySpec {
  id: string
  cooldown: number
  /** active-state duration (shield bubble, tractor beam) */
  duration: number
}

export const ABILITIES: Record<string, AbilitySpec> = {
  dash: { id: 'dash', cooldown: 5, duration: 0 },
  shove: { id: 'shove', cooldown: 6, duration: 0 },
  ballstop: { id: 'ballstop', cooldown: 7, duration: 0 },
  shield: { id: 'shield', cooldown: 8, duration: 1.2 },
  grapple: { id: 'grapple', cooldown: 8, duration: 0 },
  tractor: { id: 'tractor', cooldown: 12, duration: 1.5 },
}
