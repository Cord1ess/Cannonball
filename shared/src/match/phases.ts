import { DUEL_METER_CAPACITY_S, TICK_SECONDS_PER_SURVIVOR } from '../constants.ts'

/**
 * The match spine (idea.md §2): every kickoff beat is a phase. Transitions
 * happen ONLY in the server's phase machine; clients render from the
 * replicated phase id.
 */

export const Phase = {
  Lobby: 0,
  Draft: 1,
  Launch: 2,
  Arena: 3,
  Overtime: 4,
  Restart: 5,
  Duel: 6,
  End: 7,
} as const

export type PhaseId = (typeof Phase)[keyof typeof Phase]

export const PHASE_NAMES: Record<PhaseId, string> = {
  [Phase.Lobby]: 'lobby',
  [Phase.Draft]: 'draft',
  [Phase.Launch]: 'kickoff',
  [Phase.Arena]: 'arena',
  [Phase.Overtime]: 'OVERTIME',
  [Phase.Restart]: 'restart',
  [Phase.Duel]: 'SUDDEN KICKOFF',
  [Phase.End]: 'full time',
}

/** interval = survivors x 5s — each shape has its own tempo (idea.md §4) */
export function tickInterval(survivors: number): number {
  return survivors * TICK_SECONDS_PER_SURVIVOR
}

export function isPlayPhase(phase: number): boolean {
  return phase === Phase.Arena || phase === Phase.Overtime || phase === Phase.Duel
}

export const DUEL_CAPACITY = DUEL_METER_CAPACITY_S
