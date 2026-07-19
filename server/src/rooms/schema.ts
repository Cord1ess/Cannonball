import { schema } from '@colyseus/schema'

/**
 * The replicated match state (architecture.md §2), defined via schema v4's
 * runtime factory — no decorators, so it survives any transpiler (tsx, tsc,
 * esbuild) without Symbol.metadata gymnastics. The server sim writes these
 * at 60Hz; Colyseus delta-patches to clients at 30Hz.
 */

export const PlayerState = schema(
  {
    sessionId: { type: 'string', default: '' },
    seat: { type: 'uint8', default: 0 },
    name: { type: 'string', default: '' },
    x: { type: 'float32', default: 0 },
    y: { type: 'float32', default: 0 },
    z: { type: 'float32', default: 0 },
    vx: { type: 'float32', default: 0 },
    vy: { type: 'float32', default: 0 },
    vz: { type: 'float32', default: 0 },
    yaw: { type: 'float32', default: 0 },
    grounded: { type: 'boolean', default: true },
    diving: { type: 'boolean', default: false },
    knocked: { type: 'boolean', default: false },
    sprinting: { type: 'boolean', default: false },
    stamina: { type: 'float32', default: 100 },
    alive: { type: 'boolean', default: true },
    connected: { type: 'boolean', default: true },
    bot: { type: 'boolean', default: false },
    lastSeq: { type: 'uint32', default: 0 },
    // loadout — revealed publicly at launch (empty until then)
    cardAbility: { type: 'string', default: '' },
    cardEquipment: { type: 'string', default: '' },
    cardAdvantage: { type: 'string', default: '' },
    // active restart cards on this player (expire at the next restart)
    activeAdv: { type: 'string', default: '' },
    activeCurse: { type: 'string', default: '' },
    abilityCd: { type: 'float32', default: 0 },
    // jersey: chosen kit + clash-resolved away flag (server decides both)
    kitId: { type: 'string', default: '' },
    kitAway: { type: 'boolean', default: false },
  },
  'PlayerState',
)
export type PlayerStateT = InstanceType<typeof PlayerState>

export const BallState = schema(
  {
    x: { type: 'float32', default: 0 },
    y: { type: 'float32', default: 0 },
    z: { type: 'float32', default: 0 },
    vx: { type: 'float32', default: 0 },
    vy: { type: 'float32', default: 0 },
    vz: { type: 'float32', default: 0 },
  },
  'BallState',
)
export type BallStateT = InstanceType<typeof BallState>

/** the Restart Kickoff handout, replicated for the public reveal */
export const HandoutState = schema(
  {
    elimSeat: { type: 'int8', default: -1 },
    advCardId: { type: 'string', default: '' },
    curseCardId: { type: 'string', default: '' },
    advTo: { type: 'int8', default: -1 },
    curseTo: { type: 'int8', default: -1 },
    revealed: { type: 'boolean', default: false },
  },
  'HandoutState',
)
export type HandoutStateT = InstanceType<typeof HandoutState>

export const MatchState = schema(
  {
    serverTime: { type: 'float64', default: 0 },
    phase: { type: 'uint8', default: 0 },
    phaseRemaining: { type: 'float32', default: 0 },
    seatsAtStart: { type: 'uint8', default: 0 },
    hostSessionId: { type: 'string', default: '' },
    survivors: { type: 'uint8', default: 0 },
    tickRemaining: { type: 'float32', default: 30 },
    winnerSeat: { type: 'int8', default: -1 },
    mode: { type: 'uint8', default: 0 }, // GameMode: 0 HotZone / 1 FinalWhistle / 2 GoldenBoot
    matchTime: { type: 'uint16', default: 300 }, // total match seconds (per settings)
    windX: { type: 'float32', default: 0 },
    windZ: { type: 'float32', default: 0 },
    windStrength: { type: 'float32', default: 0 },
    ball: { type: BallState, default: undefined },
    handout: { type: HandoutState, default: undefined },
    players: { map: PlayerState },
    meters: ['float32'],
    zoneSeat: ['uint8'],
    overtimeSeats: ['uint8'],
  },
  'MatchState',
)
export type MatchStateT = InstanceType<typeof MatchState>
