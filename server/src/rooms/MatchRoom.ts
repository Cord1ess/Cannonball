import { Room, type Client } from 'colyseus'
import {
  BALL_RADIUS,
  FIXED_DELTA,
  GRACE_SECONDS,
  PATCH_HZ,
  PLAYERS_MAX,
  TICK_SECONDS_PER_SURVIVOR,
  WIND_BASE_STRENGTH,
  WIND_ENABLED,
  WIND_STEP_PER_ELIMINATION,
} from '../../../shared/src/constants.ts'
import { footprintZone, makeArena, yawTowardCenter, zoneAnchor } from '../../../shared/src/sim/arena.ts'
import { accrueBallTime, tickLosers } from '../../../shared/src/sim/meters.ts'
import {
  clearEvents,
  collidePlayers,
  interactBallPlayers,
  makeBall,
  makeEvents,
  makePlayer,
  makeWind,
  resetBall,
  stepBall,
  stepPlayer,
  stepWind,
  ZERO_INPUT,
  type PlayerInputFrame,
  type PlayerSim,
} from '../../../shared/src/sim/physics.ts'
import type { NetInput } from '../../../shared/src/sim/net.ts'
import { Time } from '../../../vendor/arc/scheduler/time.ts'
import { Random } from '../../../vendor/arc/scheduler/random.ts'
import { BallState, MatchState, PlayerState, type BallStateT, type MatchStateT } from './schema.ts'

/**
 * M2: the authoritative arena. Fixed hexagon, up to 6 players, the SAME
 * shared sim the client predicts with, run at 60Hz on the vendored Time.
 * Meters/ticks/eliminations resolve ONLY here. When one player remains,
 * the round auto-resets (the real match state machine is M3).
 */

const SEATS = 6
const WS_CLOSE_CONSENTED = 4000 // colyseus: client.leave() default close code

interface Session {
  sim: PlayerSim
  queue: NetInput[]
  lastInput: PlayerInputFrame
  lastSeq: number
}

export class MatchRoom extends Room<{ state: MatchStateT }> {
  override maxClients = PLAYERS_MAX

  #time = new Time({ fixedDelta: FIXED_DELTA })
  #nowMs = 0
  #arena = makeArena(SEATS)
  #rng = new Random('cannonball-server')
  #ball = makeBall()
  #wind = makeWind()
  #events = makeEvents()
  #sessions = new Map<string, Session>()
  #alive: boolean[] = new Array(SEATS).fill(true)
  #eliminations = 0
  #zoneSeat: number[] = [0, 1, 2, 3, 4, 5] // fixed hexagon in M2
  #meters: number[] = new Array(SEATS).fill(0)
  #tickRemaining = TICK_SECONDS_PER_SURVIVOR * SEATS
  #windOn = WIND_ENABLED

  override onCreate(): void {
    this.setState(new MatchState())
    this.state.ball = new BallState()
    for (let seat = 0; seat < SEATS; seat++) this.state.meters.push(0)
    this.state.tickRemaining = this.#tickRemaining
    this.setPatchRate(1000 / PATCH_HZ) // ball & player positions matter: 30Hz

    // dev/debug commands — every client may drive these during the jam build
    this.onMessage('debug', (client, message: { cmd?: string }) => {
      const session = this.#sessions.get(client.sessionId)
      switch (message?.cmd) {
        case 'resetRound':
          this.#resetRound()
          break
        case 'resetBall':
          resetBall(this.#ball)
          break
        case 'ballToMe':
          if (session) {
            this.#ball.x = session.sim.x + Math.sin(session.sim.yaw) * 5
            this.#ball.z = session.sim.z + Math.cos(session.sim.yaw) * 5
            this.#ball.y = BALL_RADIUS + 3
            this.#ball.vx = this.#ball.vy = this.#ball.vz = 0
          }
          break
        case 'windToggle':
          this.#windOn = !this.#windOn
          break
        case 'elimMe':
          if (session) {
            this.#alive[session.sim.seat] = false
            this.broadcast('elim', { seat: session.sim.seat })
          }
          break
      }
      console.log(`[room ${this.roomId}] debug: ${message?.cmd} from ${client.sessionId}`)
    })

    this.onMessage('input', (client, message: NetInput) => {
      const session = this.#sessions.get(client.sessionId)
      if (!session || typeof message?.seq !== 'number') return
      session.queue.push(message)
      if (session.queue.length > 10) session.queue.splice(0, session.queue.length - 10) // cap latency creep
    })

    this.setSimulationInterval((deltaMs) => {
      this.#nowMs += deltaMs
      this.#time.advance(this.#nowMs)
      const steps = this.#time.consumeFixedSteps()
      for (let i = 0; i < steps; i++) {
        this.#time.beginFixedStep()
        this.#step(FIXED_DELTA)
      }
      this.state.serverTime = this.#time.fixedElapsed
    })

    console.log(`[room ${this.roomId}] arena up`)
  }

  override onJoin(client: Client): void {
    const seat = this.#freeSeat()
    if (seat === -1) throw new Error('room full')

    const anchor = zoneAnchor(this.#arena, seat, 0.65)
    const sim = makePlayer(seat, anchor.x, anchor.z, yawTowardCenter(anchor.x, anchor.z))
    this.#sessions.set(client.sessionId, {
      sim,
      queue: [],
      lastInput: { ...ZERO_INPUT },
      lastSeq: 0,
    })

    const ps = new PlayerState()
    ps.sessionId = client.sessionId
    ps.seat = seat
    ps.x = sim.x
    ps.z = sim.z
    ps.yaw = sim.yaw
    this.state.players.set(client.sessionId, ps)
    console.log(`[room ${this.roomId}] ${client.sessionId} -> seat ${seat}`)
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const ps = this.state.players.get(client.sessionId)
    if (ps) ps.connected = false

    const consented = code === WS_CLOSE_CONSENTED
    if (!consented) {
      try {
        // idea.md §5: grace window — body idles (sim keeps stepping ZERO input)
        await this.allowReconnection(client, GRACE_SECONDS)
        const back = this.state.players.get(client.sessionId)
        if (back) back.connected = true
        return
      } catch {
        // grace expired
      }
    }
    this.#sessions.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
  }

