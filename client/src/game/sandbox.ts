import * as THREE from 'three'
import {
  FIXED_DELTA,
  MOVE_SPEED,
  TICK_SECONDS_PER_SURVIVOR,
  WIND_BASE_STRENGTH,
  WIND_STEP_PER_ELIMINATION,
} from '@shared/constants.ts'
import { footprintZone, makeArena, yawTowardCenter, zoneAnchor, type Arena } from '@shared/sim/arena.ts'
import { accrueBallTime, tickLosers } from '@shared/sim/meters.ts'
import {
  interactBallPlayers,
  makeBall,
  makePlayer,
  makeWind,
  resetBall,
  stepBall,
  stepPlayer,
  stepWind,
  type PlayerInputFrame,
  type PlayerSim,
  type SimEvents,
} from '@shared/sim/physics.ts'
import { Random } from '@vendor/scheduler/random.ts'
import { createArenaView, type ArenaView } from '../render/arenaView.ts'
import { createBallView, type BallView } from '../render/ballView.ts'
import { createBean, type Bean } from '../render/bean.ts'
import { PALETTE } from '../render/palette.ts'
import type { ChaseCamera } from './camera.ts'
import type { Hud, HudZone } from './hud.ts'

/**
 * M1 offline sandbox: seat 0 is the player, seats 1-5 are standing dummies.
 * Full local match loop — meters, ticks, eliminations, morphs — to fun-test
 * the header before netcode exists. Replaced by the server room in M2.
 */

export const SEAT_COLORS = [
  PALETTE.teamRed,
  PALETTE.teamBlue,
  PALETTE.teamYellow,
  PALETTE.teamGreen,
  PALETTE.teamViolet,
  PALETTE.teamOrange,
] as const

const SEATS = 6

interface Snapshot {
  x: number
  y: number
  z: number
}

export interface Sandbox {
  fixedStep(input: PlayerInputFrame): void
  /** render-frame update; alpha interpolates between the last two fixed steps */
  frameUpdate(dt: number, alpha: number): void
  reset(): void
  readonly player: PlayerSim
  readonly gameOver: boolean
  hudZones(): HudZone[]
  tickRemaining: number
  ballAlarm(): boolean
}

