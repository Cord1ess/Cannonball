import { describe, expect, it } from 'vitest'
import { BALL_RADIUS, CONTACT_SLOP, FIXED_DELTA, PLAYER_RADIUS } from '../constants.ts'
import { makeArena } from './arena.ts'
import {
  makeBall,
  makeEvents,
  makePlayer,
  stepBallWithPlayers,
  stepPlayer,
  ZERO_INPUT,
  type PlayerSim,
} from './physics.ts'

/**
 * Regression tests for the three playtest bugs: jittery resting contact,
 * underside glitching, and high-speed tunneling into the ball.
 */

const arena = makeArena(6)
const contactR = BALL_RADIUS + PLAYER_RADIUS

function capsuleDistance(ball: { x: number; y: number; z: number }, p: PlayerSim): number {
  const closestY = Math.min(p.y + 1.4 - PLAYER_RADIUS, Math.max(p.y + PLAYER_RADIUS, ball.y))
  return Math.hypot(ball.x - p.x, ball.y - closestY, ball.z - p.z)
}

describe('ball <-> player contacts', () => {
  it('a 30 m/s ball never tunnels into a standing bean', () => {
    const ball = makeBall()
    ball.x = -8
    ball.y = BALL_RADIUS
    ball.vx = 30
    const p = makePlayer(0, 0, 0, 0)
    const events = makeEvents()

    let maxPenetration = 0
    for (let i = 0; i < 90; i++) {
      stepPlayer(p, ZERO_INPUT, arena, FIXED_DELTA)
      stepBallWithPlayers(ball, [p], [true], arena, FIXED_DELTA, events)
      maxPenetration = Math.max(maxPenetration, contactR - capsuleDistance(ball, p))
    }
    // slop + one substep of travel is the acceptable ceiling
    expect(maxPenetration).toBeLessThan(0.35)
    // and the bean got knocked (gameplay layer fired)
    expect(events.knocks.length).toBeGreaterThan(0)
  })

  it('a bean under the ball is pushed out, never trapped inside', () => {
    const ball = makeBall()
    ball.x = 0
    ball.y = BALL_RADIUS + 0.8 // hovering, bean fully underneath
    ball.z = 0
    ball.vy = -2
    const p = makePlayer(0, 0.01, 0.01, 0) // almost perfectly underneath
    const events = makeEvents()

    for (let i = 0; i < 120; i++) {
      stepPlayer(p, ZERO_INPUT, arena, FIXED_DELTA)
      stepBallWithPlayers(ball, [p], [true], arena, FIXED_DELTA, events)
    }
    const finalDist = capsuleDistance(ball, p)
    expect(finalDist).toBeGreaterThan(contactR - CONTACT_SLOP - 0.05)
    expect(Number.isFinite(ball.x)).toBe(true)
    expect(Number.isFinite(p.x)).toBe(true)
  })

  it('resting ball near an idle bean stays perfectly still (no jitter)', () => {
    const ball = makeBall()
    ball.x = 5
    ball.y = BALL_RADIUS
    ball.vy = 0
    const p = makePlayer(0, 0, 0, 0)
    const events = makeEvents()

    // settle first
    for (let i = 0; i < 60; i++) stepBallWithPlayers(ball, [p], [true], arena, FIXED_DELTA, events)
    const restX = ball.x
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, ZERO_INPUT, arena, FIXED_DELTA)
      stepBallWithPlayers(ball, [p], [true], arena, FIXED_DELTA, events)
    }
    expect(Math.abs(ball.x - restX)).toBeLessThan(0.001)
    expect(Math.hypot(ball.vx, ball.vy, ball.vz)).toBeLessThan(0.001)
  })

  it('pushing a slow ball drags it smoothly ahead (no oscillation)', () => {
    const ball = makeBall()
    ball.x = 3
    ball.y = BALL_RADIUS
    const p = makePlayer(0, 0, 0, 0)
    const events = makeEvents()
    const input = { dirX: 1, dirZ: 0, jump: false, dive: false, sprint: false, ability: false }

    let lastBallX = ball.x
    let reversals = 0
    for (let i = 0; i < 240; i++) {
      stepPlayer(p, input, arena, FIXED_DELTA)
      stepBallWithPlayers(ball, [p], [true], arena, FIXED_DELTA, events)
      // only judge stutter in open field — bouncing off the far WALL is correct
      if (i > 60 && ball.x < 18 && lastBallX < 18 && ball.x < lastBallX - 1e-4) reversals++
      lastBallX = ball.x
    }
    expect(ball.x).toBeGreaterThan(4) // it moved forward
    expect(reversals).toBe(0) // and never stuttered backward
  })

  it('a bean on top of the ball is supported (can stand and jump off)', () => {
    const ball = makeBall()
    ball.x = 0
    ball.y = BALL_RADIUS
    ball.z = 0
    const p = makePlayer(0, 0.05, 0, 0)
    p.y = BALL_RADIUS * 2 + 0.1 // dropped onto the top of the ball
    p.grounded = false
    const events = makeEvents()

    let supported = false
    for (let i = 0; i < 90; i++) {
      stepPlayer(p, ZERO_INPUT, arena, FIXED_DELTA)
      stepBallWithPlayers(ball, [p], [true], arena, FIXED_DELTA, events)
      if (p.grounded && p.y > 0.5) supported = true
    }
    expect(supported).toBe(true)
  })
})
