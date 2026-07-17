import { describe, expect, it } from 'vitest'
import { Random } from './random.ts'

describe('Random (arc.random)', () => {
  it('same seed → identical sequence; different seed → different sequence', () => {
    const a = new Random(42)
    const b = new Random(42)
    const c = new Random(43)
    const seqA = Array.from({ length: 50 }, () => a.next())
    const seqB = Array.from({ length: 50 }, () => b.next())
    const seqC = Array.from({ length: 50 }, () => c.next())
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
  })

  it('string seeds are deterministic too', () => {
    expect(new Random('level-1').next()).toBe(new Random('level-1').next())
    expect(new Random('level-1').next()).not.toBe(new Random('level-2').next())
  })

  it('state snapshot/restore replays exactly (the replay-checkpoint contract)', () => {
    const random = new Random(7)
    for (let i = 0; i < 10; i++) random.next()
    const state = random.getState()
    const tail = Array.from({ length: 20 }, () => random.next())

    random.setState(state)
    const replayed = Array.from({ length: 20 }, () => random.next())
    expect(replayed).toEqual(tail)
  })

  it('int() respects bounds and validates', () => {
    const random = new Random(1)
    for (let i = 0; i < 1000; i++) {
      const value = random.int(-3, 4)
      expect(value).toBeGreaterThanOrEqual(-3)
      expect(value).toBeLessThan(4)
      expect(Number.isInteger(value)).toBe(true)
    }
    expect(() => random.int(1, 1)).toThrow(RangeError)
    expect(() => random.int(0.5, 2)).toThrow(RangeError)
  })

  it('next() is uniform-ish over [0,1)', () => {
    const random = new Random('distribution')
    let sum = 0
    for (let i = 0; i < 10_000; i++) {
      const value = random.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      sum += value
    }
    expect(sum / 10_000).toBeGreaterThan(0.48)
    expect(sum / 10_000).toBeLessThan(0.52)
  })

  it('bool() honors probability extremes', () => {
    const random = new Random(9)
    expect(random.bool(0)).toBe(false)
    expect(random.bool(1)).toBe(true)
  })
})
