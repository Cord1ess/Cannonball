import { ARENA_RADIUS, NEUTRAL_DISC_FRACTION } from '../constants.ts'

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
