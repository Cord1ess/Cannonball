import {
  ARENA_RADIUS,
  CANNON_MUZZLE_FWD,
  CANNON_MUZZLE_UP,
  CANNON_RADIUS_OFF,
  GRAVITY,
  LAUNCH_AIM_ARC_DEG,
  LAUNCH_LAND_MAX_FRAC,
  LAUNCH_LAND_MIN_FRAC,
  LAUNCH_MAX_FLIGHT_S,
  LAUNCH_MIN_FLIGHT_S,
  NEUTRAL_DISC_FRACTION,
  RIM_TOP_H,
} from '../constants.ts'

/**
 * THE colosseum (idea.md §1, M5 revision): one permanent round stadium.
 * The building never changes — only the painted floor divisions do:
 * 6 wedge sectors -> 5 -> 4 -> 3 -> two halves (duel). Pure math,
 * three-free, runs identically on client and server.
 *
 * Conventions: XZ plane, angles from atan2(z, x). Zone i is the angular
 * sector ±π/N around zoneAngles[i]; its cannon sits on the wall crown at
 * that same angle.
 */

export interface Arena {
  /** painted zone count (2 = duel halves) */
  readonly seats: number
  readonly radius: number
  /** center-to-wall distance — equals radius in the round colosseum */
  readonly apothem: number
  readonly neutralRadius: number
  /** center angle of each zone sector (and its wall-crown cannon) */
  readonly zoneAngles: readonly number[]
}

export function makeArena(seats: number): Arena {
  const radius = ARENA_RADIUS
  const n = Math.max(2, seats)
  const zoneAngles: number[] = []
  for (let i = 0; i < n; i++) zoneAngles.push((i / n) * Math.PI * 2)
  return {
    seats: n,
    radius,
    apothem: radius,
    neutralRadius: radius * NEUTRAL_DISC_FRACTION,
    zoneAngles,
  }
}

/**
 * Which zone the ball's floor footprint is in. -1 = the neutral disc,
 * which counts for nobody (idea.md §1).
 */
export function footprintZone(arena: Arena, x: number, z: number): number {
  if (x * x + z * z < arena.neutralRadius * arena.neutralRadius) return -1
  const tau = Math.PI * 2
  const angle = (Math.atan2(z, x) + tau) % tau
  return Math.round(angle / (tau / arena.seats)) % arena.seats
}

/**
 * Zone ownership with per-zone WIDTH multipliers (Slim/Wide Zone cards).
 * A narrowed wedge leaves neutral escape strips at its edges; a widened
 * neighbor's span can claim those strips. widths[i] multiplies zone i's
 * angular half-span (1 = normal).
 */
export function footprintZoneWidths(
  arena: Arena,
  x: number,
  z: number,
  widths: readonly number[],
): number {
  const base = footprintZone(arena, x, z)
  if (base < 0) return -1
  const n = arena.seats
  const halfBase = Math.PI / n
  const center = arena.zoneAngles[base] ?? 0
  const tau = Math.PI * 2
  let diff = (Math.atan2(z, x) - center) % tau
  if (diff > Math.PI) diff -= tau
  if (diff < -Math.PI) diff += tau

  const wBase = widths[base] ?? 1
  if (Math.abs(diff) <= halfBase * Math.min(wBase, 1)) return base

  // edge strip of a narrowed wedge: can the adjacent zone's widened span claim it?
  const adjacent = diff > 0 ? (base + 1) % n : (base - 1 + n) % n
  const wAdj = widths[adjacent] ?? 1
  const distFromAdjCenter = 2 * halfBase - Math.abs(diff)
  if (wAdj > 1 && distFromAdjCenter <= halfBase * wAdj) return adjacent
  if (wBase >= 1) return base
  return -1 // neutral escape strip
}

