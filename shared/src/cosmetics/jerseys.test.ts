import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KIT_IDS,
  KIT_BY_ID,
  KIT_CLASH_DISTANCE,
  KITS,
  kitColors,
  resolveKitClashes,
} from './jerseys.ts'

const dist = (a: number, b: number): number => {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

describe('kit data', () => {
  it('has at least 8 kits with unique ids', () => {
    expect(KITS.length).toBeGreaterThanOrEqual(8)
    expect(new Set(KITS.map((k) => k.id)).size).toBe(KITS.length)
  })

  it('covers all 6 seats with valid default kits', () => {
    expect(DEFAULT_KIT_IDS.length).toBe(6)
    for (const id of DEFAULT_KIT_IDS) expect(KIT_BY_ID.has(id)).toBe(true)
  })

  it('every away primary is distinct from its home primary', () => {
    // otherwise flipping to away could not resolve a clash
    for (const kit of KITS) {
      expect(dist(kit.home.primary, kit.away.primary)).toBeGreaterThanOrEqual(KIT_CLASH_DISTANCE)
    }
  })

  it('the six default home primaries never clash with each other', () => {
    const away = resolveKitClashes([...DEFAULT_KIT_IDS])
    expect(away).toEqual([false, false, false, false, false, false])
  })

  it('kitColors resolves home/away and rejects unknowns', () => {
    expect(kitColors('crimson', false)?.primary).toBe(KIT_BY_ID.get('crimson')!.home.primary)
    expect(kitColors('crimson', true)?.primary).toBe(KIT_BY_ID.get('crimson')!.away.primary)
    expect(kitColors('nope', false)).toBeNull()
  })
})

describe('resolveKitClashes', () => {
  it('same kit twice: the later seat goes away', () => {
    expect(resolveKitClashes(['crimson', 'crimson'])).toEqual([false, true])
  })

  it('earlier seats keep priority regardless of who else picks', () => {
    expect(resolveKitClashes(['azure', 'jade', 'azure'])).toEqual([false, false, true])
  })

  it('three of the same kit: all but the first flip away', () => {
    const away = resolveKitClashes(['jade', 'jade', 'jade'])
    expect(away[0]).toBe(false)
    expect(away[1]).toBe(true)
    expect(away[2]).toBe(true)
  })

  it('unknown ids never clash and never flip', () => {
    expect(resolveKitClashes(['mystery', 'crimson', 'mystery'])).toEqual([false, false, false])
  })
})
