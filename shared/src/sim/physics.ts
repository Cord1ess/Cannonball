import {
  ACCEL_AIR,
  ACCEL_GROUND,
  BALL_DEFLECT_RESTITUTION,
  BALL_DRAG,
  BALL_GRAVITY,
  BALL_KNOCK_FORCE,
  BALL_KNOCK_MIN_SPEED,
  BALL_KNOCK_POP,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BODY_NUDGE_FORCE,
  DIVE_FORCE,
  DIVE_PUSH,
  DIVE_RECOVERY_S,
  DIVE_UP,
  GRAVITY,
  HEADER_COOLDOWN_S,
  HEADER_MARGIN,
  HEADER_POWER,
  HEADER_UP_BIAS,
  JUMP_SPEED,
  KNOCK_STUN_S,
  PLAYER_PUSH,
  PLAYER_RADIUS,
  RUN_SPEED,
  SPRINT_DRAIN,
  SPRINT_SPEED,
  STAMINA_MAX,
  STAMINA_REGEN,
  DIVE_COST,
  TURN_RATE,
  WIND_GUST_DURATION_S,
  WIND_GUST_PERIOD_S,
} from '../constants.ts'
import type { Arena } from './arena.ts'

/**
 * The whole game's physics: hand-rolled arcade simulation, three-free and
 * Node-safe (architecture.md §3). Fixed-step only — dt is always FIXED_DELTA.
 *
 * Facing convention: yaw 0 looks down +Z; forward = (sin(yaw), cos(yaw)) in XZ.
 * Beans face their MOVEMENT direction (the camera is free). The DIVE (while
 * airborne, costs stamina) lunges along facing; diving into the ball is the
 * header. Shift-sprint drains stamina, running refills it.
 */

export interface BallSim {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export interface PlayerSim {
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
  sprinting: boolean
  stamina: number
  recoverCd: number
  headerCd: number
  knockedCd: number
}

export interface PlayerInputFrame {
  /** desired world-space move direction, normalized or zero */
  dirX: number
  dirZ: number
  jump: boolean
  dive: boolean
  sprint: boolean
}

export const ZERO_INPUT: PlayerInputFrame = { dirX: 0, dirZ: 0, jump: false, dive: false, sprint: false }

export interface Wind {
  x: number
  z: number
  timeLeft: number
  cooldown: number
}

export interface HeaderEvent {
  seat: number
  x: number
  y: number
  z: number
}

export interface ShoveEvent {
  fromSeat: number
  toSeat: number
  major: boolean
}

export interface KnockEvent {
  seat: number
  speed: number
}

export interface SimEvents {
  headers: HeaderEvent[]
  shoves: ShoveEvent[]
  knocks: KnockEvent[]
  bounces: number // wall/floor impacts this step (for SFX later)
}

export function makeEvents(): SimEvents {
  return { headers: [], shoves: [], knocks: [], bounces: 0 }
}

export function clearEvents(events: SimEvents): void {
  events.headers.length = 0
  events.shoves.length = 0
  events.knocks.length = 0
  events.bounces = 0
}

export function makeBall(): BallSim {
  return { x: 0, y: BALL_RADIUS + 2, z: 0, vx: 0, vy: 0, vz: 0 }
}

export function makePlayer(seat: number, x: number, z: number, yaw: number): PlayerSim {
  return {
    seat,
    x,
    y: 0,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    grounded: true,
    diving: false,
    sprinting: false,
    stamina: STAMINA_MAX,
    recoverCd: 0,
    headerCd: 0,
    knockedCd: 0,
  }
}

export function makeWind(): Wind {
  return { x: 0, z: 0, timeLeft: 0, cooldown: WIND_GUST_PERIOD_S }
}

export function resetBall(ball: BallSim): void {
  ball.x = 0
  ball.y = BALL_RADIUS + 2
  ball.z = 0
  ball.vx = 0
  ball.vy = 0
  ball.vz = 0
}

// --- walls (shared by ball & players) -----------------------------------------

/** Clamp a point to the arena interior; returns the hit normal or null. */
function collideWalls(
  arena: Arena,
  radius: number,
  p: { x: number; z: number },
): { x: number; z: number } | null {
  if (arena.circle) {
    const r = Math.hypot(p.x, p.z)
    const limit = arena.radius - radius
    if (r > limit && r > 0) {
      const nx = p.x / r
      const nz = p.z / r
      p.x = nx * limit
      p.z = nz * limit
      return { x: nx, z: nz }
    }
    return null
  }
  let hit: { x: number; z: number } | null = null
  const limit = arena.apothem - radius
  for (const n of arena.wallNormals) {
    const d = p.x * n.x + p.z * n.z
    if (d > limit) {
      p.x -= n.x * (d - limit)
      p.z -= n.z * (d - limit)
      hit = n
    }
  }
  return hit
}

function shortestAngle(from: number, to: number): number {
  const tau = Math.PI * 2
  let d = (to - from) % tau
  if (d > Math.PI) d -= tau
  if (d < -Math.PI) d += tau
  return d
}

// --- player -----------------------------------------------------------------------

export function stepPlayer(p: PlayerSim, input: PlayerInputFrame, arena: Arena, dt: number): void {
  const moving = input.dirX !== 0 || input.dirZ !== 0
  const knocked = p.knockedCd > 0
  const recovering = p.recoverCd > 0

  // beans face where they run (turned smoothly, never snapped)
  if (moving && !p.diving && !knocked) {
    const targetYaw = Math.atan2(input.dirX, input.dirZ)
    p.yaw += shortestAngle(p.yaw, targetYaw) * (1 - Math.exp(-TURN_RATE * dt))
  }

  // sprint costs stamina; running refills it
  p.sprinting = input.sprint && moving && p.stamina > 0 && !p.diving
  if (p.sprinting) {
    p.stamina = Math.max(0, p.stamina - SPRINT_DRAIN * dt)
  } else {
    p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt)
  }
  const targetSpeed = p.sprinting ? SPRINT_SPEED : RUN_SPEED

