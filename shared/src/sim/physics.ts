import {
  ACCEL_AIR,
  ACCEL_GROUND,
  BALL_DRAG,
  BALL_GRAVITY,
  BALL_KNOCK_POP,
  BALL_MASS,
  BALL_MAX_SPEED,
  BALL_MAX_SUBSTEPS,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_SUBSTEP_TRAVEL,
  BODY_FRICTION_MU,
  BODY_RESTITUTION,
  CONTACT_CORRECTION,
  CONTACT_SLOP,
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
  KNOCK_DELTA_V,
  KNOCK_STUN_S,
  PLAYER_HEIGHT,
  PLAYER_MASS,
  PLAYER_MAX_KNOCK_SPEED,
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
import { ABILITIES, DEFAULT_MODS, type PlayerMods } from '../cards/effects.ts'

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
  /** M4 modifier stack — neutral by default, set from cards each step */
  mods: PlayerMods
  /** drafted ability id ('' = none) */
  ability: string
  abilityCd: number
  /** remaining active time for duration abilities (shield, tractor) */
  abilityActiveT: number
  /** one-shot fired this step, consumed by the world step (shove/ballstop) */
  abilityFired: string
}

export interface PlayerInputFrame {
  /** desired world-space move direction, normalized or zero */
  dirX: number
  dirZ: number
  jump: boolean
  dive: boolean
  sprint: boolean
  ability: boolean
}

export const ZERO_INPUT: PlayerInputFrame = {
  dirX: 0,
  dirZ: 0,
  jump: false,
  dive: false,
  sprint: false,
  ability: false,
}

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

export interface AbilityEvent {
  seat: number
  id: string
}

export interface SimEvents {
  headers: HeaderEvent[]
  shoves: ShoveEvent[]
  knocks: KnockEvent[]
  abilities: AbilityEvent[]
  bounces: number // wall/floor impacts this step (for SFX later)
}

export function makeEvents(): SimEvents {
  return { headers: [], shoves: [], knocks: [], abilities: [], bounces: 0 }
}

