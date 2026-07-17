/**
 * Wind field (M5 visual): a pool of LOCALIZED gust cells that sweep CURVED,
 * CIRCULAR paths AROUND the stadium bowl (not straight lines across it). Each
 * cell orbits the arena center at some radius, its travel direction being the
 * tangent of that arc, so wind reads as swirling around the colosseum. Cells
 * appear in a small area, whiz along their arc, fade, and die.
 *
 * Purely cosmetic (wind no longer touches the ball; airborne-player wind uses
 * the separate sampleWind). rng injected so clients can seed independently.
 */

export interface GustCell {
  x: number
  z: number
  radius: number
  strength: number
  /** unit travel direction (tangent of the arc it's sweeping) */
  dirX: number
  dirZ: number
  // internals
  orbitR: number // distance from arena center
  angle: number // current angular position (radians)
  angVel: number // angular velocity (signed: +ccw / -cw)
  age: number
  life: number
  peak: number
  active: boolean
}

export interface WindField {
  /** a broad "prevailing" direction, for the ambient streaks fallback */
  readonly dirX: number
  readonly dirZ: number
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
    dirX: 1,
    dirZ: 0,
    orbitR: 0,
    angle: 0,
    angVel: 0,
    age: 0,
    life: 0,
    peak: 0,
    active: false,
  }))
  const live: GustCell[] = []

  // a slowly-rotating "prevailing" heading (used only for the streak fallback)
  let prevailing = rng() * Math.PI * 2
  // overall swirl direction of the bowl: mostly one way, occasionally flips
  let swirlSign = rng() < 0.5 ? 1 : -1
  let spawnCd = 0.4

  function spawn(): void {
    const cell = cells.find((c) => !c.active)
    if (!cell) return
    // orbit somewhere between the neutral disc and the wall
    cell.orbitR = ARENA_R * (0.35 + rng() * 0.55)
    cell.angle = rng() * Math.PI * 2
    // angular speed so the linear speed along the arc is reasonable (~14-26 m/s)
    const linSpeed = 14 + rng() * 12
    cell.angVel = (swirlSign * linSpeed) / cell.orbitR
    cell.radius = 5 + rng() * 7
    cell.peak = 0.6 + rng() * 0.5
    cell.strength = 0
    cell.age = 0
    cell.life = 1.8 + rng() * 1.8
    cell.active = true
  }

  function placeOnArc(c: GustCell): void {
    c.x = Math.cos(c.angle) * c.orbitR
    c.z = Math.sin(c.angle) * c.orbitR
    // travel direction = tangent to the circle (perpendicular to the radius),
    // signed by the orbit direction → the gust curves around the bowl
    const tx = -Math.sin(c.angle)
    const tz = Math.cos(c.angle)
    const s = Math.sign(c.angVel) || 1
    c.dirX = tx * s
    c.dirZ = tz * s
  }

  return {
    get dirX() {
      return Math.cos(prevailing)
    },
    get dirZ() {
      return Math.sin(prevailing)
    },
    step(dt: number): readonly GustCell[] {
      prevailing += 0.02 * dt
      if (rng() < 0.002) swirlSign *= -1 // rare bowl-swirl reversal

      spawnCd -= dt
      if (spawnCd <= 0) {
        const burst = rng() < 0.35 ? 2 + Math.floor(rng() * 2) : 1
        for (let i = 0; i < burst; i++) spawn()
        spawnCd = 1.2 + rng() * 2.2
      }

      live.length = 0
      for (const c of cells) {
        if (!c.active) continue
        c.age += dt
        c.angle += c.angVel * dt // sweep along the arc
        placeOnArc(c)
        const f = c.age / c.life
        if (f >= 1) {
          c.active = false
          c.strength = 0
          continue
        }
        c.strength = Math.sin(f * Math.PI) * c.peak // ease in→out
        live.push(c)
      }
      return live
    },
  }
}
