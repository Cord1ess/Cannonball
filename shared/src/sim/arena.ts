import { ARENA_RADIUS, NEUTRAL_DISC_FRACTION } from '../constants.ts'

/**
 * The dynamic polygon arena (idea.md §1): N survivors = regular N-gon,
 * hexagon -> pentagon -> square -> triangle -> circle (duel at 2).
 * Pure math, three-free, runs identically on client and server.
 *
 * Conventions: XZ plane, angles from atan2(z, x). Wall/zone i is centered
 * on angle i * 2π/N; its zone is the angular sector ±π/N around it.
 */

export interface Arena {
  /** zones / walls (2 = circle duel with two half zones) */
  readonly seats: number
  readonly circle: boolean
  readonly radius: number
  /** center-to-wall distance (= radius for the circle) */
  readonly apothem: number
  readonly neutralRadius: number
  /** center angle of each wall/zone (empty for circle) */
  readonly wallAngles: readonly number[]
  /** outward wall normals in XZ (empty for circle) */
  readonly wallNormals: ReadonlyArray<{ readonly x: number; readonly z: number }>
  readonly wallLength: number
}

export function makeArena(seats: number): Arena {
  const radius = ARENA_RADIUS
  const neutralRadius = radius * NEUTRAL_DISC_FRACTION
  if (seats <= 2) {
    return {
      seats: 2,
      circle: true,
      radius,
      apothem: radius,
      neutralRadius,
      wallAngles: [],
      wallNormals: [],
      wallLength: 0,
    }
  }
  const wallAngles: number[] = []
  const wallNormals: { x: number; z: number }[] = []
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2
    wallAngles.push(a)
    wallNormals.push({ x: Math.cos(a), z: Math.sin(a) })
  }
  return {
    seats,
    circle: false,
    radius,
    apothem: radius * Math.cos(Math.PI / seats),
    neutralRadius,
    wallAngles,
    wallNormals,
    wallLength: 2 * radius * Math.sin(Math.PI / seats),
  }
}

/**
 * Which zone the ball's floor footprint is in. -1 = the neutral disc,
 * which counts for nobody (idea.md §1).
 */
export function footprintZone(arena: Arena, x: number, z: number): number {
  if (x * x + z * z < arena.neutralRadius * arena.neutralRadius) return -1
  if (arena.circle) return x >= 0 ? 0 : 1
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
  const n = arena.circle ? 2 : arena.seats
  const halfBase = Math.PI / n
  const center = arena.circle ? (base === 0 ? 0 : Math.PI) : (arena.wallAngles[base] ?? 0)
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
  const angle = arena.circle ? (zone === 0 ? 0 : Math.PI) : (arena.wallAngles[zone] ?? 0)
  const d = arena.apothem * frac
  return { x: Math.cos(angle) * d, z: Math.sin(angle) * d }
}

/** Yaw that faces the arena center from a given position (see physics facing convention). */
export function yawTowardCenter(x: number, z: number): number {
  return Math.atan2(-x, -z)
}