export function createSandbox(scene: THREE.Scene, camera: ChaseCamera, hud: Hud): Sandbox {
  const rng = new Random('cannonball-sandbox')

  let arena: Arena = makeArena(SEATS)
  let arenaView: ArenaView | null = null
  let zoneSeat: number[] = []
  const alive: boolean[] = new Array(SEATS).fill(true)
  const meters: number[] = new Array(SEATS).fill(0)
  let survivors = SEATS
  let eliminations = 0
  let gameOver = false

  const players: PlayerSim[] = []
  const beans: Bean[] = []
  for (let seat = 0; seat < SEATS; seat++) {
    players.push(makePlayer(seat, 0, 0, 0))
    const bean = createBean(SEAT_COLORS[seat] ?? PALETTE.teamRed)
    beans.push(bean)
    scene.add(bean.group)
  }

  const ball = makeBall()
  const ballView: BallView = createBallView()
  scene.add(ballView.group)

  const wind = makeWind()
  const events: SimEvents = { headers: [], bounces: 0 }

  const prevBall: Snapshot = { x: 0, y: 0, z: 0 }
  const prevPlayer: Snapshot = { x: 0, y: 0, z: 0 }

  const sandbox: Sandbox = {
    player: players[0]!,
    get gameOver() {
      return gameOver
    },
    tickRemaining: TICK_SECONDS_PER_SURVIVOR * SEATS,

    reset(): void {
      alive.fill(true)
      meters.fill(0)
      survivors = SEATS
      eliminations = 0
      gameOver = false
      hud.showEnd(null)
      rebuildArena()
      resetBall(ball)
      sandbox.tickRemaining = TICK_SECONDS_PER_SURVIVOR * survivors
    },

    fixedStep(input: PlayerInputFrame): void {
      if (gameOver) return
      const dt = FIXED_DELTA

      prevPlayer.x = players[0]!.x
      prevPlayer.y = players[0]!.y
      prevPlayer.z = players[0]!.z
      prevBall.x = ball.x
      prevBall.y = ball.y
      prevBall.z = ball.z

      stepPlayer(players[0]!, input, arena, dt)
      // dummies just face the ball (visual only, they never move)
      for (let seat = 1; seat < SEATS; seat++) {
        const dummy = players[seat]!
        if (alive[seat]) dummy.yaw = Math.atan2(ball.x - dummy.x, ball.z - dummy.z)
      }

      stepWind(wind, rng, WIND_BASE_STRENGTH + eliminations * WIND_STEP_PER_ELIMINATION, ball, dt)
      stepBall(ball, arena, dt, events)
      interactBallPlayers(ball, players, alive, dt, events)

      for (const header of events.headers) {
        beans[header.seat]?.header()
        if (header.seat === 0) camera.kick(0.6)
      }
      events.headers.length = 0
      events.bounces = 0

      accrueBallTime(meters, zoneSeat, footprintZone(arena, ball.x, ball.z), dt)

      sandbox.tickRemaining -= dt
      if (sandbox.tickRemaining <= 0) resolveTick()
    },

    frameUpdate(dt: number, alpha: number): void {
      const p = players[0]!
      const px = prevPlayer.x + (p.x - prevPlayer.x) * alpha
      const py = prevPlayer.y + (p.y - prevPlayer.y) * alpha
      const pz = prevPlayer.z + (p.z - prevPlayer.z) * alpha
      const run = Math.min(1, Math.hypot(p.vx, p.vz) / MOVE_SPEED)
      beans[0]!.update(dt, { x: px, y: py, z: pz, yaw: p.yaw, run, grounded: p.grounded })
      beans[0]!.group.visible = alive[0] ?? false

      for (let seat = 1; seat < SEATS; seat++) {
        const dummy = players[seat]!
        beans[seat]!.group.visible = alive[seat] ?? false
        beans[seat]!.update(dt, { x: dummy.x, y: dummy.y, z: dummy.z, yaw: dummy.yaw, run: 0, grounded: true })
      }

      const bx = prevBall.x + (ball.x - prevBall.x) * alpha
      const by = prevBall.y + (ball.y - prevBall.y) * alpha
      const bz = prevBall.z + (ball.z - prevBall.z) * alpha
      const zone = footprintZone(arena, bx, bz)
      const zoneColorHex = zone >= 0 ? (SEAT_COLORS[zoneSeat[zone] ?? 0] ?? null) : null
      ballView.update(bx, by, bz, zoneColorHex)

      const interval = TICK_SECONDS_PER_SURVIVOR * survivors
      arenaView?.setDanger(zoneSeat.map((seat) => (meters[seat] ?? 0) / Math.max(1, interval * 0.5)))

      camera.update(dt, px, py, pz)
    },

    hudZones(): HudZone[] {
      const interval = TICK_SECONDS_PER_SURVIVOR * survivors
      return zoneSeat.map((seat) => ({
        color: `#${(SEAT_COLORS[seat] ?? 0).toString(16).padStart(6, '0')}`,
        frac: (meters[seat] ?? 0) / Math.max(1, interval * 0.5),
        isPlayer: seat === 0,
      }))
    },

    ballAlarm(): boolean {
      if (!alive[0]) return false
      const zone = footprintZone(arena, ball.x, ball.z)
      return zone >= 0 && zoneSeat[zone] === 0
    },
  }

  function rebuildArena(): void {
    arena = makeArena(survivors)
    zoneSeat = []
    for (let seat = 0; seat < SEATS; seat++) if (alive[seat]) zoneSeat.push(seat)

    if (arenaView) {
      scene.remove(arenaView.group)
      arenaView.dispose()
    }
    const zoneColors = zoneSeat.map((seat) => SEAT_COLORS[seat] ?? PALETTE.warmGray)
    arenaView = createArenaView(arena, zoneColors)
    scene.add(arenaView.group)

    // everyone to their wedge anchor, facing center (cannon launch stand-in)
    for (let zone = 0; zone < zoneSeat.length; zone++) {
      const seat = zoneSeat[zone]!
      const player = players[seat]!
      const anchor = zoneAnchor(arena, zone, 0.65)
      player.x = anchor.x
      player.z = anchor.z
      player.y = 0
      player.vx = player.vy = player.vz = 0
      player.grounded = true
      player.yaw = yawTowardCenter(anchor.x, anchor.z)
      if (seat === 0) camera.yaw = player.yaw
    }
  }

  function resolveTick(): void {
    const losers = tickLosers(meters, alive)
    const loser = losers[0] // M1: first of ties; the overtime micro-round is M3's job
    if (loser === undefined) return

    alive[loser] = false
    survivors--
    eliminations++
    meters.fill(0)

    if (loser === 0) {
      gameOver = true
      hud.showEnd('ELIMINATED\npress R to run it back')
      return
    }
    if (survivors <= 1) {
      gameOver = true
      hud.showEnd('LAST BEAN STANDING\npress R to run it back')
      return
    }

    rebuildArena()
    resetBall(ball)
    sandbox.tickRemaining = TICK_SECONDS_PER_SURVIVOR * survivors
  }

  sandbox.reset()
  return sandbox
}
