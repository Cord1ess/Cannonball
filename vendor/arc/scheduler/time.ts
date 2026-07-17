/**
 * The engine's only clock (docs/systems/architecture.md, moonshot invariant:
 * no wall-clock reads in simulation). Time never reads the system clock —
 * the host passes `now` into Scheduler.tick(), which makes frames replayable
 * and tests synthetic.
 *
 * All values are SECONDS (game convention); the scheduler feeds milliseconds
 * from performance.now()/rAF and converts.
 */

export interface TimeOptions {
  /** Simulation step size in seconds. Default 1/60. */
  readonly fixedDelta?: number
  /** Spiral-of-death clamp: a frame never advances more than this. Default 0.1s. */
  readonly maxFrameDelta?: number
}

export class Time {
  readonly fixedDelta: number
  readonly maxFrameDelta: number

  #timeScale = 1
  #lastNowMs: number | null = null
  #accumulator = 0

  #delta = 0
  #unscaledDelta = 0
  #elapsed = 0
  #unscaledElapsed = 0
  #frame = 0
  #fixedStepCount = 0
  #fixedElapsed = 0
  #alpha = 0

  constructor(options?: TimeOptions) {
    this.fixedDelta = options?.fixedDelta ?? 1 / 60
    this.maxFrameDelta = options?.maxFrameDelta ?? 0.1
    if (!(this.fixedDelta > 0) || !Number.isFinite(this.fixedDelta)) {
      throw new RangeError(`Time: fixedDelta must be a positive number, got ${this.fixedDelta}`)
    }
    if (!(this.maxFrameDelta >= this.fixedDelta)) {
      throw new RangeError('Time: maxFrameDelta must be >= fixedDelta')
    }
  }

  /** Scaled seconds since the last frame (0 while paused). */
  get delta(): number {
    return this.#delta
  }

  get unscaledDelta(): number {
    return this.#unscaledDelta
  }

  /** Scaled seconds since start. */
  get elapsed(): number {
    return this.#elapsed
  }

  get unscaledElapsed(): number {
    return this.#unscaledElapsed
  }

  /** Render-frame counter. */
  get frame(): number {
    return this.#frame
  }

  /** Total fixed steps taken since start. */
  get fixedStepCount(): number {
    return this.#fixedStepCount
  }

  /** Scaled seconds of simulation time (advances only in fixed steps). */
  get fixedElapsed(): number {
    return this.#fixedElapsed
  }

  /** Interpolation factor [0,1): how far between fixed steps this frame renders. */
  get alpha(): number {
    return this.#alpha
  }

  /** 1 = realtime, 0 = paused (edit mode), 2 = double speed, etc. */
  get timeScale(): number {
    return this.#timeScale
  }

  set timeScale(value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Time: timeScale must be a finite number >= 0, got ${value}`)
    }
    this.#timeScale = value
  }

  // --- driven by the Scheduler ---------------------------------------------------

  /** Called once per frame by the scheduler. The first call establishes the baseline. */
  advance(nowMs: number): void {
    const rawDelta =
      this.#lastNowMs === null ? 0 : Math.min((nowMs - this.#lastNowMs) / 1000, this.maxFrameDelta)
    this.#lastNowMs = nowMs

    this.#unscaledDelta = Math.max(rawDelta, 0)
    this.#delta = this.#unscaledDelta * this.#timeScale
    this.#unscaledElapsed += this.#unscaledDelta
    this.#elapsed += this.#delta
    this.#accumulator += this.#delta
    this.#frame++
  }

  /** Consumes the accumulator; returns how many fixed steps this frame runs. */
  consumeFixedSteps(): number {
    const steps = Math.floor(this.#accumulator / this.fixedDelta)
    this.#accumulator -= steps * this.fixedDelta
    this.#alpha = this.#accumulator / this.fixedDelta
    return steps
  }

  /** Called once per fixed step by the scheduler, before the step's systems run. */
  beginFixedStep(): void {
    this.#fixedStepCount++
    this.#fixedElapsed += this.fixedDelta
  }
}
