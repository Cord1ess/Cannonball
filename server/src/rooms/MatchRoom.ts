import { Room, type Client } from 'colyseus'
import {
  BALL_RADIUS,
  DRAFT_SECONDS,
  DUEL_METER_CAPACITY_S,
  FIXED_DELTA,
  GRACE_SECONDS,
  GRAVITY,
  HANDOUT_SECONDS,
  HALFTIME_PAUSE_S,
  LAUNCH_AIM_ARC_DEG,
  LAUNCH_COUNTDOWN_S,
  LAUNCH_FLIGHT_S,
  PATCH_HZ,
  PLAYERS_MAX,
  RESTART_PAUSE_S,
  TIE_EPSILON_S,
  WALL_HEIGHT,
  WIND_BASE_STRENGTH,
  WIND_ENABLED,
  WIND_STEP_PER_ELIMINATION,
} from '../../../shared/src/constants.ts'
import { footprintZone, makeArena, yawTowardCenter, zoneAnchor, type Arena } from '../../../shared/src/sim/arena.ts'
import { accrueBallTime, tickLosers } from '../../../shared/src/sim/meters.ts'
import {
  clearEvents,
  collidePlayers,
  makeBall,
  makeEvents,
  makePlayer,
  makeWind,
  resetBall,
  stepBallWithPlayers,
  stepPlayer,
  stepWind,
  ZERO_INPUT,
  type PlayerInputFrame,
  type PlayerSim,
} from '../../../shared/src/sim/physics.ts'
import type { NetInput } from '../../../shared/src/sim/net.ts'
import { rollDraftOffer, rollRestartPair, type CardPool } from '../../../shared/src/cards/definitions.ts'
import { isHalftimeAt, Phase, tickInterval, type PhaseId } from '../../../shared/src/match/phases.ts'
import { Time } from '../../../vendor/arc/scheduler/time.ts'
import { Random } from '../../../vendor/arc/scheduler/random.ts'
import { BallState, HandoutState, MatchState, PlayerState, type MatchStateT } from './schema.ts'

/**
 * M3: the full match spine (idea.md §2). Phase transitions live ONLY here.
 *
 * LOBBY -> DRAFT -> LAUNCH -> ARENA --tick--> RESTART(±halftime) -> LAUNCH ...
 *                        \-> DUEL (at 2 survivors) -> END -> (rematch) LOBBY
 * Ties at a tick insert OVERTIME before RESTART.
 *
 * Room option { fast: true } scales every pause by 0.15 for tests/dev.
 */

const MAX_SEATS = 6
const WS_CLOSE_CONSENTED = 4000
const REVEAL_S = 2 // handout reveal beat after assignment

interface Session {
  sim: PlayerSim
  queue: NetInput[]
  lastInput: PlayerInputFrame
  lastSeq: number
  aim: number // launch aim offset, radians
  picks: Partial<Record<CardPool, string>>
  offers: Record<CardPool, string[]> | null
}

export class MatchRoom extends Room<{ state: MatchStateT }> {
  override maxClients = PLAYERS_MAX

  #time = new Time({ fixedDelta: FIXED_DELTA })
  #nowMs = 0
  #fast = false
  #rng = new Random('cannonball-server')
  #arena: Arena = makeArena(MAX_SEATS)
  #ball = makeBall()
  #wind = makeWind()
  #windOn = WIND_ENABLED
  #events = makeEvents()
  #sessions = new Map<string, Session>()

  #phase: PhaseId = Phase.Lobby
  #phaseT = 0
  #seatsAtStart = 0
  #alive: boolean[] = new Array(MAX_SEATS).fill(false)
  #zoneSeat: number[] = []
  #meters: number[] = new Array(MAX_SEATS).fill(0)
  #cumulative: number[] = new Array(MAX_SEATS).fill(0) // leader = lowest
  #tickRemaining = 30
  #eliminations = 0
  #halftimeDone = false
  #overtimeSeats: number[] = []
  #handoutTimer = 0
  #activeHandoutIds = new Set<string>()

