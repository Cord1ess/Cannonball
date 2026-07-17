/**
 * Wire shapes shared by server and client. The server owns the truth;
 * these are just the type contracts for messages and state reads.
 */

/** client -> server, one per fixed step */
export interface NetInput {
  seq: number
  dirX: number
  dirZ: number
  jump: boolean
  dive: boolean
  sprint: boolean
}

/** how the client READS the replicated schema (structural, reflection-decoded) */
export interface NetPlayerRead {
  sessionId: string
  seat: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  grounded: boolean
  diving: boolean
  knocked: boolean
  sprinting: boolean
  stamina: number
  alive: boolean
  connected: boolean
  bot: boolean
  lastSeq: number
  cardAbility: string
  cardEquipment: string
  cardAdvantage: string
}

export interface NetHandoutRead {
  elimSeat: number
  advCardId: string
  curseCardId: string
  advTo: number
  curseTo: number
  revealed: boolean
}

export interface NetBallRead {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export interface NetStateRead {
  serverTime: number
  phase: number
  phaseRemaining: number
  seatsAtStart: number
  hostSessionId: string
  survivors: number
  tickRemaining: number
  halftime: boolean
  winnerSeat: number
  windX: number
  windZ: number
  windStrength: number
  ball: NetBallRead
  handout: NetHandoutRead
  players: {
    get(id: string): NetPlayerRead | undefined
    forEach(cb: (player: NetPlayerRead, id: string) => void): void
    size: number
  }
  meters: ArrayLike<number>
  zoneSeat: ArrayLike<number> & { length: number }
  overtimeSeats: ArrayLike<number> & { length: number }
}

/** server -> client event broadcasts (FX only — state carries the truth) */
export interface HeaderBroadcast {
  seat: number
}

export interface ElimBroadcast {
  seat: number
}