/** A point inside zone `zone` at `frac` of the way from center to wall. */
export function zoneAnchor(arena: Arena, zone: number, frac: number): { x: number; z: number } {
  const angle = arena.zoneAngles[zone] ?? 0
  const d = arena.apothem * frac
  return { x: Math.cos(angle) * d, z: Math.sin(angle) * d }
}

/** Yaw that faces the arena center from a given position (see physics facing convention). */
export function yawTowardCenter(x: number, z: number): number {
  return Math.atan2(-x, -z)
}

// --- CANNON LAUNCH (M6b): one source of truth for server physics + client rig --

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * The muzzle tip world position for a zone's cannon — on the TOPMOST rim, above
 * the audience, reaching a little inward + up. Derived purely from shared rig
 * constants so the drawn cannon in arenaView.ts and the launch physics agree.
 */
export function cannonMouth(arena: Arena, zone: number): Vec3 {
  const angle = arena.zoneAngles[zone] ?? 0
  const ring = arena.radius + CANNON_RADIUS_OFF
  // origin on the rim ring, then the muzzle reaches inward (toward center) + up
  const inward = -1 // toward center along the radial
  return {
    x: Math.cos(angle) * (ring + inward * CANNON_MUZZLE_FWD),
    y: RIM_TOP_H + CANNON_MUZZLE_UP,
    z: Math.sin(angle) * (ring + inward * CANNON_MUZZLE_FWD),
  }
}

/**
 * Where a launch LANDS on the pitch, from an aim (yaw offset, radians) and a
 * charge (0..1). Charge scales distance from center; aim rotates the direction
 * within the wedge's arc. The result is ALWAYS clamped inside the pitch (never
 * the crowd): distance ∈ [MIN_FRAC, MAX_FRAC]·radius, and MAX_FRAC < 1.
 */
export function launchLandingPoint(
  arena: Arena,
  zone: number,
  aim: number,
  charge: number,
): { x: number; z: number } {
  const arc = (LAUNCH_AIM_ARC_DEG * Math.PI) / 360 // half-arc
  const a = Math.max(-arc, Math.min(arc, aim))
  const c = Math.max(0, Math.min(1, charge))
  // the cannon fires INWARD, so the landing direction is the wedge angle (which
  // points from center out to the wall); the landing sits between center + wall.
  const angle = (arena.zoneAngles[zone] ?? 0) + a
  const frac = LAUNCH_LAND_MIN_FRAC + (LAUNCH_LAND_MAX_FRAC - LAUNCH_LAND_MIN_FRAC) * c
  const d = arena.radius * frac
  return { x: Math.cos(angle) * d, z: Math.sin(angle) * d }
}

/** flight time for a charge — full charge is flatter/faster, low charge lofts. */
export function launchFlightTime(charge: number): number {
  const c = Math.max(0, Math.min(1, charge))
  return LAUNCH_MAX_FLIGHT_S + (LAUNCH_MIN_FLIGHT_S - LAUNCH_MAX_FLIGHT_S) * c
}

/**
 * The ballistic launch velocity that carries a body from the muzzle to the
 * landing point in the charge's flight time under GRAVITY. Same solve on server
 * (applied to the sim) and client (drawn as the predictive arc), so the drawn
 * trajectory is exactly the flight.
 */
export function launchVelocity(from: Vec3, to: { x: number; z: number }, flight: number): Vec3 {
  const t = Math.max(0.1, flight)
  return {
    x: (to.x - from.x) / t,
    // vy solves y(t)=0 at the pitch: from.y + vy·t − ½g·t² = 0
    y: (0 - from.y + 0.5 * GRAVITY * t * t) / t,
    z: (to.z - from.z) / t,
  }
}

/** Sample the ballistic arc at parameter u∈[0,1] over the flight — for drawing. */
export function launchArcPoint(from: Vec3, vel: Vec3, flight: number, u: number): Vec3 {
  const t = u * flight
  return {
    x: from.x + vel.x * t,
    y: from.y + vel.y * t - 0.5 * GRAVITY * t * t,
    z: from.z + vel.z * t,
  }
}
