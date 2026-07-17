import { TIE_EPSILON_S } from '../constants.ts'

/**
 * Tick judgment (idea.md §1): interval accumulation, never a snapshot.
 * Pure functions — the server owns the authoritative copies in M2+.
 */

/** Accrue ball-time to the zone under the ball footprint. -1 (neutral) accrues nothing. */
export function accrueBallTime(
  meters: number[],
  zoneSeat: readonly number[],
  zone: number,
  dt: number,
): void {
  if (zone < 0) return
  const seat = zoneSeat[zone]
  if (seat === undefined) return
  meters[seat] = (meters[seat] ?? 0) + dt
}

/**
 * Who the tick eliminates: highest meter among alive seats.
 * Returns the seats within TIE_EPSILON of the max — length 1 = clean
 * elimination, length >1 = overtime micro-round (M3; M1 picks the first).
 */
export function tickLosers(meters: readonly number[], alive: readonly boolean[]): number[] {
  let max = -1
  for (let seat = 0; seat < meters.length; seat++) {
    if (alive[seat] && (meters[seat] ?? 0) > max) max = meters[seat] ?? 0
  }
  const losers: number[] = []
  for (let seat = 0; seat < meters.length; seat++) {
    if (alive[seat] && max - (meters[seat] ?? 0) < TIE_EPSILON_S) losers.push(seat)
  }
  return losers
}
