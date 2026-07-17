import { describe, expect, it } from 'vitest'
import { Time } from './time.ts'

const time10 = () => new Time({ fixedDelta: 0.01 }) // 10ms steps

describe('Time', () => {
  it('first advance establishes the baseline: zero delta, zero steps', () => {
    const time = time10()
    time.advance(1234)
    expect(time.delta).toBe(0)
    expect(time.consumeFixedSteps()).toBe(0)
    expect(time.frame).toBe(1)
  })

  it('accumulates fixed steps and exposes the interpolation alpha', () => {
    const time = time10()
    time.advance(0)
    time.consumeFixedSteps()

    time.advance(25) // +25ms → 2 steps, 5ms left
    expect(time.delta).toBeCloseTo(0.025)
    expect(time.consumeFixedSteps()).toBe(2)
    expect(time.alpha).toBeCloseTo(0.5)

    time.advance(30) // +5ms carried + 5ms = 1 step, 0 left
    expect(time.consumeFixedSteps()).toBe(1)
    expect(time.alpha).toBeCloseTo(0)
  })

  it('clamps runaway frames (spiral-of-death protection)', () => {
    const time = time10()
    time.advance(0)
    time.advance(10_000) // 10s hitch
    expect(time.unscaledDelta).toBe(0.1)
    expect(time.consumeFixedSteps()).toBe(10)
  })

  it('timeScale 0 pauses simulation but unscaled time advances', () => {
    const time = time10()
    time.advance(0)
    time.timeScale = 0
    time.advance(50)
    expect(time.delta).toBe(0)
    expect(time.unscaledDelta).toBeCloseTo(0.05)
    expect(time.consumeFixedSteps()).toBe(0)
    expect(time.elapsed).toBe(0)
    expect(time.unscaledElapsed).toBeCloseTo(0.05)
  })

  it('timeScale scales simulation time', () => {
    const time = time10()
    time.advance(0)
    time.timeScale = 2
    time.advance(10)
    expect(time.delta).toBeCloseTo(0.02)
    expect(time.consumeFixedSteps()).toBe(2)
  })

  it('fixed step bookkeeping advances via beginFixedStep', () => {
    const time = time10()
    time.beginFixedStep()
    time.beginFixedStep()
    expect(time.fixedStepCount).toBe(2)
    expect(time.fixedElapsed).toBeCloseTo(0.02)
  })

  it('rejects invalid configuration and time scales', () => {
    expect(() => new Time({ fixedDelta: 0 })).toThrow(RangeError)
    expect(() => new Time({ fixedDelta: 0.1, maxFrameDelta: 0.01 })).toThrow(RangeError)
    const time = time10()
    expect(() => (time.timeScale = -1)).toThrow(RangeError)
    expect(() => (time.timeScale = Number.NaN)).toThrow(RangeError)
  })
})
