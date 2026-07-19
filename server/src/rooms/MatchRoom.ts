import { Room, type Client } from 'colyseus'
import {
  BALL_RADIUS,
  DRAFT_SECONDS,
  DUEL_METER_CAPACITY_S,
  FIXED_DELTA,
  GRACE_SECONDS,
  HANDOUT_SECONDS,
  LAUNCH_AIM_ARC_DEG,
  LAUNCH_COUNTDOWN_S,
  LAUNCH_DEFAULT_CHARGE,
  PATCH_HZ,
  PLAYERS_MAX,
  RESTART_PAUSE_S,
  TICK_LOCKIN_S,
  TIE_EPSILON_S,
  ZONE_DWELL_GRACE_S,
  WIND_BASE_STRENGTH,
  WIND_ENABLED,
  WIND_STEP_PER_ELIMINATION,
} from '../../../shared/src/constants.ts'
import {
  cannonMouth,
  footprintZone,
  footprintZoneWidths,
  launchFlightTime,
  launchLandingPoint,
  launchVelocity,
  makeArena,
  yawTowardCenter,
  zoneAnchor,
  type Arena,
} from '../../../shared/src/sim/arena.ts'
import { accrueBallTime, tickLosers } from '../../../shared/src/sim/meters.ts'
import {
  applyWindToPlayer,
  clearEvents,
  collidePlayers,
  makeBall,
  makeEvents,
  makePlayer,
  resetBall,
  sampleWind,
  stepBallWithPlayers,
  stepPlayer,
  ZERO_INPUT,
  type PlayerInputFrame,
  type PlayerSim,
} from '../../../shared/src/sim/physics.ts'
import type { NetInput } from '../../../shared/src/sim/net.ts'
import { rollDraftOffer, rollRestartPair, type CardPool } from '../../../shared/src/cards/definitions.ts'
import { computeMods, hasFreeSave, hasMagnetCurse } from '../../../shared/src/cards/effects.ts'
import { DEFAULT_KIT_IDS, KIT_BY_ID, resolveKitClashes } from '../../../shared/src/cosmetics/jerseys.ts'
import { Phase, tickInterval, type PhaseId } from '../../../shared/src/match/phases.ts'
import { Time } from '../../../vendor/arc/scheduler/time.ts'
import { Random } from '../../../vendor/arc/scheduler/random.ts'
import { BallState, HandoutState, MatchState, PlayerState, type MatchStateT } from './schema.ts'

/**
 * M3: the full match spine (idea.md §2). Phase transitions live ONLY here.
 *
 * LOBBY -> DRAFT -> LAUNCH -> ARENA --tick--> RESTART -> LAUNCH ...
 *                        \-> DUEL (at 2 survivors) -> END -> (rematch) LOBBY
 * Ties at a tick insert OVERTIME before RESTART.
 *
 * Room option { fast: true } scales every pause by 0.15 for tests/dev.
 */

const MAX_SEATS = 6
const WS_CLOSE_CONSENTED = 4000
const ADV_IDS = ['overdrive', 'titan', 'slimzone', 'slowmeter', 'bodyguard', 'doubleboost']
const CURSE_IDS = ['leadboots', 'softheader', 'widezone', 'fastmeter', 'magnet', 'jammed']
const REVEAL_S = 2 // handout reveal beat after assignment

interface Session {
  sim: PlayerSim
  queue: NetInput[]
  lastInput: PlayerInputFrame
  lastSeq: number
  aim: number // launch aim offset, radians
  charge: number // launch charge 0..1 (hold-to-charge power)
  aimed: boolean // did the player touch the launch controls this kickoff?
  picks: Partial<Record<CardPool, string>>
  offers: Record<CardPool, string[]> | null
  kitId: string
  isBot: boolean
  bot?: BotBrain
}

/** bot archetypes — the fleet is a MIX so they don't all behave alike:
 *  - keeper  : disciplined wedge defender, clears the ball, low aggression
 *  - hunter  : stalks the nearest OPPONENT and dives to knock them off their feet
 *  - scrapper: high-mobility ball-chaser, contests neutral balls all over, shoves */
type BotKind = 'keeper' | 'hunter' | 'scrapper'
interface BotBrain {
  kind: BotKind
  wanderX: number
  wanderZ: number
  wanderT: number
  targetSeat: number // current opponent a hunter is stalking (-1 = none)
  retargetT: number // seconds until a hunter re-picks its victim
  aggro: number // 0..1 per-bot temperament, jitters jump/dive/sprint odds
}

export class MatchRoom extends Room<{ state: MatchStateT }> {
  override maxClients = PLAYERS_MAX