  // horizontal: framerate-independent blend toward target velocity.
  // Diving commits — near-zero air control. Recovery stumbles.
  let accel = p.grounded ? ACCEL_GROUND : ACCEL_AIR
  if (knocked) accel = ACCEL_AIR * 0.05 // you are luggage while knocked
  else if (p.diving) accel = ACCEL_AIR * 0.12
  else if (recovering) accel = ACCEL_GROUND * 0.25
  const k = 1 - Math.exp(-accel * dt)
  p.vx += (input.dirX * targetSpeed - p.vx) * k
  p.vz += (input.dirZ * targetSpeed - p.vz) * k

  if (input.jump && p.grounded && !recovering && !knocked) {
    p.vy = JUMP_SPEED
    p.grounded = false
  }

  // DIVE: full-commit forward lunge along facing — costs stamina
  if (input.dive && !p.grounded && !p.diving && !knocked && p.stamina >= DIVE_COST) {
    p.stamina -= DIVE_COST
    const fx = Math.sin(p.yaw)
    const fz = Math.cos(p.yaw)
    p.vx = fx * DIVE_FORCE
    p.vz = fz * DIVE_FORCE
    p.vy = Math.max(p.vy, DIVE_UP)
    p.diving = true
  }

  p.vy -= GRAVITY * dt

  p.x += p.vx * dt
  p.y += p.vy * dt
  p.z += p.vz * dt

  if (p.y <= 0) {
    p.y = 0
    p.vy = 0
    if (!p.grounded && p.diving) {
      p.diving = false
      p.recoverCd = DIVE_RECOVERY_S
    }
    p.grounded = true
  } else {
    p.grounded = false
  }

  const hit = collideWalls(arena, PLAYER_RADIUS, p)
  if (hit) {
    const vn = p.vx * hit.x + p.vz * hit.z
    if (vn > 0) {
      p.vx -= hit.x * vn
      p.vz -= hit.z * vn
    }
  }

  if (p.headerCd > 0) p.headerCd -= dt
  if (p.recoverCd > 0) p.recoverCd -= dt
  if (p.knockedCd > 0) p.knockedCd -= dt
}

// --- wind (the only escalating force, idea.md §4) -----------------------------------

export interface WindRng {
  next(): number
}