export function clearEvents(events: SimEvents): void {
  events.headers.length = 0
  events.shoves.length = 0
  events.knocks.length = 0
  events.abilities.length = 0
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
    mods: { ...DEFAULT_MODS },
    ability: '',
    abilityCd: 0,
    abilityActiveT: 0,
    abilityFired: '',
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

/** Clamp a point inside the round colosseum wall; returns the hit normal or null. */
function collideWalls(
  arena: Arena,
  radius: number,
  p: { x: number; z: number },
): { x: number; z: number } | null {
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
  const targetSpeed = (p.sprinting ? SPRINT_SPEED : RUN_SPEED) * p.mods.speed

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
    p.vy = JUMP_SPEED * p.mods.jump
    p.grounded = false
  }

  // ABILITY (M4): movement abilities apply here (predictable); world
  // abilities set abilityFired for the world step to consume.
  if (input.ability && p.abilityCd <= 0 && p.ability !== '' && !knocked) {
    const spec = ABILITIES[p.ability]
    if (spec) {
      p.abilityCd = spec.cooldown * p.mods.cooldown
      p.abilityActiveT = spec.duration
      if (p.ability === 'dash') {
        const fx = Math.sin(p.yaw)
        const fz = Math.cos(p.yaw)
        p.vx = fx * 14
        p.vz = fz * 14
      } else if (p.ability === 'grapple') {
        const fx = Math.sin(p.yaw)
        const fz = Math.cos(p.yaw)
        p.vx = fx * 16
        p.vz = fz * 16
        p.vy = Math.max(p.vy, 5)
        p.grounded = false
      } else {
        p.abilityFired = p.ability
      }
    }
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

  p.vy -= GRAVITY * p.mods.gravity * dt

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
  if (p.abilityCd > 0) p.abilityCd -= dt
  if (p.abilityActiveT > 0) p.abilityActiveT -= dt
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

function integrateBall(ball: BallSim, arena: Arena, h: number, events: SimEvents): void {
  ball.vy -= BALL_GRAVITY * h

  ball.x += ball.vx * h
  ball.y += ball.vy * h
  ball.z += ball.vz * h

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
    const drag = Math.max(0, 1 - BALL_DRAG * h)
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
}

/**
 * Ball step + ball<->player contacts, SUBSTEPPED so a fast ball can never
 * pass through (or deeply into) a bean between checks — the one-important-
 * object version of continuous collision detection.
 *
 * Contact model (the industry-standard anti-jitter trio):
 * 1. TRUE sphere-vs-capsule normals — full 3D, so undersides/tops resolve.
 * 2. Impulse resolution with a separating-velocity early-out and 5:1
 *    ball:player mass ratio — no forces once already separating.
 * 3. Baumgarte positional correction with slop — only (depth - 2cm) x 80%
 *    per step, split by inverse mass, so resting contact never oscillates.
 *
 * Gameplay layer on top (Rocket League-style, deliberately non-physical):
 * the dive-header velocity override, and the knock stun when the physical
 * impulse throws a bean hard enough.
 */
export function stepBallWithPlayers(
  ball: BallSim,
  players: readonly PlayerSim[],
  alive: readonly boolean[],
  arena: Arena,
  dt: number,
  events: SimEvents,
): void {
  // world abilities: one-shots fired this step + tractor beam pull
  for (const p of players) {
    if (!alive[p.seat]) continue
    if (p.abilityFired === 'shove') {
      p.abilityFired = ''
      events.abilities.push({ seat: p.seat, id: 'shove' })
      const bdx = ball.x - p.x
      const bdz = ball.z - p.z
      const bdist = Math.hypot(bdx, bdz)
      if (bdist < 6 && bdist > 1e-4) {
        ball.vx += (bdx / bdist) * 11
        ball.vz += (bdz / bdist) * 11
        ball.vy += 2
      }
      for (const other of players) {
        if (other === p || !alive[other.seat]) continue
        const dx = other.x - p.x
        const dz = other.z - p.z
        const d = Math.hypot(dx, dz)
        if (d < 4.5 && d > 1e-4) {
          other.vx += (dx / d) * 8
          other.vz += (dz / d) * 8
          other.vy = Math.max(other.vy, 2.5)
          other.grounded = false
          events.shoves.push({ fromSeat: p.seat, toSeat: other.seat, major: true })
        }
      }
    } else if (p.abilityFired === 'ballstop') {
      p.abilityFired = ''
      events.abilities.push({ seat: p.seat, id: 'ballstop' })
      const d = Math.hypot(ball.x - p.x, ball.z - p.z)
      if (d < 5.5) {
        ball.vx = 0
        ball.vy = Math.min(ball.vy, 0)
        ball.vz = 0
      }
    } else if (p.abilityFired !== '') {
      events.abilities.push({ seat: p.seat, id: p.abilityFired })
      p.abilityFired = ''
    }
  }

  // worst-case closing speed decides the substep count
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz) + 12
  const substeps = Math.min(BALL_MAX_SUBSTEPS, Math.max(1, Math.ceil((speed * dt) / BALL_SUBSTEP_TRAVEL)))
  const h = dt / substeps

  for (let i = 0; i < substeps; i++) {
    // tractor beam: continuous pull while active
    for (const p of players) {
      if (!alive[p.seat] || p.ability !== 'tractor' || p.abilityActiveT <= 0) continue
      const dx = p.x - ball.x
      const dy = p.y + 1 - ball.y
      const dz = p.z - ball.z
      const d = Math.hypot(dx, dy, dz)
      if (d > 2.5 && d < 24) {
        ball.vx += (dx / d) * 14 * h
        ball.vy += (dy / d) * 6 * h
        ball.vz += (dz / d) * 14 * h
      }
    }
    integrateBall(ball, arena, h, events)
    resolveBallPlayerContacts(ball, players, alive, events)
  }

  // speed cap keeps play readable
  const finalSpeed = Math.hypot(ball.vx, ball.vy, ball.vz)
  if (finalSpeed > BALL_MAX_SPEED) {
    const s = BALL_MAX_SPEED / finalSpeed
    ball.vx *= s
    ball.vy *= s
    ball.vz *= s
  }
}

const INV_BALL_MASS = 1 / BALL_MASS
const INV_PLAYER_MASS = 1 / PLAYER_MASS
const INV_MASS_SUM = INV_BALL_MASS + INV_PLAYER_MASS

function resolveBallPlayerContacts(
  ball: BallSim,
  players: readonly PlayerSim[],
  alive: readonly boolean[],
  events: SimEvents,
): void {
  const contactR = BALL_RADIUS + PLAYER_RADIUS
  for (const p of players) {
    if (!alive[p.seat]) continue

    // closest point on the bean's capsule core segment to the ball center
    const coreBottom = p.y + PLAYER_RADIUS
    const coreTop = p.y + PLAYER_HEIGHT - PLAYER_RADIUS
    const closestY = Math.min(coreTop, Math.max(coreBottom, ball.y))
    const dx = ball.x - p.x
    const dy = ball.y - closestY
    const dz = ball.z - p.z
    const dist = Math.hypot(dx, dy, dz)

    // gameplay override: the dive-header
    if (p.diving && p.headerCd <= 0 && dist < contactR + HEADER_MARGIN) {
      const power = HEADER_POWER * p.mods.header
      const fx = Math.sin(p.yaw)
      const fz = Math.cos(p.yaw)
      ball.vx = fx * power
      ball.vz = fz * power
      ball.vy = power * HEADER_UP_BIAS + Math.max(0, ball.vy * 0.2)
      p.headerCd = HEADER_COOLDOWN_S
      p.vx *= 0.25
      p.vz *= 0.25
      events.headers.push({ seat: p.seat, x: ball.x, y: ball.y, z: ball.z })
      continue
    }

    if (dist >= contactR || dist < 1e-6) continue

    // full 3D contact normal, player -> ball
    const nx = dx / dist
    const ny = dy / dist
    const nz = dz / dist

    // 3) positional correction: slop + percentage, split by inverse mass
    const depth = contactR - dist
    const correction = Math.max(depth - CONTACT_SLOP, 0) * CONTACT_CORRECTION
    const ballShare = INV_BALL_MASS / INV_MASS_SUM
    const playerShare = INV_PLAYER_MASS / INV_MASS_SUM
    ball.x += nx * correction * ballShare
    ball.y += ny * correction * ballShare
    ball.z += nz * correction * ballShare
    p.x -= nx * correction * playerShare
    p.z -= nz * correction * playerShare
    p.y = Math.max(0, p.y - ny * correction * playerShare)
    if (ball.y < BALL_RADIUS) ball.y = BALL_RADIUS

    // 2) impulse with separating-velocity early-out
    const rvx = ball.vx - p.vx
    const rvy = ball.vy - p.vy
    const rvz = ball.vz - p.vz
    // shield bubble: the bean is briefly an immovable, extra-bouncy bumper
    const shielded = p.ability === 'shield' && p.abilityActiveT > 0
    const invPlayerMass = shielded ? 0.04 : INV_PLAYER_MASS
    const invMassSum = INV_BALL_MASS + invPlayerMass
    const restitution = shielded ? 1.1 : BODY_RESTITUTION

    const approaching = rvx * nx + rvy * ny + rvz * nz
    if (approaching < 0) {
      const j = (-(1 + restitution) * approaching) / invMassSum
      // bumper shell: this body imparts extra impulse to the ball (RL-style)
      ball.vx += nx * j * INV_BALL_MASS * p.mods.nudge
      ball.vy += ny * j * INV_BALL_MASS * p.mods.nudge
      ball.vz += nz * j * INV_BALL_MASS * p.mods.nudge
      const playerDv = j * invPlayerMass * p.mods.knockTaken
      p.vx -= nx * playerDv
      p.vy -= ny * playerDv
      p.vz -= nz * playerDv

      // Coulomb friction: damp tangential slip, clamped to mu * normal impulse.
      // This is what makes dribbles grip and brush contacts feel meaty.
      const rvx2 = ball.vx - p.vx
      const rvy2 = ball.vy - p.vy
      const rvz2 = ball.vz - p.vz
      const rn2 = rvx2 * nx + rvy2 * ny + rvz2 * nz
      const tx = rvx2 - nx * rn2
      const ty = rvy2 - ny * rn2
      const tz = rvz2 - nz * rn2
      const tMag = Math.hypot(tx, ty, tz)
      if (tMag > 1e-4) {
        const jt = Math.min(tMag / invMassSum, BODY_FRICTION_MU * j)
        const ux = tx / tMag
        const uy = ty / tMag
        const uz = tz / tMag
        ball.vx -= ux * jt * INV_BALL_MASS
        ball.vy -= uy * jt * INV_BALL_MASS
        ball.vz -= uz * jt * INV_BALL_MASS
        p.vx += ux * jt * invPlayerMass
        p.vy += uy * jt * invPlayerMass
        p.vz += uz * jt * invPlayerMass
      }

      // clamp launches so they stay readable
      const pSpeed = Math.hypot(p.vx, p.vy, p.vz)
      if (pSpeed > PLAYER_MAX_KNOCK_SPEED) {
        const clamp = PLAYER_MAX_KNOCK_SPEED / pSpeed
        p.vx *= clamp
        p.vy *= clamp
        p.vz *= clamp
      }

      // gameplay layer: a hard hit is a KNOCK — stun + pop + flail
      if (playerDv > KNOCK_DELTA_V && p.knockedCd <= 0 && !p.diving && !shielded) {
        p.vy = Math.max(p.vy, BALL_KNOCK_POP)
        p.grounded = false
        p.knockedCd = KNOCK_STUN_S
        events.knocks.push({ seat: p.seat, speed: playerDv })
      }
    }

    // support: standing ON the ball counts as ground (dribble on top, jump off)
    if (ny < -0.55) {
      p.grounded = true
    }
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
