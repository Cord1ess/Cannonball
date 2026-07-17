/**
 * arc.random — the seeded PRNG service (moonshot invariant, docs/systems/
 * moonshots.md): gameplay never calls Math.random(), because time-travel
 * replay requires every source of chance to be seeded and snapshotable.
 *
 * Algorithm: sfc32 ("Small Fast Counter") — fast, well-tested statistically
 * (passes PractRand), 128-bit state that serializes to four integers. State
 * snapshots are exactly what replay checkpoints capture.
 */

export interface RandomState {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
}

export class Random {
  #a = 0
  #b = 0
  #c = 0
  #d = 0

  constructor(seed: number | string) {
    // Derive 128 bits of state from the seed via splitmix32, then warm up —
    // sfc32 needs a few rounds to decorrelate from small seeds.
    const mix = splitmix32(typeof seed === 'string' ? hashString(seed) : seed | 0)
    this.#a = mix()
    this.#b = mix()
    this.#c = mix()
    this.#d = mix()
    for (let i = 0; i < 15; i++) this.nextUint32()
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296
  }

  /** Uniform integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError('Random.int: bounds must be integers')
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError(`Random.int: empty range [${minInclusive}, ${maxExclusive})`)
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive))
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability
  }

  nextUint32(): number {
    const t = (((this.#a + this.#b) | 0) + this.#d) | 0
    this.#d = (this.#d + 1) | 0
    this.#a = this.#b ^ (this.#b >>> 9)
    this.#b = (this.#c + (this.#c << 3)) | 0
    this.#c = (this.#c << 21) | (this.#c >>> 11)
    this.#c = (this.#c + t) | 0
    return t >>> 0
  }

  /** Snapshot for replay checkpoints. */
  getState(): RandomState {
    return { a: this.#a, b: this.#b, c: this.#c, d: this.#d }
  }

  setState(state: RandomState): void {
    this.#a = state.a | 0
    this.#b = state.b | 0
    this.#c = state.c | 0
    this.#d = state.d | 0
  }
}

function splitmix32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x9e3779b9) | 0
    let t = s ^ (s >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    return (t ^ (t >>> 15)) >>> 0
  }
}

/** FNV-1a, enough to turn seed strings into 32 bits deterministically. */
function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}