export function stepWind(wind: Wind, rng: WindRng, strength: number, ball: BallSim, dt: number): void {
  if (wind.timeLeft > 0) {
    wind.timeLeft -= dt
    ball.vx += wind.x * strength * dt
    ball.vz += wind.z * strength * dt
  } else {
    wind.cooldown -= dt
    if (wind.cooldown <= 0) {
      const angle = rng.next() * Math.PI * 2
      wind.x = Math.cos(angle)
      wind.z = Math.sin(angle)
      wind.timeLeft = WIND_GUST_DURATION_S * (0.7 + rng.next() * 0.6)
      wind.cooldown = WIND_GUST_PERIOD_S * (0.6 + rng.next() * 0.8)
    }
  }
}

// --- ball --------------------------------------------------------------------------

export function stepBall(ball: BallSim, arena: Arena, dt: number, events: SimEvents): void {
  ball.vy -= BALL_GRAVITY * dt

  ball.x += ball.vx * dt
  ball.y += ball.vy * dt
  ball.z += ball.vz * dt

  // floor
  if (ball.y < BALL_RADIUS) {
    ball.y = BALL_RADIUS
    if (ball.vy < 0) {
      if (ball.vy < -1.5) events.bounces++
      ball.vy = -ball.vy * BALL_RESTITUTION
      if (Math.abs(ball.vy) < 0.9) ball.vy = 0
    }
  }
  // rolling drag
  if (ball.y <= BALL_RADIUS + 0.02) {
    const drag = Math.max(0, 1 - BALL_DRAG * dt)
    ball.vx *= drag
    ball.vz *= drag
  }

  const hit = collideWalls(arena, BALL_RADIUS, ball)
  if (hit) {
    const vn = ball.vx * hit.x + ball.vz * hit.z
    if (vn > 0) {
      ball.vx -= hit.x * vn * (1 + BALL_RESTITUTION)
      ball.vz -= hit.z * vn * (1 + BALL_RESTITUTION)
      if (vn > 1.5) events.bounces++
    }
  }

  // speed cap keeps play readable
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz)
  if (speed > BALL_MAX_SPEED) {
    const s = BALL_MAX_SPEED / speed
    ball.vx *= s
    ball.vy *= s
    ball.vz *= s
  }
}

// --- ball <-> players -----------------------------------------------------------------

/**
 * The ball is the boss (playtest feedback):
 * - DIVING contact = HEADER: the ball rockets along the diver's facing.
 * - FAST ball hits you = YOU get knocked flying (stunned, flailing); the
 *   ball deflects off your body keeping most of its energy.
 * - Slow ball = a heavy object: walking into it barely nudges it and
 *   noticeably slows YOU.
 */
