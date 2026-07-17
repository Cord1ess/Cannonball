import { schema } from '@colyseus/schema'

/**
 * The replicated match state (architecture.md §2), defined via schema v4's
 * runtime factory — no decorators, so it survives any transpiler (tsx, tsc,
 * esbuild) without Symbol.metadata gymnastics. The server sim writes these
 * at 60Hz; Colyseus delta-patches to clients at 20Hz.
 */

export const PlayerState = schema(
  {
    sessionId: { type: 'string', default: '' },
    seat: { type: 'uint8', default: 0 },
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
    lastSeq: { type: 'uint32', default: 0 },
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

export const MatchState = schema(
  {
    serverTime: { type: 'float64', default: 0 },
    survivors: { type: 'uint8', default: 0 },
    tickRemaining: { type: 'float32', default: 30 },
    windX: { type: 'float32', default: 0 },
    windZ: { type: 'float32', default: 0 },
    windStrength: { type: 'float32', default: 0 },
    ball: { type: BallState, default: undefined },
    players: { map: PlayerState },
    meters: ['float32'],
  },
  'MatchState',
)
export type MatchStateT = InstanceType<typeof MatchState>