  #time = new Time({ fixedDelta: FIXED_DELTA })
  #nowMs = 0
  #fast = false
  #rng = new Random('cannonball-server')
  #arena: Arena = makeArena(MAX_SEATS)
  #ball = makeBall()
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
  #overtimeSeats: number[] = []
  #handoutTimer = 0
  #activeHandoutIds = new Set<string>()
  /** debug: physics runs but the match clock (ticks/eliminations) stands still */
  #frozen = false
  /** debug: run the whole sim at 0.35x for slow-motion inspection */
  #slowmo = false
  /** active restart cards per seat — expire at the next restart (idea.md §2) */
  #activeCards: string[][] = Array.from({ length: MAX_SEATS }, () => [])
  #freeSaves: number[] = new Array(MAX_SEATS).fill(0)
  /** how long the ball has continuously dwelt in each seat's zone (grace) */
  #zoneDwell: number[] = new Array(MAX_SEATS).fill(0)

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
      // slowmo: advance the accumulator at 0.35x so fewer fixed steps run.
      // serverTime tracks fixedElapsed, which the client mirrors, so both
      // sides stay in sync — the whole match just runs in slow motion.
      this.#nowMs += this.#slowmo ? deltaMs * 0.35 : deltaMs
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

    this.onMessage('aim', (client, message: { angle?: number; charge?: number }) => {
      if (this.#phase !== Phase.Launch) return
      const session = this.#sessions.get(client.sessionId)
      if (!session) return
      const arc = (LAUNCH_AIM_ARC_DEG * Math.PI) / 360 // half-arc in radians
      if (typeof message?.angle === 'number' && Number.isFinite(message.angle)) {
        session.aim = Math.max(-arc, Math.min(arc, message.angle))
        session.aimed = true
      }
      if (typeof message?.charge === 'number' && Number.isFinite(message.charge)) {
        session.charge = Math.max(0, Math.min(1, message.charge))
        session.aimed = true
      }
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

    this.onMessage('kit', (client, message: { id?: string }) => {
      if (this.#phase !== Phase.Lobby) return // kits lock at match start
      const session = this.#sessions.get(client.sessionId)
      const id = message?.id
      if (!session || typeof id !== 'string' || !KIT_BY_ID.has(id)) return
      session.kitId = id
      this.#resolveKits()
    })

    this.onMessage('name', (client, message: { name?: string }) => {
      const ps = this.state.players.get(client.sessionId)
      const raw = message?.name
      if (!ps || typeof raw !== 'string') return
      // keep only printable chars (code >= 32), collapse spaces, cap at 16
      let clean = ''
      for (const ch of raw) if (ch.charCodeAt(0) >= 32) clean += ch
      clean = clean.replace(/\s+/g, ' ').trim().slice(0, 16)
      if (clean) ps.name = clean
    })

    this.onMessage('emote', (client, message: { id?: number }) => {
      const session = this.#sessions.get(client.sessionId)
      const id = message?.id
      if (!session || typeof id !== 'number' || id < 0 || id > 3) return
      this.broadcast('emote', { seat: session.sim.seat, id })
    })

    this.onMessage('addBot', (client) => {
      if (this.#phase !== Phase.Lobby || client.sessionId !== this.state.hostSessionId) return
      this.#addBot()
    })

    this.onMessage('fillBots', (client) => {
      if (this.#phase !== Phase.Lobby || client.sessionId !== this.state.hostSessionId) return
      while (this.#addBot()) {
        /* fill every free seat */
      }
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
        case 'skipPhase':
          this.#debugSkipPhase()
          break
        case 'instantArena':
          this.#debugInstantArena()
          break
        case 'botPlus':
          this.#debugAddBotLive()
          break
        case 'botMinus':
          this.#debugRemoveBotLive()
          break
        case 'freeze':
          this.#frozen = !this.#frozen
          break
        case 'addTime':
          this.#tickRemaining += this.#scale(15)
          this.state.tickRemaining = this.#tickRemaining
          break
        case 'subTime':
          this.#tickRemaining = Math.max(1, this.#tickRemaining - this.#scale(15))
          this.state.tickRemaining = this.#tickRemaining
          break
        case 'resetScore':
          this.#meters.fill(0)
          this.#cumulative.fill(0)
          for (let s = 0; s < MAX_SEATS; s++) this.state.meters[s] = 0
          break
        case 'resetLobby':
          this.#toLobby()
          break
        case 'winMe':
          if (session && this.#alive[session.sim.seat] && this.#phase !== Phase.Lobby) {
            // eliminate everyone else -> I win
            for (let s = 0; s < MAX_SEATS; s++) {
              if (s !== session.sim.seat && this.#alive[s]) this.#alive[s] = false
            }
            this.state.winnerSeat = session.sim.seat
            this.#enter(Phase.End, 0)
          }
          break
        case 'clearBots':
          for (const [id, s] of [...this.#sessions.entries()]) {
            if (!s.isBot) continue
            this.#sessions.delete(id)
            this.state.players.delete(id)
            this.#alive[s.sim.seat] = false
          }
          if (this.#phase === Phase.Lobby) this.#resolveKits()
          else this.#morphArena()
          break
        case 'slowmo':
          this.#slowmo = !this.#slowmo
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
      charge: 0,
      aimed: false,
      picks: {},
      offers: null,
      kitId: DEFAULT_KIT_IDS[seat] ?? DEFAULT_KIT_IDS[0]!,
      isBot: false,
    })

    const ps = new PlayerState()
    ps.sessionId = client.sessionId
    ps.seat = seat
    ps.name = `Player ${seat + 1}` // a default until they set one in the lobby
    this.state.players.set(client.sessionId, ps)
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId
    this.#resolveKits()
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
    // a freed seat may release a kit clash (kits only move while in the lobby)
    if (this.#phase === Phase.Lobby) this.#resolveKits()
    // a permanent leave mid-match is an elimination (idea.md §5)
    if (session && this.#phase !== Phase.Lobby && this.#phase !== Phase.End && this.#alive[session.sim.seat]) {
      this.#eliminate(session.sim.seat)
    }
  }

  /** clash rule: seat order = priority; the state carries the resolved kit */
  #resolveKits(): void {
    const entries = [...this.#sessions.entries()].sort((a, b) => a[1].sim.seat - b[1].sim.seat)
    const away = resolveKitClashes(entries.map(([, session]) => session.kitId))
    entries.forEach(([id, session], index) => {
      const ps = this.state.players.get(id)
      if (ps) {
        ps.kitId = session.kitId
        ps.kitAway = away[index] ?? false
      }
    })
  }

  #freeSeat(): number {
    const taken = new Set<number>()
    this.state.players.forEach((p) => taken.add(p.seat))
    for (let seat = 0; seat < MAX_SEATS; seat++) if (!taken.has(seat)) return seat
    return -1
  }

  #addBot(): boolean {
    const seat = this.#freeSeat()
    if (seat === -1) return false
    const id = `bot-${seat}-${Math.floor(this.#rng.next() * 1e6)}`
    const sim = makePlayer(seat, 0, 0, 0)
    this.#sessions.set(id, {
      sim,
      queue: [],
      lastInput: { ...ZERO_INPUT },
      lastSeq: 0,
      aim: 0,
      charge: 0,
      aimed: false,
      picks: {},
      offers: null,
      kitId: DEFAULT_KIT_IDS[seat] ?? DEFAULT_KIT_IDS[0]!,
      isBot: true,
      bot: this.#makeBotBrain(),
    })
    const ps = new PlayerState()
    ps.sessionId = id
    ps.seat = seat
    ps.bot = true
    ps.name = `Bot ${seat + 1}`
    this.state.players.set(id, ps)
    this.#resolveKits()
    console.log(`[room ${this.roomId}] bot -> seat ${seat}`)
    return true
  }

  /** a fresh bot brain with a randomized archetype so the fleet is a MIX. The
   *  spread leans playful: keepers defend, hunters harass opponents, scrappers
   *  chase everything. aggro jitters each bot's jump/dive/sprint temperament. */
  #makeBotBrain(): BotBrain {
    const r = this.#rng.next()
    const kind: BotKind = r < 0.4 ? 'keeper' : r < 0.75 ? 'hunter' : 'scrapper'
    return {
      kind,
      wanderX: 0,
      wanderZ: 0,
      wanderT: 0,
      targetSeat: -1,
      retargetT: 0,
      aggro: 0.4 + this.#rng.next() * 0.6,
    }
  }

  /** nearest ALIVE opponent to a seat (never self). Used so hunters go after
   *  EACH OTHER, not gang up on the human. `preferSeat` biases toward a specific
   *  rival (e.g. whoever owns the ball threat) when it's reasonably close. */
  #nearestOpponent(sim: PlayerSim, preferSeat = -1): { seat: number; dist: number } {
    let best = -1
    let bestD = Infinity
    for (const other of this.#sessions.values()) {
      const o = other.sim
      if (o.seat === sim.seat || !this.#alive[o.seat]) continue
      let d = Math.hypot(o.x - sim.x, o.z - sim.z)
      if (o.seat === preferSeat) d *= 0.6 // bias toward the preferred rival
      if (d < bestD) {
        bestD = d
        best = o.seat
      }
    }
    return { seat: best, dist: bestD }
  }

  /** a seat's current sim (or null). */
  #simOfSeat(seat: number): PlayerSim | null {
    for (const s of this.#sessions.values()) if (s.sim.seat === seat) return s.sim
    return null
  }

  /**
   * The M7 bot — personality-driven so the fleet is alive and varied, and bots
   * go after EACH OTHER, not just the human:
   *  - keeper : hold your wedge; when the ball is yours (or neutral + you're
   *             nearest), charge from the wall side, jump close, header it clear.
   *  - hunter : stalk the nearest OPPONENT (biased toward whoever's threatening
   *             the ball) and DIVE into them to knock them off their feet; drop
   *             everything to defend if the ball lands in your own wedge.
   *  - scrapper: race for the ball anywhere it goes, shoving through the pack;
   *             restless, always moving.
   */
  #botInput(session: Session, dt: number): PlayerInputFrame {
    const sim = session.sim
    const bot = session.bot!
    const ball = this.#ball
    const zone = this.#zoneSeat.indexOf(sim.seat)
    const ballZone = footprintZone(this.#arena, ball.x, ball.z)
    const distToBall = Math.hypot(ball.x - sim.x, ball.z - sim.z)
    const ballIsMine = ballZone >= 0 && this.#zoneSeat[ballZone] === sim.seat
    const ballThreatSeat = ballZone >= 0 ? (this.#zoneSeat[ballZone] ?? -1) : -1

    // nearest alive bean to a neutral ball takes initiative (shared by all kinds)
    const nearestToBall = (): boolean => {
      let nearest = Infinity
      let nearestSeat = -1
      for (const other of this.#sessions.values()) {
        if (!this.#alive[other.sim.seat]) continue
        const d = Math.hypot(ball.x - other.sim.x, ball.z - other.sim.z)
        if (d < nearest) {
          nearest = d
          nearestSeat = other.sim.seat
        }
      }
      return nearestSeat === sim.seat
    }

    let tx = sim.x
    let tz = sim.z
    let jump = false
    let dive = false
    let sprint = false
    let ability = false

    // shared "clear the ball" behavior — approach from the wall side then header
    const goClearBall = (): void => {
      const wallAngle = this.#arena.zoneAngles[Math.max(zone, 0)] ?? 0
      const behindX = ball.x + Math.cos(wallAngle) * 2.4
      const behindZ = ball.z + Math.sin(wallAngle) * 2.4
      const distBehind = Math.hypot(behindX - sim.x, behindZ - sim.z)
      if (distBehind > 1.4 && distToBall > 3.6) {
        tx = behindX
        tz = behindZ
        sprint = distBehind > 7
      } else {
        tx = ball.x
        tz = ball.z
        jump = sim.grounded && distToBall < 5
        dive = !sim.grounded && !sim.diving && distToBall < 4.2 && this.#rng.next() < 0.35 + bot.aggro * 0.2
      }
      ability = this.#rng.next() < 0.008
    }

    // restless wander around a home point so idle bots keep MOVING (not standing)
    const wanderAround = (frac: number, spread: number): void => {
      bot.wanderT -= dt
      if (bot.wanderT <= 0) {
        bot.wanderT = 0.8 + this.#rng.next() * 1.8
        bot.wanderX = (this.#rng.next() - 0.5) * spread
        bot.wanderZ = (this.#rng.next() - 0.5) * spread
        if (this.#rng.next() < 0.14 * bot.aggro) jump = sim.grounded
      }
      const anchor = zoneAnchor(this.#arena, Math.max(zone, 0), frac)
      tx = anchor.x + bot.wanderX
      tz = anchor.z + bot.wanderZ
    }

    if (bot.kind === 'hunter') {
      // defend first if the ball is genuinely in MY wedge — survival over sabotage
      if (ballIsMine && distToBall < 12) {
        goClearBall()
      } else {
        // pick / refresh a victim: the nearest opponent, biased toward whoever's
        // currently threatened by the ball (so aggression spreads across rivals).
        bot.retargetT -= dt
        if (bot.retargetT <= 0 || bot.targetSeat < 0 || !this.#alive[bot.targetSeat]) {
          bot.retargetT = 1.5 + this.#rng.next() * 2
          bot.targetSeat = this.#nearestOpponent(sim, ballThreatSeat).seat
        }
        const victim = bot.targetSeat >= 0 ? this.#simOfSeat(bot.targetSeat) : null
        if (victim) {
          const d = Math.hypot(victim.x - sim.x, victim.z - sim.z)
          // drive STRAIGHT at the victim so yaw (which follows movement) locks on;
          // sprint to close and keep barging into them — the running shoves alone
          // knock them off their line and out of position (real disruption).
          tx = victim.x + victim.vx * 0.15
          tz = victim.z + victim.vz * 0.15
          sprint = true
          // DIVE-LAUNCH: the dive lunges along yaw and floats UP, so it lands the
          // major shove best when the victim is ALSO airborne (they meet in the
          // air, small Δy, and only the diver is diving → a real launch). Pounce
          // when close to a jumping/airborne victim who isn't diving; otherwise a
          // low descent-dive right on top of a grounded one. The constant barging
          // (sprint into them above) is the reliable disruption; this is the spike.
          const closeEnough = d < 2.0
          const victimAir = victim.y > 0.5 && !victim.diving
          const levelWith = Math.abs(victim.y - sim.y) < 1.2
          if (closeEnough && !victim.diving) {
            if (victimAir && !sim.grounded && !sim.diving && levelWith) {
              dive = true // both airborne, lined up → LAUNCH them out of the air
            } else if (victimAir && sim.grounded) {
              jump = true // they're up — leap to meet them
            } else if (!victim.diving && sim.grounded && d < 1.3) {
              jump = true // grounded target, right on them — hop to dive next
            } else if (!sim.grounded && !sim.diving && sim.vy < 0 && sim.y < 1.2 && d < 1.3) {
              dive = true // descending onto a grounded victim at point blank
            }
          }
        } else {
          wanderAround(0.5, 8)
        }
      }
    } else if (bot.kind === 'scrapper') {
      // chase the ball wherever it is — contest neutral + others' balls too
      if (ballIsMine || ballZone === -1 || nearestToBall() || distToBall < 9) {
        goClearBall()
        sprint = sprint || distToBall > 6
      } else {
        // shadow the ball's side of the field, restless, ready to pounce
        tx = ball.x * 0.6
        tz = ball.z * 0.6
        sprint = Math.hypot(tx - sim.x, tz - sim.z) > 8
        wanderAround(0.6, 5)
        // still steer toward the ball's half
        tx = (tx + ball.x * 0.6) * 0.5
        tz = (tz + ball.z * 0.6) * 0.5
      }
    } else {
      // keeper: disciplined — clear your ball, else patrol your wedge
      if (ballIsMine || (ballZone === -1 && nearestToBall())) {
        goClearBall()
      } else {
        wanderAround(0.55, 6)
      }
    }

    let dirX = tx - sim.x
    let dirZ = tz - sim.z
    const len = Math.hypot(dirX, dirZ)
    if (len < 0.4) {
      dirX = 0
      dirZ = 0
    } else {
      dirX /= len
      dirZ /= len
    }
    return { dirX, dirZ, jump, dive, sprint, ability }
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
    this.state.winnerSeat = -1
    this.#clearHandout()
    this.#activeCards = Array.from({ length: MAX_SEATS }, () => [])
    this.#freeSaves.fill(0)
    this.#frozen = false
    for (const session of this.#sessions.values()) {
      session.picks = {}
      session.offers = null
      const ps = this.state.players.get(this.#sessionIdOf(session))
      if (ps) {
        ps.alive = true
        ps.cardAbility = ''
        ps.cardEquipment = ''
        ps.cardAdvantage = ''
        ps.activeAdv = ''
        ps.activeCurse = ''
      }
      session.sim.ability = ''
      session.sim.abilityCd = 0
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
      session.sim.ability = session.picks.ability ?? ''
    }
    this.#morphArena()
    this.#beginLaunch()
  }

  /** rebuild arena for current survivors; zoneSeat = alive seats, order stable */
  #morphArena(): void {
    this.#zoneSeat = []
    for (let seat = 0; seat < MAX_SEATS; seat++) if (this.#alive[seat]) this.#zoneSeat.push(seat)
    this.#arena = makeArena(Math.max(2, this.#zoneSeat.length))
    this.state.zoneSeat.splice(0, this.state.zoneSeat.length)
    for (const seat of this.#zoneSeat) this.state.zoneSeat.push(seat)
  }

  /** park survivors LOADED IN THEIR CANNONS on the topmost rim, aim/charge reset */
  #beginLaunch(): void {
    resetBall(this.#ball)
    this.#meters.fill(0)
    this.#zoneDwell.fill(0)
    for (const session of this.#sessions.values()) {
      const sim = session.sim
      if (!this.#alive[sim.seat]) continue
      const zone = this.#zoneSeat.indexOf(sim.seat)
      // sit the bean at the muzzle high on the rim (above the audience), aiming in
      const mouth = cannonMouth(this.#arena, zone)
      sim.x = mouth.x
      sim.y = mouth.y
      sim.z = mouth.z
      sim.vx = sim.vy = sim.vz = 0
      sim.yaw = yawTowardCenter(sim.x, sim.z)
      sim.grounded = false
      sim.diving = false
      sim.knockedCd = 0
      session.aim = 0
      session.charge = 0
      session.aimed = false
    }
    this.#enter(Phase.Launch, this.#scale(LAUNCH_COUNTDOWN_S))
  }

  /** cannon volley: ballistic velocity toward the aimed landing point */
  #fire(): void {
    // per-interval effects refresh: one free save if you carry the card
    for (const session of this.#sessions.values()) {
      const seat = session.sim.seat
      this.#freeSaves[seat] = hasFreeSave(this.#cardsOf(session)) ? 1 : 0
      session.sim.abilityActiveT = 0
    }
    for (const session of this.#sessions.values()) {
      const sim = session.sim
      if (!this.#alive[sim.seat]) continue
      const zone = this.#zoneSeat.indexOf(sim.seat)
      // DEFAULT for players who never touched the controls: mid charge, straight
      // aim — so the launch always works and always lands on the field.
      const aim = session.aimed ? session.aim : 0
      const charge = session.aimed ? session.charge : LAUNCH_DEFAULT_CHARGE
      const land = launchLandingPoint(this.#arena, zone, aim, charge)
      let flight = launchFlightTime(charge)
      if (this.#fast) flight *= 0.6
      const from = { x: sim.x, y: sim.y, z: sim.z }
      const v = launchVelocity(from, land, flight)
      sim.vx = v.x
      sim.vy = v.y
      sim.vz = v.z
      sim.grounded = false
      sim.yaw = yawTowardCenter(land.x, land.z) // face the way you're flying
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
    // handed-out cards expire at the next Restart Kickoff (idea.md §2)
    for (let seat = 0; seat < MAX_SEATS; seat++) this.#activeCards[seat] = []

    const pair = rollRestartPair(this.#rng, this.#activeHandoutIds)
    const handout = this.state.handout
    handout.elimSeat = elimSeat
    handout.advCardId = pair.advantage.id
    handout.curseCardId = pair.curse.id
    handout.advTo = -1
    handout.curseTo = -1
    handout.revealed = false
    this.#handoutTimer = this.#scale(HANDOUT_SECONDS)

    const pauseTotal = this.#scale(RESTART_PAUSE_S)
    this.#enter(Phase.Restart, pauseTotal)

    // eliminated bot or disconnected player? auto-assign immediately
    const elimSession = [...this.#sessions.values()].find((s) => s.sim.seat === elimSeat)
    if (!elimSession || elimSession.isBot) this.#autoAssignHandout()
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
    // M4: the cards are REAL — attached until the next restart
    this.#activeCards[advTo] = [...(this.#activeCards[advTo] ?? []), handout.advCardId]
    this.#activeCards[curseTo] = [...(this.#activeCards[curseTo] ?? []), handout.curseCardId]
    this.#activeHandoutIds = new Set([handout.advCardId, handout.curseCardId])
    // shorten the rest of the pause to the reveal beat
    this.#phaseT = Math.min(this.#phaseT, this.#scale(REVEAL_S))
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
          this.#morphArena()
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
    // M4: refresh each bean's modifier stack from its cards
    let highestMeterSeat = -1
    let highestMeter = -1
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      if (this.#alive[seat] && (this.#meters[seat] ?? 0) > highestMeter) {
        highestMeter = this.#meters[seat] ?? 0
        highestMeterSeat = seat
      }
    }
    for (const session of this.#sessions.values()) {
      session.sim.mods = computeMods(this.#cardsOf(session), {
        meterIsHighest: session.sim.seat === highestMeterSeat && highestMeter > 0,
      })
    }

    // ONE deterministic wind sample this frame (function of the server clock)
    const strength = WIND_BASE_STRENGTH + this.#eliminations * WIND_STEP_PER_ELIMINATION
    const wind = sampleWind(this.#time.fixedElapsed, strength)

    const sims: PlayerSim[] = []
    for (const session of this.#sessions.values()) {
      if (session.isBot) {
        session.lastInput = this.#alive[session.sim.seat] ? this.#botInput(session, dt) : { ...ZERO_INPUT }
      } else {
        const next = session.queue.shift()
        if (next) {
          session.lastInput = next
          session.lastSeq = next.seq
        } else {
          session.lastInput = { ...session.lastInput, jump: false, dive: false, ability: false }
        }
      }
      // the eliminated don't play (they emote from the stands)
      const input = this.#alive[session.sim.seat] ? session.lastInput : ZERO_INPUT
      stepPlayer(session.sim, input, this.#arena, dt)
      // wind catches airborne beans (jumping/diving) — gusts shove harder
      if (this.#windOn && this.#alive[session.sim.seat]) applyWindToPlayer(session.sim, wind, dt)
      sims.push(session.sim)
    }
    // wind deliberately does NOT push the ball — a drifting ball reads as lag
    // Magnet Curse: the ball drifts toward the cursed bean's wedge
    for (const session of this.#sessions.values()) {
      const seat = session.sim.seat
      if (!this.#alive[seat] || !hasMagnetCurse(this.#activeCards[seat] ?? [])) continue
      const zone = this.#zoneSeat.indexOf(seat)
      if (zone < 0) continue
      const anchor = zoneAnchor(this.#arena, zone, 0.6)
      const dx = anchor.x - this.#ball.x
      const dz = anchor.z - this.#ball.z
      const d = Math.hypot(dx, dz)
      if (d > 1) {
        this.#ball.vx += (dx / d) * 2.2 * dt
        this.#ball.vz += (dz / d) * 2.2 * dt
      }
    }
    collidePlayers(sims, this.#alive, this.#events)
    stepBallWithPlayers(this.#ball, sims, this.#alive, this.#arena, dt, this.#events)

    // include impact position/force so the client can spawn juice at the hit
    for (const header of this.#events.headers)
      this.broadcast('header', { seat: header.seat, x: header.x, y: header.y, z: header.z })
    for (const knock of this.#events.knocks)
      this.broadcast('knock', { seat: knock.seat, speed: knock.speed })
    for (const ability of this.#events.abilities) this.broadcast('ability', ability)
    clearEvents(this.#events)

    // debug freeze: everything above (physics, abilities) stays live,
    // everything below (accrual, ticks, eliminations) stands still
    if (this.#frozen) return

    // zone ownership honors Slim/Wide Zone widths (indexed by zone order)
    const widths = this.#zoneSeat.map((seat) => {
      for (const session of this.#sessions.values()) {
        if (session.sim.seat === seat) return session.sim.mods.wedgeWidth
      }
      return 1
    })
    const zone = footprintZoneWidths(this.#arena, this.#ball.x, this.#ball.z, widths)

    if (this.#phase === Phase.Arena) {
      // per-seat DWELL grace: grow the owner's dwell, decay everyone else's,
      // so a ball only starts counting after it's SETTLED in a zone
      const ownerSeat = zone >= 0 ? this.#zoneSeat[zone] : undefined
      for (let s = 0; s < MAX_SEATS; s++) {
        if (s === ownerSeat) this.#zoneDwell[s] = Math.min(2, (this.#zoneDwell[s] ?? 0) + dt)
        else this.#zoneDwell[s] = Math.max(0, (this.#zoneDwell[s] ?? 0) - dt * 2)
      }
      // FINAL-WHISTLE lock-in: freeze accrual in the last second so what you
      // see with 1s left is what resolves (no last-instant flip you can't react to)
      const lockedIn = this.#tickRemaining <= this.#scale(TICK_LOCKIN_S)

      if (ownerSeat !== undefined && this.#alive[ownerSeat] && !lockedIn) {
        const seat = ownerSeat
        // Free Save / Bodyguard: auto-punt the FIRST ball entering your wedge
        if ((this.#meters[seat] ?? 0) === 0 && (this.#freeSaves[seat] ?? 0) > 0) {
          this.#freeSaves[seat] = 0
          const d = Math.hypot(this.#ball.x, this.#ball.z)
          if (d > 0.5) {
            this.#ball.vx = (-this.#ball.x / d) * 15
            this.#ball.vz = (-this.#ball.z / d) * 15
            this.#ball.vy = Math.max(this.#ball.vy, 6)
          }
          this.broadcast('save', { seat })
        } else if ((this.#zoneDwell[seat] ?? 0) >= this.#scale(ZONE_DWELL_GRACE_S)) {
          // only accrue once the ball has DWELT past the grace window
          let rate = 1
          for (const session of this.#sessions.values()) {
            if (session.sim.seat === seat) rate = session.sim.mods.meterRate
          }
          this.#meters[seat] = (this.#meters[seat] ?? 0) + dt * rate
          this.#cumulative[seat] = (this.#cumulative[seat] ?? 0) + dt
        }
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

  // --- debug fast-iteration tools ------------------------------------------------

  /** one button drives the whole flow: lobby starts, waits fast-forward */
  #debugSkipPhase(): void {
    switch (this.#phase) {
      case Phase.Lobby:
        this.#startMatch()
        break
      case Phase.Draft:
        this.#finishDraft()
        break
      case Phase.Launch:
        this.#fire()
        break
      case Phase.Restart:
        if (!this.state.handout.revealed) this.#autoAssignHandout()
        this.#morphArena()
        this.#clearHandout()
        this.#beginLaunch()
        break
      case Phase.End:
        this.#toLobby()
        break
    }
  }

  /** reload-and-play (?dev): lobby or end screen -> LIVE arena, zero waits.
   *  Bots fill every seat, draft auto-picks, the launch is skipped entirely —
   *  everyone starts standing in their wedge with the ball centered. */
  #debugInstantArena(): void {
    if (this.#phase === Phase.End) this.#toLobby()
    if (this.#phase !== Phase.Lobby) return
    while (this.#addBot()) {
      /* fill every free seat */
    }
    this.#startMatch()
    this.#finishDraft() // auto-picks + morph; leaves us parked at the cannons
    for (const session of this.#sessions.values()) {
      const sim = session.sim
      if (!this.#alive[sim.seat]) continue
      const zone = this.#zoneSeat.indexOf(sim.seat)
      const anchor = zoneAnchor(this.#arena, Math.max(zone, 0), 0.65)
      sim.x = anchor.x
      sim.z = anchor.z
      sim.y = 0
      sim.vx = sim.vy = sim.vz = 0
      sim.grounded = true
      sim.diving = false
      sim.yaw = yawTowardCenter(anchor.x, anchor.z)
    }
    resetBall(this.#ball)
    this.#tickRemaining = this.#scale(tickInterval(this.#survivors))
    this.#enter(Phase.Arena, 0)
    this.broadcast('volley', {})
  }

  /** drop a bot straight onto the field mid-match: zones repaint live */
  #debugAddBotLive(): void {
    if (!this.#addBot()) return
    if (this.#phase === Phase.Lobby) return // normal lobby join is enough
    const session = [...this.#sessions.values()].pop()
    if (!session) return
    const seat = session.sim.seat
    this.#alive[seat] = true
    this.#meters[seat] = 0
    this.#cumulative[seat] = 0
    this.#morphArena()
    const zone = this.#zoneSeat.indexOf(seat)
    const anchor = zoneAnchor(this.#arena, Math.max(zone, 0), 0.6)
    session.sim.x = anchor.x
    session.sim.z = anchor.z
    session.sim.y = 0
    session.sim.vx = session.sim.vy = session.sim.vz = 0
    session.sim.yaw = yawTowardCenter(anchor.x, anchor.z)
  }

  /** yank the last-added bot without any elimination ceremony */
  #debugRemoveBotLive(): void {
    const entries = [...this.#sessions.entries()]
    for (let i = entries.length - 1; i >= 0; i--) {
      const [id, session] = entries[i]!
      if (!session.isBot) continue
      // never leave a live match with fewer than 2 beans standing
      if (this.#phase !== Phase.Lobby && this.#alive[session.sim.seat] && this.#survivors <= 2) return
      this.#sessions.delete(id)
      this.state.players.delete(id)
      this.#alive[session.sim.seat] = false
      if (this.#phase === Phase.Lobby) this.#resolveKits()
      else this.#morphArena()
      return
    }
  }

  #cardsOf(session: Session): string[] {
    const seat = session.sim.seat
    return [
      session.picks.ability ?? '',
      session.picks.equipment ?? '',
      session.picks.advantage ?? '',
      ...(this.#activeCards[seat] ?? []),
    ].filter(Boolean)
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
      const actives = this.#activeCards[sim.seat] ?? []
      ps.activeAdv = actives.find((id) => ADV_IDS.includes(id)) ?? ''
      ps.activeCurse = actives.find((id) => CURSE_IDS.includes(id)) ?? ''
      ps.abilityCd = Math.max(0, sim.abilityCd)
    }
    const ball = this.state.ball
    ball.x = this.#ball.x
    ball.y = this.#ball.y
    ball.z = this.#ball.z
    ball.vx = this.#ball.vx
    ball.vy = this.#ball.vy
    ball.vz = this.#ball.vz

    // wind is deterministic from serverTime — replicate only the scalar
    // strength (0 = off) so the client samples the identical field itself
    this.state.windStrength = this.#windOn
      ? WIND_BASE_STRENGTH + this.#eliminations * WIND_STEP_PER_ELIMINATION
      : 0
    // windX/windZ kept for wire-compat but unused; client derives from time
    this.state.windX = 0
    this.state.windZ = 0
    this.state.survivors = this.#survivors
    for (let seat = 0; seat < MAX_SEATS; seat++) this.state.meters[seat] = this.#meters[seat] ?? 0
  }
}
