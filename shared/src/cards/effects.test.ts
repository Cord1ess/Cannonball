import { describe, expect, it } from 'vitest'
import { FIXED_DELTA } from '../constants.ts'
import { makeArena, footprintZoneWidths } from '../sim/arena.ts'
import { makePlayer, stepPlayer, ZERO_INPUT } from '../sim/physics.ts'
import { computeMods, DEFAULT_MODS } from './effects.ts'

describe('modifier stack', () => {
  it('multiplies stats from card ids', () => {
    const mods = computeMods(['anklet', 'overdrive', 'hardhat', 'titan'], { meterIsHighest: false })
    expect(mods.speed).toBeCloseTo(1.15 * 1.2)
    expect(mods.header).toBeCloseTo(1.3 * 1.4)
  })

  it('mirrored pairs cancel', () => {
    const mods = computeMods(['overdrive', 'leadboots'], { meterIsHighest: false })
    expect(mods.speed).toBeCloseTo(1.2 * 0.8)
  })

  it('comeback engine only fires when losing', () => {
    expect(computeMods(['comeback'], { meterIsHighest: false }).speed).toBe(1)
    expect(computeMods(['comeback'], { meterIsHighest: true }).speed).toBeCloseTo(1.2)
  })

  it('neutral by default', () => {
    expect(computeMods([], { meterIsHighest: false })).toEqual(DEFAULT_MODS)
  })
})

describe('wedge width judgment', () => {
  const arena = makeArena(6)
  // a point near the EDGE of zone 0 (wall center at angle 0, half-span 30deg)
  const edgeAngle = (25 * Math.PI) / 180
  const r = arena.apothem * 0.8
  const x = Math.cos(edgeAngle) * r
  const z = Math.sin(edgeAngle) * r

  it('normal widths keep base ownership', () => {
    expect(footprintZoneWidths(arena, x, z, [1, 1, 1, 1, 1, 1])).toBe(0)
  })
  it('slim wedge turns its edges neutral', () => {
    expect(footprintZoneWidths(arena, x, z, [0.7, 1, 1, 1, 1, 1])).toBe(-1)
  })
  it('a widened neighbor claims the abandoned strip', () => {
    expect(footprintZoneWidths(arena, x, z, [0.7, 1.5, 1, 1, 1, 1])).toBe(1)
  })
})

describe('abilities', () => {
  it('dash bursts forward and starts its cooldown', () => {
    const arena = makeArena(6)
    const p = makePlayer(0, 0, 0, 0) // facing +z
    p.ability = 'dash'
    stepPlayer(p, { ...ZERO_INPUT, ability: true }, arena, FIXED_DELTA)
    expect(p.vz).toBeGreaterThan(10)
    expect(p.abilityCd).toBeGreaterThan(4)
    // cooldown gates a second press
    const vz = p.vz
    stepPlayer(p, { ...ZERO_INPUT, ability: true }, arena, FIXED_DELTA)
    expect(p.vz).toBeLessThanOrEqual(vz)
  })

  it('quick reload shortens the cooldown', () => {
    const arena = makeArena(6)
    const p = makePlayer(0, 0, 0, 0)
    p.ability = 'dash'
    p.mods = computeMods(['reload'], { meterIsHighest: false })
    stepPlayer(p, { ...ZERO_INPUT, ability: true }, arena, FIXED_DELTA)
    expect(p.abilityCd).toBeLessThan(4)
  })
})
