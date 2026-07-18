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
  wobPhase: number // sideways-weave phase
  wobRate: number // weave speed
  wobAmp: number // weave amplitude (meters of radial wander)
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
    wobPhase: 0,
    wobRate: 0,
    wobAmp: 0,
    age: 0,
    life: 0,
    peak: 0,
    active: false,
  }))
  const live: GustCell[] = []

  // a slowly-rotating "prevailing" heading (used only for the streak fallback)
  let prevailing = rng() * Math.PI * 2
  // overall swirl direction of the bowl: mostly one way, occasionally flips
  let spawnCd = 0.4

  function spawn(): void {
    const cell = cells.find((c) => !c.active)
    if (!cell) return
    // orbit somewhere between the neutral disc and the wall
    cell.orbitR = ARENA_R * (0.3 + rng() * 0.55)
    cell.angle = rng() * Math.PI * 2
    // per-gust RANDOM motion: some curve clockwise, some anti-clockwise, some
    // travel near-straight. Independent sign + a straight-line bias per gust.
    const linSpeed = 6 + rng() * 7
    const spin = rng() < 0.5 ? 1 : -1 // this gust's own rotation, not the bowl's
    const straightness = rng() // 0 = tight curve .. 1 = near straight
    cell.angVel = (spin * linSpeed) / (cell.orbitR + straightness * ARENA_R * 4)
    cell.radius = 6 + rng() * 6 // small feathered fronts, not field-wide folds
    cell.peak = 0.7 + rng() * 0.5
    cell.strength = 0
    cell.age = 0
    cell.life = 3.5 + rng() * 3.0 // long-lived so they roll slowly through
    // wobble: a gentle sideways weave superimposed on the orbit
    cell.wobPhase = rng() * Math.PI * 2
    cell.wobRate = 0.6 + rng() * 0.7
    cell.wobAmp = ARENA_R * (0.04 + rng() * 0.05)
    cell.active = true
  }

  function placeOnArc(c: GustCell): void {
    // radial wobble: the gust weaves in and out as it rolls, so its path isn't
    // a perfect circle — a bit of organic wander
    const wob = Math.sin(c.wobPhase) * c.wobAmp
    const r = c.orbitR + wob
    c.x = Math.cos(c.angle) * r
    c.z = Math.sin(c.angle) * r
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
        c.wobPhase += c.wobRate * dt // weave in/out as it rolls
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