export function interactBallPlayers(
  ball: BallSim,
  players: readonly PlayerSim[],
  alive: readonly boolean[],
  dt: number,
  events: SimEvents,
): void {
  for (const p of players) {
    if (!alive[p.seat]) continue
    const bodyY = p.y + 0.75
    const dx = ball.x - p.x
    const dy = ball.y - bodyY
    const dz = ball.z - p.z
    const dist = Math.hypot(dx, dy, dz)
    const contact = BALL_RADIUS + PLAYER_RADIUS + 0.1

    if (p.diving && p.headerCd <= 0 && dist < contact + HEADER_MARGIN) {
      const fx = Math.sin(p.yaw)
      const fz = Math.cos(p.yaw)
      ball.vx = fx * HEADER_POWER
      ball.vz = fz * HEADER_POWER
      ball.vy = HEADER_POWER * HEADER_UP_BIAS + Math.max(0, ball.vy * 0.2)
      p.headerCd = HEADER_COOLDOWN_S
      // the ball wins the exchange — the diver stops dead and drops
      p.vx *= 0.25
      p.vz *= 0.25
      events.headers.push({ seat: p.seat, x: ball.x, y: ball.y, z: ball.z })
      continue
    }

    if (dist >= contact || dist < 1e-4) continue

    // contact normal, player -> ball, horizontal
    const nh = Math.hypot(dx, dz)
    if (nh < 1e-4) continue
    const cnx = dx / nh
    const cnz = dz / nh

    const ballSpeed = Math.hypot(ball.vx, ball.vz) + Math.max(0, -ball.vy) * 0.3

    if (ballSpeed > BALL_KNOCK_MIN_SPEED && p.knockedCd <= 0) {
      // BALL WINS: launch the player along the ball's travel direction
      const vh = Math.hypot(ball.vx, ball.vz)
      const kx = vh > 1e-4 ? ball.vx / vh : -cnx
      const kz = vh > 1e-4 ? ball.vz / vh : -cnz
      const power = BALL_KNOCK_FORCE * Math.min(1.6, ballSpeed / BALL_KNOCK_MIN_SPEED)
      p.vx = kx * power
      p.vz = kz * power
      p.vy = Math.max(p.vy, BALL_KNOCK_POP)
      p.grounded = false
      p.diving = false
      p.knockedCd = KNOCK_STUN_S
      events.knocks.push({ seat: p.seat, speed: ballSpeed })

      // ball deflects off the body, keeping most of its energy
      const into = ball.vx * -cnx + ball.vz * -cnz
      if (into > 0) {
        ball.vx += cnx * into * (1 + BALL_DEFLECT_RESTITUTION)
        ball.vz += cnz * into * (1 + BALL_DEFLECT_RESTITUTION)
      }
      ball.vx *= 0.85
      ball.vz *= 0.85
      ball.x = p.x + cnx * contact
      ball.z = p.z + cnz * contact
      continue
    }

    // SLOW BALL: heavy — SOFT separation. Never teleport the ball out of
    // overlap (position snapping is exactly the dragging jitter): ease it
    // apart over a few steps and let it yield at the pusher's speed.
    const overlap = contact - dist
    const push = Math.min(overlap, 6 * dt)
    ball.x += cnx * push
    ball.z += cnz * push
    // the player also gives a little, so deep overlaps can't happen
    p.x -= cnx * Math.min(overlap * 0.3, 3 * dt)
    p.z -= cnz * Math.min(overlap * 0.3, 3 * dt)

    const pInto = p.vx * cnx + p.vz * cnz
    const outward = ball.vx * cnx + ball.vz * cnz
    if (pInto > 0 && outward < pInto) {
      // ball rolls away just ahead of you — smooth dragging, no pulsing
      const boost = (pInto - outward) * 0.8
      ball.vx += cnx * boost
      ball.vz += cnz * boost
      // pushing two tons of ball slows you down
      p.vx -= cnx * pInto * 0.35
      p.vz -= cnz * pInto * 0.35
    }
    ball.vx += cnx * BODY_NUDGE_FORCE * dt
    ball.vz += cnz * BODY_NUDGE_FORCE * dt
  }
}

// --- player <-> player -------------------------------------------------------------------

/**
 * Beans collide (idea.md §1): running into someone is a slight push,
 * DIVING into someone is a major shove. Contact never eliminates.
 */
export function collidePlayers(
  players: readonly PlayerSim[],
  alive: readonly boolean[],
  events: SimEvents,
): void {
  const minDist = PLAYER_RADIUS * 2
  for (let i = 0; i < players.length; i++) {
    const a = players[i]!
    if (!alive[a.seat]) continue
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]!
      if (!alive[b.seat]) continue
      if (Math.abs(a.y - b.y) > 1.2) continue // clean vertical passes don't collide
      const dx = b.x - a.x
      const dz = b.z - a.z
      const dist = Math.hypot(dx, dz)
      if (dist >= minDist || dist < 1e-4) continue

      const px = dx / dist
      const pz = dz / dist
      const overlap = minDist - dist
      a.x -= px * overlap * 0.5
      a.z -= pz * overlap * 0.5
      b.x += px * overlap * 0.5
      b.z += pz * overlap * 0.5

      if (a.diving !== b.diving) {
        // major shove: the diver launches the other bean
        const diver = a.diving ? a : b
        const target = a.diving ? b : a
        const dir = a.diving ? 1 : -1
        target.vx += px * DIVE_PUSH * dir
        target.vz += pz * DIVE_PUSH * dir
        target.vy = Math.max(target.vy, 2.2)
        diver.vx *= 0.4
        diver.vz *= 0.4
        events.shoves.push({ fromSeat: diver.seat, toSeat: target.seat, major: true })
      } else {
        // mutual slight push
        a.vx -= px * PLAYER_PUSH * 0.5
        a.vz -= pz * PLAYER_PUSH * 0.5
        b.vx += px * PLAYER_PUSH * 0.5
        b.vz += pz * PLAYER_PUSH * 0.5
        events.shoves.push({ fromSeat: a.seat, toSeat: b.seat, major: false })
      }
    }
  }
}
