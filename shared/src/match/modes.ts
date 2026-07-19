/**
 * GAME MODES + match settings (party-game options set in the lobby).
 *
 * The base game splits into THREE elimination rules. All three share the same
 * spine — cannon launch, danger meters, per-interval tick, restart+morph after
 * each elimination, overtime on ties, sudden-kickoff duel at two. Only WHO the
 * tick eliminates differs:
 *
 *   HOT ZONE     — hosted the ball the LONGEST this interval → out. (the original)
 *   FINAL WHISTLE— caught holding it when the whistle blows (ball's zone at the
 *                  tick moment) → out. A last-second scramble, not accumulation.
 *   GOLDEN BOOT  — a goal on every wall; score in RIVALS' goals; the LOWEST
 *                  scorer this interval → out. Attack + defend, not just dodge.
 *
 * Match length is TOTAL time (the user picks it); the system divides it across
 * the eliminations so the whole match fits, intervals shrinking as players drop.
 */

export const GameMode = {
  HotZone: 0,
  FinalWhistle: 1,
  GoldenBoot: 2,
} as const

export type GameModeId = (typeof GameMode)[keyof typeof GameMode]

export interface GameModeInfo {
  id: GameModeId
  name: string
  tagline: string
  /** one-line rule shown in the lobby */
  rule: string
}

export const GAME_MODES: readonly GameModeInfo[] = [
  {
    id: GameMode.HotZone,
    name: 'HOT ZONE',
    tagline: 'Keep the ball out of your half.',
    rule: 'Whoever hosted the ball the LONGEST this interval is eliminated.',
  },
  {
    id: GameMode.FinalWhistle,
    name: 'FINAL WHISTLE',
    tagline: "Don't be caught holding it.",
    rule: "Whoever's half the ball is in when the whistle blows is eliminated.",
  },
  {
    id: GameMode.GoldenBoot,
    name: 'GOLDEN BOOT',
    tagline: 'Score in their goals, defend yours.',
    rule: 'A goal on every wall — the LOWEST scorer this interval is eliminated.',
  },
] as const

export function gameModeInfo(id: number): GameModeInfo {
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0]!
}

export function isValidGameMode(id: number): id is GameModeId {
  return GAME_MODES.some((m) => m.id === id)
}

// --- MATCH TIME -------------------------------------------------------------
// the user picks a TOTAL match length; the system spreads it across the
// eliminations. Presets keep the lobby simple (no raw number entry).

export interface MatchTimeOption {
  /** total match seconds this option targets (at a full 6-player lobby) */
  totalSeconds: number
  label: string
}

export const MATCH_TIME_OPTIONS: readonly MatchTimeOption[] = [
  { totalSeconds: 180, label: 'Quick · 3 min' },
  { totalSeconds: 300, label: 'Standard · 5 min' },
  { totalSeconds: 480, label: 'Long · 8 min' },
] as const

export const DEFAULT_MATCH_TIME_S = 300 // Standard

/**
 * Per-interval length for the "total ÷ ticks" model. A match that starts with
 * `seatsAtStart` players has `seatsAtStart - 1` eliminations (down to the
 * winner). We keep the classic "intervals shrink as the field thins" feel by
 * weighting each interval by its survivor count, then scaling the whole set so
 * the sum equals the chosen total. The interval for the CURRENT survivor count:
 *
 *   weight(k) = k               (k survivors → longer interval)
 *   sum of weights = Σ k for k = 2..seatsAtStart   (each interval before an elim)
 *   interval(survivors) = totalSeconds * survivors / sumWeights
 *
 * The final duel (2 survivors) uses its own cumulative meter, not this timer,
 * but we still include its weight so the earlier intervals aren't stretched.
 */
export function intervalForMatchTime(
  survivors: number,
  seatsAtStart: number,
  totalSeconds: number,
): number {
  const start = Math.max(2, seatsAtStart)
  // sum of weights k for k = 2..start (intervals happen at 2,3,..,start survivors)
  let sumWeights = 0
  for (let k = 2; k <= start; k++) sumWeights += k
  if (sumWeights <= 0) return totalSeconds
  const s = Math.max(2, Math.min(survivors, start))
  return (totalSeconds * s) / sumWeights
}
