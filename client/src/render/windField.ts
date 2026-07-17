/**
 * Wind field (M5 visual): a pool of LOCALIZED gust cells. Each cell spawns at
 * a random spot upwind, travels downwind across the pitch, swells then fades,
 * and dies — so gusts appear in small areas, whiz past, and disappear, instead
 * of one uniform field. Grass + wind streaks both read these cells.
 *
 * Deterministic-free (purely cosmetic; wind no longer touches the ball, and
 * airborne-player wind uses the separate sampleWind). Uses Math.random via an
 * injected rng so it can seed differently per client without desync concerns.
 */

export interface GustCell {
  x: number
  z: number
  radius: number
  strength: number // 0..1 current
  // internals
  vx: number
  vz: number
  age: number
  life: number
  peak: number // peak strength this cell reaches
  active: boolean
}

export interface WindField {
  /** current wind direction (slowly rotating) */
  readonly dirX: number
  readonly dirZ: number
  /** advance the field; returns the live cells (subset, active only) */
  step(dt: number): readonly GustCell[]
}

const MAX_CELLS = 6
const ARENA_R = 28

export function createWindField(rng: () => number = Math.random): WindField {
  const cells: GustCell[] = Array.from({ length: MAX_CELLS }, () => ({
    x: 0,
    z: 0,
    radius: 0,
    strength: 0,
    vx: 0,
    vz: 0,
    age: 0,
    life: 0,
    peak: 0,
    active: false,
  }))
  const live: GustCell[] = []

  // wind direction rotates slowly and continuously
  let dirAng = rng() * Math.PI * 2
  // spawn timer: a fresh gust every so often (bursty — sometimes 3-4 close)
  let spawnCd = 0.4

  function spawn(): void {
    const cell = cells.find((c) => !c.active)
    if (!cell) return
    const dx = Math.cos(dirAng)
    const dz = Math.sin(dirAng)
    // start just upwind of the pitch, at a random lateral offset
    const lateral = (rng() - 0.5) * ARENA_R * 1.6
    const px = -dx * (ARENA_R + 6) + -dz * lateral
    const pz = -dz * (ARENA_R + 6) + dx * lateral
    const speed = 14 + rng() * 12
    cell.x = px
    cell.z = pz
    cell.vx = dx * speed
    cell.vz = dz * speed
    cell.radius = 5 + rng() * 7 // SMALL area
    cell.peak = 0.6 + rng() * 0.5
    cell.strength = 0
    cell.age = 0
    cell.life = 1.6 + rng() * 1.6 // short-lived
    cell.active = true
  }

  return {
    get dirX() {
      return Math.cos(dirAng)
    },
    get dirZ() {
      return Math.sin(dirAng)
    },
    step(dt: number): readonly GustCell[] {
      dirAng += (rng() - 0.5) * 0.05 * dt + 0.02 * dt // gentle drift

      spawnCd -= dt
      if (spawnCd <= 0) {
        // bursty: usually 1, sometimes a cluster of 2-3 close together
        const burst = rng() < 0.35 ? 2 + Math.floor(rng() * 2) : 1
        for (let i = 0; i < burst; i++) spawn()
        spawnCd = 1.2 + rng() * 2.2 // gap before the next burst
      }

      live.length = 0
      for (const c of cells) {
        if (!c.active) continue
        c.age += dt
        c.x += c.vx * dt
        c.z += c.vz * dt
        // ease in then out over its life (appears + disappears)
        const f = c.age / c.life
        if (f >= 1) {
          c.active = false
          c.strength = 0
          continue
        }
        // smooth bell: 0 -> peak -> 0
        c.strength = Math.sin(f * Math.PI) * c.peak
        live.push(c)
      }
      return live
    },
  }
}