  #scale(t: number): number {
    return this.#fast ? t * 0.15 : t
  }

  get #survivors(): number {
    return this.#alive.filter(Boolean).length
  }

  override onCreate(options?: { fast?: boolean }): void {
    this.#fast = options?.fast === true
    this.setState(new MatchState())
    this.state.ball = new BallState()
    this.state.handout = new HandoutState()
    for (let seat = 0; seat < MAX_SEATS; seat++) this.state.meters.push(0)
    this.setPatchRate(1000 / PATCH_HZ)

    this.#registerMessages()

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

    console.log(`[room ${this.roomId}] created${this.#fast ? ' (fast)' : ''}`)
  }

  #registerMessages(): void {
    this.onMessage('input', (client, message: NetInput) => {
      const session = this.#sessions.get(client.sessionId)
      if (!session || typeof message?.seq !== 'number') return
      session.queue.push(message)
      if (session.queue.length > 10) session.queue.splice(0, session.queue.length - 10)
    })

    this.onMessage('start', (client) => {
      if (this.#phase !== Phase.Lobby) return
      if (client.sessionId !== this.state.hostSessionId) return
      this.#startMatch()
    })

    this.onMessage('pick', (client, message: { pool?: CardPool; index?: number }) => {
      if (this.#phase !== Phase.Draft) return
      const session = this.#sessions.get(client.sessionId)
      const pool = message?.pool
      const index = message?.index
      if (!session?.offers || !pool || typeof index !== 'number') return
      const id = session.offers[pool]?.[index]
      if (id) session.picks[pool] = id
    })

    this.onMessage('aim', (client, message: { angle?: number }) => {
      if (this.#phase !== Phase.Launch) return
      const session = this.#sessions.get(client.sessionId)
      if (!session || typeof message?.angle !== 'number' || !Number.isFinite(message.angle)) return
      const arc = (LAUNCH_AIM_ARC_DEG * Math.PI) / 360 // half-arc in radians
      session.aim = Math.max(-arc, Math.min(arc, message.angle))
    })

    this.onMessage('assign', (client, message: { advTo?: number; curseTo?: number }) => {
      if (this.#phase !== Phase.Restart || this.state.handout.revealed) return
      const session = this.#sessions.get(client.sessionId)
      if (!session || session.sim.seat !== this.state.handout.elimSeat) return
      const advTo = message?.advTo
      const curseTo = message?.curseTo
      if (typeof advTo !== 'number' || typeof curseTo !== 'number') return
      if (!this.#alive[advTo] || !this.#alive[curseTo]) return
      this.#applyHandout(advTo, curseTo)
    })

    this.onMessage('emote', (client, message: { id?: number }) => {
      const session = this.#sessions.get(client.sessionId)
      const id = message?.id
      if (!session || typeof id !== 'number' || id < 0 || id > 3) return
      this.broadcast('emote', { seat: session.sim.seat, id })
    })

    this.onMessage('rematch', (client) => {
      if (this.#phase !== Phase.End) return
      if (client.sessionId !== this.state.hostSessionId) return
      this.#toLobby()
    })

    // dev/debug commands
    this.onMessage('debug', (client, message: { cmd?: string }) => {
      const session = this.#sessions.get(client.sessionId)
      switch (message?.cmd) {
        case 'resetRound':
          if (this.#phase !== Phase.Lobby && this.#phase !== Phase.End) this.#startMatch()
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
          if (session && this.#alive[session.sim.seat] && this.#phase !== Phase.Lobby) {
            this.#eliminate(session.sim.seat)
          }
          break
      }
      console.log(`[room ${this.roomId}] debug: ${message?.cmd}`)
    })
  }

  // --- joins / leaves ------------------------------------------------------------

  override onJoin(client: Client): void {
    if (this.#phase !== Phase.Lobby) throw new Error('match in progress')
    const seat = this.#freeSeat()
    if (seat === -1) throw new Error('room full')

    const sim = makePlayer(seat, 0, 0, 0)
    this.#sessions.set(client.sessionId, {
      sim,
      queue: [],
      lastInput: { ...ZERO_INPUT },
      lastSeq: 0,
      aim: 0,
      picks: {},
      offers: null,
    })

    const ps = new PlayerState()
    ps.sessionId = client.sessionId
    ps.seat = seat
    this.state.players.set(client.sessionId, ps)
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId
    console.log(`[room ${this.roomId}] ${client.sessionId} -> seat ${seat}`)
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const ps = this.state.players.get(client.sessionId)
    if (ps) ps.connected = false

    const consented = code === WS_CLOSE_CONSENTED
    if (!consented) {
      try {
        await this.allowReconnection(client, GRACE_SECONDS)
        const back = this.state.players.get(client.sessionId)
        if (back) back.connected = true
        return
      } catch {
        /* grace expired */
      }
    }
    const session = this.#sessions.get(client.sessionId)
    this.#sessions.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (client.sessionId === this.state.hostSessionId) {
      this.state.hostSessionId = this.#sessions.keys().next().value ?? ''
    }
    // a permanent leave mid-match is an elimination (idea.md §5)
    if (session && this.#phase !== Phase.Lobby && this.#phase !== Phase.End && this.#alive[session.sim.seat]) {
      this.#eliminate(session.sim.seat)
    }
  }

  #freeSeat(): number {
    const taken = new Set<number>()
    this.state.players.forEach((p) => taken.add(p.seat))
    for (let seat = 0; seat < MAX_SEATS; seat++) if (!taken.has(seat)) return seat
    return -1
  }

  // --- phase transitions -----------------------------------------------------------

  #enter(phase: PhaseId, duration: number): void {
    this.#phase = phase
    this.#phaseT = duration
    this.state.phase = phase
    this.state.phaseRemaining = duration
  }

  #toLobby(): void {
    this.#alive.fill(false)
    this.#meters.fill(0)
    this.#cumulative.fill(0)
    this.#zoneSeat = []
    this.#eliminations = 0
    this.#halftimeDone = false
    this.state.winnerSeat = -1
    this.state.halftime = false
    this.#clearHandout()
    for (const session of this.#sessions.values()) {
      session.picks = {}
      session.offers = null
      const ps = this.state.players.get(this.#sessionIdOf(session))
      if (ps) {
        ps.alive = true
        ps.cardAbility = ''
        ps.cardEquipment = ''
        ps.cardAdvantage = ''
      }
    }
    this.#enter(Phase.Lobby, 0)
  }

  #sessionIdOf(target: Session): string {
    for (const [id, session] of this.#sessions) if (session === target) return id
    return ''
  }

  #startMatch(): void {
    const count = this.#sessions.size
    if (count < 1) return
    this.#seatsAtStart = count
    this.state.seatsAtStart = count
    this.#alive.fill(false)
    for (const session of this.#sessions.values()) this.#alive[session.sim.seat] = true
    this.#meters.fill(0)
    this.#cumulative.fill(0)
    this.#eliminations = 0
    this.#halftimeDone = false
    this.state.winnerSeat = -1
    this.#clearHandout()

    // draft offers, per player, private
    for (const [id, session] of this.#sessions) {
      session.picks = {}
      session.offers = {
        ability: rollDraftOffer(this.#rng, 'ability').map((c) => c.id),
        equipment: rollDraftOffer(this.#rng, 'equipment').map((c) => c.id),
        advantage: rollDraftOffer(this.#rng, 'advantage').map((c) => c.id),
      }
      const client = this.clients.find((c) => c.sessionId === id)
      client?.send('draftOffer', session.offers)
    }
    this.#enter(Phase.Draft, this.#scale(DRAFT_SECONDS))
    console.log(`[room ${this.roomId}] match start: ${count} players`)
  }

  #finishDraft(): void {
    for (const [id, session] of this.#sessions) {
      if (!session.offers) continue
      for (const pool of ['ability', 'equipment', 'advantage'] as const) {
        if (!session.picks[pool]) {
          const offer = session.offers[pool]
          session.picks[pool] = offer[Math.floor(this.#rng.next() * offer.length)] ?? ''
        }
      }
      const ps = this.state.players.get(id)
      if (ps) {
        // public reveal at launch (idea.md §2)
        ps.cardAbility = session.picks.ability ?? ''
        ps.cardEquipment = session.picks.equipment ?? ''
        ps.cardAdvantage = session.picks.advantage ?? ''
      }
    }
    this.#morphArena()
    this.#beginLaunch()
  }

  /** rebuild arena for current survivors; zoneSeat = alive seats (shuffled at halftime) */
  #morphArena(shuffle = false): void {
    this.#zoneSeat = []
    for (let seat = 0; seat < MAX_SEATS; seat++) if (this.#alive[seat]) this.#zoneSeat.push(seat)
    if (shuffle) {
      for (let i = this.#zoneSeat.length - 1; i > 0; i--) {
        const j = Math.floor(this.#rng.next() * (i + 1))
        ;[this.#zoneSeat[i], this.#zoneSeat[j]] = [this.#zoneSeat[j]!, this.#zoneSeat[i]!]
      }
    }
    this.#arena = makeArena(Math.max(this.#zoneSeat.length, this.#zoneSeat.length === 2 ? 2 : 3))
    this.state.zoneSeat.splice(0, this.state.zoneSeat.length)
    for (const seat of this.#zoneSeat) this.state.zoneSeat.push(seat)
  }

  /** park survivors at their cannons on the wall crown, aim resets */
  #beginLaunch(): void {
    resetBall(this.#ball)
    this.#meters.fill(0)
    for (const session of this.#sessions.values()) {
      const sim = session.sim
      if (!this.#alive[sim.seat]) continue
      const zone = this.#zoneSeat.indexOf(sim.seat)
      const angle = this.#arena.circle ? (zone === 0 ? 0 : Math.PI) : (this.#arena.wallAngles[zone] ?? 0)
      sim.x = Math.cos(angle) * (this.#arena.apothem - 0.6)
      sim.z = Math.sin(angle) * (this.#arena.apothem - 0.6)
      sim.y = WALL_HEIGHT + 0.4
      sim.vx = sim.vy = sim.vz = 0
      sim.yaw = yawTowardCenter(sim.x, sim.z)
      sim.grounded = false
      sim.diving = false
      sim.knockedCd = 0
      session.aim = 0
    }
    this.#enter(Phase.Launch, this.#scale(LAUNCH_COUNTDOWN_S))
  }

  /** cannon volley: ballistic velocity toward the aimed landing point */
  #fire(): void {
    const flight = this.#fast ? LAUNCH_FLIGHT_S * 0.6 : LAUNCH_FLIGHT_S
    for (const session of this.#sessions.values()) {
      const sim = session.sim
      if (!this.#alive[sim.seat]) continue
      const zone = this.#zoneSeat.indexOf(sim.seat)
      const baseAngle = this.#arena.circle ? (zone === 0 ? 0 : Math.PI) : (this.#arena.wallAngles[zone] ?? 0)
      const landAngle = baseAngle + session.aim
      const tx = Math.cos(landAngle) * this.#arena.apothem * 0.5
      const tz = Math.sin(landAngle) * this.#arena.apothem * 0.5
      sim.vx = (tx - sim.x) / flight
      sim.vz = (tz - sim.z) / flight
      sim.vy = (0.5 * GRAVITY * flight * flight - sim.y) / flight
      sim.grounded = false
    }
    this.#tickRemaining = this.#scale(tickInterval(this.#survivors))
    if (this.#survivors <= 2 && this.#seatsAtStart >= 2) {
      this.#meters.fill(0) // duel meters are cumulative from zero
      this.#enter(Phase.Duel, 0)
    } else {
      this.#enter(Phase.Arena, 0)
    }
    this.broadcast('volley', {})
  }

  #eliminate(seat: number): void {
    this.#alive[seat] = false
    this.#eliminations++
    this.broadcast('elim', { seat })

    if (this.#survivors <= 1) {
      const winner = this.#alive.findIndex(Boolean)
      this.state.winnerSeat = winner
      this.#enter(Phase.End, 0)
      return
    }
    this.#beginRestart(seat)
  }

  #beginRestart(elimSeat: number): void {
    resetBall(this.#ball)
    this.#meters.fill(0)
    const halftime = !this.#halftimeDone && isHalftimeAt(this.#survivors, this.#seatsAtStart)
    if (halftime) this.#halftimeDone = true
    this.state.halftime = halftime

    const pair = rollRestartPair(this.#rng, this.#activeHandoutIds)
    const handout = this.state.handout
    handout.elimSeat = elimSeat
    handout.advCardId = pair.advantage.id
    handout.curseCardId = pair.curse.id
    handout.advTo = -1
    handout.curseTo = -1
    handout.revealed = false
    this.#handoutTimer = this.#scale(HANDOUT_SECONDS)

    const pauseTotal = this.#scale(halftime ? HALFTIME_PAUSE_S : RESTART_PAUSE_S)
    this.#enter(Phase.Restart, pauseTotal)

    // eliminated player disconnected? auto-assign immediately
    const elimSession = [...this.#sessions.values()].find((s) => s.sim.seat === elimSeat)
    if (!elimSession) this.#autoAssignHandout()
  }

  /** timeout rule (idea.md §2): curse -> leader (lowest cumulative), advantage -> random other */
  #autoAssignHandout(): void {
    let leader = -1
    let best = Infinity
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      if (this.#alive[seat] && (this.#cumulative[seat] ?? 0) < best) {
        best = this.#cumulative[seat] ?? 0
        leader = seat
      }
    }
    const others = this.#zoneSeat.filter((s) => this.#alive[s] && s !== leader)
    const advTo = others.length > 0 ? others[Math.floor(this.#rng.next() * others.length)]! : leader
    this.#applyHandout(advTo, leader)
  }

  #applyHandout(advTo: number, curseTo: number): void {
    const handout = this.state.handout
    handout.advTo = advTo
    handout.curseTo = curseTo
    handout.revealed = true
    // effects land in M4 — for now the cards are pure spectacle
    this.#activeHandoutIds = new Set([handout.advCardId, handout.curseCardId])
    // shorten the rest of the pause to the reveal beat
    this.#phaseT = Math.min(this.#phaseT, this.#scale(this.state.halftime ? REVEAL_S * 3 : REVEAL_S))
    this.state.phaseRemaining = this.#phaseT
  }

  #clearHandout(): void {
    const handout = this.state.handout
    if (!handout) return
    handout.elimSeat = -1
    handout.advCardId = ''
    handout.curseCardId = ''
    handout.advTo = -1
    handout.curseTo = -1
    handout.revealed = false
  }

  // --- the fixed step ------------------------------------------------------------------

  #step(dt: number): void {
    this.#phaseT -= dt
    this.state.phaseRemaining = Math.max(0, this.#phaseT)

    switch (this.#phase) {
      case Phase.Lobby:
        break

      case Phase.Draft:
        if (this.#phaseT <= 0) this.#finishDraft()
        break

      case Phase.Launch: {
        // frozen at the cannons; aim messages already applied
        if (this.#phaseT <= 0) this.#fire()
        break
      }

      case Phase.Restart: {
        if (!this.state.handout.revealed) {
          this.#handoutTimer -= dt
          if (this.#handoutTimer <= 0) this.#autoAssignHandout()
        }
        if (this.#phaseT <= 0) {
          this.#morphArena(this.state.halftime)
          this.state.halftime = false
          this.#clearHandout()
          this.#beginLaunch()
        }
        break
      }

      case Phase.Arena:
      case Phase.Overtime:
      case Phase.Duel:
        this.#stepPlay(dt)
        break

      case Phase.End:
        break
    }

    this.#writeState()
  }

  #stepPlay(dt: number): void {
    const sims: PlayerSim[] = []
    for (const session of this.#sessions.values()) {
      const next = session.queue.shift()
      if (next) {
        session.lastInput = next
        session.lastSeq = next.seq
      } else {
        session.lastInput = { ...session.lastInput, jump: false, dive: false }
      }
      // the eliminated don't play (they emote from the stands)
      const input = this.#alive[session.sim.seat] ? session.lastInput : ZERO_INPUT
      stepPlayer(session.sim, input, this.#arena, dt)
      sims.push(session.sim)
    }

    const strength = WIND_BASE_STRENGTH + this.#eliminations * WIND_STEP_PER_ELIMINATION
    if (this.#windOn) stepWind(this.#wind, this.#rng, strength, this.#ball, dt)
    collidePlayers(sims, this.#alive, this.#events)
    stepBallWithPlayers(this.#ball, sims, this.#alive, this.#arena, dt, this.#events)

    for (const header of this.#events.headers) this.broadcast('header', { seat: header.seat })
    for (const knock of this.#events.knocks) this.broadcast('knock', { seat: knock.seat })
    clearEvents(this.#events)

    const zone = footprintZone(this.#arena, this.#ball.x, this.#ball.z)

    if (this.#phase === Phase.Arena) {
      accrueBallTime(this.#meters, this.#zoneSeat, zone, dt)
      if (zone >= 0) {
        const seat = this.#zoneSeat[zone]
        if (seat !== undefined) this.#cumulative[seat] = (this.#cumulative[seat] ?? 0) + dt
      }
      this.#tickRemaining -= dt
      this.state.tickRemaining = this.#tickRemaining
      if (this.#tickRemaining <= 0) this.#resolveTick()
    } else if (this.#phase === Phase.Overtime) {
      // only tied zones are live; first accrual loses (idea.md §1)
      if (zone >= 0) {
        const seat = this.#zoneSeat[zone]
        if (seat !== undefined && this.#overtimeSeats.includes(seat)) {
          this.#meters[seat] = (this.#meters[seat] ?? 0) + dt
          if ((this.#meters[seat] ?? 0) > TIE_EPSILON_S) {
            this.#overtimeSeats = []
            this.state.overtimeSeats.splice(0, this.state.overtimeSeats.length)
            this.#eliminate(seat)
            return
          }
        }
      }
    } else if (this.#phase === Phase.Duel) {
      // cumulative duel meters — first to capacity loses (idea.md §2)
      if (zone >= 0) {
        const seat = this.#zoneSeat[zone]
        if (seat !== undefined && this.#alive[seat]) {
          this.#meters[seat] = (this.#meters[seat] ?? 0) + dt
          if ((this.#meters[seat] ?? 0) >= DUEL_METER_CAPACITY_S) {
            this.#eliminate(seat)
            return
          }
        }
      }
    }
  }

  #resolveTick(): void {
    const occupiedAlive = this.#alive.map((a, seat) => a && this.#seatOccupied(seat))
    const losers = tickLosers(this.#meters, occupiedAlive)
    if (losers.length === 0) {
      // nothing accrued: fresh interval, no elimination
      this.#meters.fill(0)
      this.#tickRemaining = this.#scale(tickInterval(this.#survivors))
      return
    }
    if (losers.length === 1) {
      this.#eliminate(losers[0]!)
      return
    }
    // exact tie -> OVERTIME micro-round: ball recenters, only tied zones live
    this.#overtimeSeats = losers
    this.state.overtimeSeats.splice(0, this.state.overtimeSeats.length)
    for (const seat of losers) this.state.overtimeSeats.push(seat)
    this.#meters.fill(0)
    resetBall(this.#ball)
    this.broadcast('overtime', { seats: losers })
    this.#enter(Phase.Overtime, 0)
  }

  #seatOccupied(seat: number): boolean {
    for (const session of this.#sessions.values()) if (session.sim.seat === seat) return true
    return false
  }

  // --- schema mirror ---------------------------------------------------------------------

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
      ps.alive = this.#alive[sim.seat] ?? false
      ps.lastSeq = session.lastSeq
    }
    const ball = this.state.ball
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
    this.state.survivors = this.#survivors
    for (let seat = 0; seat < MAX_SEATS; seat++) this.state.meters[seat] = this.#meters[seat] ?? 0
  }
}