  #freeSeat(): number {
    const taken = new Set<number>()
    this.state.players.forEach((p) => taken.add(p.seat))
    for (let seat = 0; seat < SEATS; seat++) if (!taken.has(seat)) return seat
    return -1
  }

  #step(dt: number): void {
    // 1. players — consume one queued input per step, reuse last (edges cleared)
    const sims: PlayerSim[] = []
    for (const session of this.#sessions.values()) {
      const next = session.queue.shift()
      if (next) {
        session.lastInput = next
        session.lastSeq = next.seq
      } else {
        session.lastInput = { ...session.lastInput, jump: false, dive: false }
      }
      stepPlayer(session.sim, session.lastInput, this.#arena, dt)
      sims.push(session.sim)
    }

    // 2. world
    const strength = WIND_BASE_STRENGTH + this.#eliminations * WIND_STEP_PER_ELIMINATION
    if (this.#windOn) stepWind(this.#wind, this.#rng, strength, this.#ball, dt)
    stepBall(this.#ball, this.#arena, dt, this.#events)
    collidePlayers(sims, this.#alive, this.#events)
    interactBallPlayers(this.#ball, sims, this.#alive, dt, this.#events)

    for (const header of this.#events.headers) this.broadcast('header', { seat: header.seat })
    for (const knock of this.#events.knocks) this.broadcast('knock', { seat: knock.seat })
    clearEvents(this.#events)

    // 3. judgment — server ball only (architecture.md §2)
    const occupiedAlive = this.#alive.map((a, seat) => a && this.#seatOccupied(seat))
    accrueBallTime(this.#meters, this.#zoneSeat, footprintZone(this.#arena, this.#ball.x, this.#ball.z), dt)
    this.#tickRemaining -= dt
    if (this.#tickRemaining <= 0) {
      const losers = tickLosers(this.#meters, occupiedAlive)
      const loser = losers[0]
      if (loser !== undefined) {
        this.#alive[loser] = false
        this.#eliminations++
        this.broadcast('elim', { seat: loser })
      }
      this.#meters.fill(0)
      this.#tickRemaining = TICK_SECONDS_PER_SURVIVOR * SEATS

      const aliveOccupied = occupiedAlive.filter((v, seat) => v && seat !== loser).length
      if (aliveOccupied <= 1 && this.#sessions.size > 1) this.#resetRound()
    }

    // 4. mirror sim -> schema (delta-patched to clients at 20Hz)
    this.#writeState()
  }

  #seatOccupied(seat: number): boolean {
    for (const session of this.#sessions.values()) if (session.sim.seat === seat) return true
    return false
  }

  #resetRound(): void {
    this.#alive.fill(true)
    this.#eliminations = 0
    this.#meters.fill(0)
    this.#tickRemaining = TICK_SECONDS_PER_SURVIVOR * SEATS
    resetBall(this.#ball)
    for (const session of this.#sessions.values()) {
      const anchor = zoneAnchor(this.#arena, session.sim.seat, 0.65)
      session.sim.x = anchor.x
      session.sim.z = anchor.z
      session.sim.y = 0
      session.sim.vx = session.sim.vy = session.sim.vz = 0
      session.sim.yaw = yawTowardCenter(anchor.x, anchor.z)
      session.sim.diving = false
      session.sim.grounded = true
    }
    this.broadcast('round', {})
  }

  #writeState(): void {
    for (const [sessionId, session] of this.#sessions) {
      const ps = this.state.players.get(sessionId)
      if (!ps) continue
      const sim = session.sim
      ps.x = sim.x
      ps.y = sim.y
      ps.z = sim.z
      ps.vx = sim.vx
      ps.vy = sim.vy
      ps.vz = sim.vz
      ps.yaw = sim.yaw
      ps.grounded = sim.grounded
      ps.diving = sim.diving
      ps.knocked = sim.knockedCd > 0
      ps.sprinting = sim.sprinting
      ps.stamina = sim.stamina
      ps.alive = this.#alive[sim.seat] ?? true
      ps.lastSeq = session.lastSeq
    }
    const ball: BallStateT = this.state.ball
    ball.x = this.#ball.x
    ball.y = this.#ball.y
    ball.z = this.#ball.z
    ball.vx = this.#ball.vx
    ball.vy = this.#ball.vy
    ball.vz = this.#ball.vz

    const windLive = this.#windOn && this.#wind.timeLeft > 0
    this.state.windX = windLive ? this.#wind.x : 0
    this.state.windZ = windLive ? this.#wind.z : 0
    this.state.windStrength = windLive
      ? WIND_BASE_STRENGTH + this.#eliminations * WIND_STEP_PER_ELIMINATION
      : 0
    this.state.tickRemaining = this.#tickRemaining
    this.state.survivors = this.#alive.filter(Boolean).length
    for (let seat = 0; seat < SEATS; seat++) this.state.meters[seat] = this.#meters[seat] ?? 0
  }
}
