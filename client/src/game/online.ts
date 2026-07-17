import * as THREE from 'three'
import {
  BALL_RADIUS,
  FIXED_DELTA,
  INTERP_DELAY_MS,
  SPRINT_SPEED,
  STAMINA_MAX,
  TICK_SECONDS_PER_SURVIVOR,
} from '@shared/constants.ts'
import { footprintZone, makeArena } from '@shared/sim/arena.ts'
import type { NetInput, NetPlayerRead, NetStateRead } from '@shared/sim/net.ts'
import {
  clearEvents,
  interactBallPlayers,
  makeBall,
  makeEvents,
  makePlayer,
  stepBall,
  stepPlayer,
  type PlayerInputFrame,
  type PlayerSim,
} from '@shared/sim/physics.ts'
import { createArenaView, type ArenaView } from '../render/arenaView.ts'
import { createBallView, type BallView } from '../render/ballView.ts'
import { createBean, type Bean } from '../render/bean.ts'
import { PALETTE } from '../render/palette.ts'
import type { ChaseCamera } from './camera.ts'
import type { Hud, HudZone } from './hud.ts'
import type { Connection } from '../net/connection.ts'
import { SEAT_COLORS } from './sandbox.ts'

/**
 * M2 online client (architecture.md §2):
 * - LOCAL player: client-side prediction + rewind-replay reconciliation
 *   against `lastSeq`, residual error smoothed via a decaying render offset.
 * - REMOTE players: snapshot interpolation ~120ms behind server time.
 * - BALL: simulated locally every step (so your dives connect frame-0),
 *   blended toward server truth per patch — gentle/firm/snap by error size.
 * - Judgment (meters/ticks) is read straight from replicated state.
 */

const SEATS = 6
const SNAP_ERROR = 3 // beyond this, stop blending and teleport

interface RemoteSnap {
  t: number
  x: number
  y: number
  z: number
  yaw: number
  grounded: boolean
  diving: boolean
  sprinting: boolean
}

interface RemoteEntity {
  bean: Bean
  snaps: RemoteSnap[]
  stub: PlayerSim // approximate sim body so the local ball reacts to remotes
}

export interface OnlineGame {
  fixedStep(input: PlayerInputFrame): void
  frameUpdate(dt: number, alpha: number, lean: number): void
  reset(): void
  readonly gameOver: boolean
  hudZones(): HudZone[]
  readonly tickRemaining: number
  ballAlarm(): boolean
  staminaFrac(): number
}

export function createOnlineGame(
  scene: THREE.Scene,
  camera: ChaseCamera,
  hud: Hud,
  conn: Connection,
): OnlineGame {
  const arena = makeArena(SEATS)
  const state = conn.room.state as unknown as NetStateRead

  const arenaView: ArenaView = createArenaView(
    arena,
    Array.from({ length: SEATS }, (_, i) => SEAT_COLORS[i] ?? PALETTE.warmGray),
  )
  scene.add(arenaView.group)

  const ballView: BallView = createBallView()
  scene.add(ballView.group)

  // --- local player ------------------------------------------------------------
  let mySeat = -1
  let localSim: PlayerSim | null = null
  let myBean: Bean | null = null
  const inputBuffer: NetInput[] = []
  let seq = 0
  const renderOffset = { x: 0, y: 0, z: 0 }
  const prevLocal = { x: 0, y: 0, z: 0 }

  // --- remotes -------------------------------------------------------------------
  const remotes = new Map<string, RemoteEntity>()

  // --- ball (local prediction) ----------------------------------------------------
  const ball = makeBall()
  const prevBall = { x: 0, y: 0, z: 0 }
  const serverBall = { x: 0, y: BALL_RADIUS, z: 0, vx: 0, vy: 0, vz: 0 }
  const events = makeEvents()

  // --- server time estimate ---------------------------------------------------------
  let timeOffset: number | null = null // serverTime - performance.now()/1000

  function ensureLocal(): void {
    if (localSim) return
    const me = state.players?.get?.(conn.sessionId)
    if (!me) return
    mySeat = me.seat
    localSim = makePlayer(me.seat, me.x, me.z, me.yaw)
    localSim.y = me.y
    myBean = createBean(SEAT_COLORS[me.seat] ?? PALETTE.teamRed)
    scene.add(myBean.group)
    camera.yaw = me.yaw
  }

  conn.room.onStateChange(() => {
    ensureLocal()

    const nowS = performance.now() / 1000
    const measured = state.serverTime - nowS
    timeOffset = timeOffset === null ? measured : timeOffset + (measured - timeOffset) * 0.1

    // --- reconcile local player -------------------------------------------------
    const me = state.players.get(conn.sessionId)
    if (me && localSim) {
      const beforeX = localSim.x
      const beforeY = localSim.y
      const beforeZ = localSim.z

      localSim.x = me.x
      localSim.y = me.y
      localSim.z = me.z
      localSim.vx = me.vx
      localSim.vy = me.vy
      localSim.vz = me.vz
      localSim.yaw = me.yaw
      localSim.grounded = me.grounded
      localSim.diving = me.diving
      localSim.stamina = me.stamina

      // drop acked inputs, replay the rest through the SAME shared sim
      let i = 0
      while (i < inputBuffer.length && inputBuffer[i]!.seq <= me.lastSeq) i++
      inputBuffer.splice(0, i)
      for (const pending of inputBuffer) {
        stepPlayer(localSim, pending, arena, FIXED_DELTA)
      }

      // smooth the correction instead of snapping the render
      renderOffset.x += beforeX - localSim.x
      renderOffset.y += beforeY - localSim.y
      renderOffset.z += beforeZ - localSim.z
      const mag = Math.hypot(renderOffset.x, renderOffset.y, renderOffset.z)
      if (mag > SNAP_ERROR) {
        renderOffset.x = renderOffset.y = renderOffset.z = 0
      }
    }

    // --- sample remotes ---------------------------------------------------------------
    state.players.forEach((p: NetPlayerRead, id: string) => {
      if (id === conn.sessionId) return
      let remote = remotes.get(id)
      if (!remote) {
        const bean = createBean(SEAT_COLORS[p.seat] ?? PALETTE.teamBlue)
        scene.add(bean.group)
        remote = { bean, snaps: [], stub: makePlayer(p.seat, p.x, p.z, p.yaw) }
        remotes.set(id, remote)
      }
      remote.snaps.push({
        t: state.serverTime,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        grounded: p.grounded,
        diving: p.diving,
        sprinting: p.sprinting,
      })
      if (remote.snaps.length > 40) remote.snaps.splice(0, remote.snaps.length - 40)
      remote.stub.diving = p.diving
    })
    // remove departed
    for (const [id, remote] of remotes) {
      if (!state.players.get(id)) {
        scene.remove(remote.bean.group)
        remote.bean.dispose()
        remotes.delete(id)
      }
    }

    // --- ball: record server truth, blend or snap -----------------------------------------
    serverBall.x = state.ball.x
    serverBall.y = state.ball.y
    serverBall.z = state.ball.z
    serverBall.vx = state.ball.vx
    serverBall.vy = state.ball.vy
    serverBall.vz = state.ball.vz
    const err = Math.hypot(ball.x - serverBall.x, ball.y - serverBall.y, ball.z - serverBall.z)
    if (err > SNAP_ERROR) {
      ball.x = serverBall.x
      ball.y = serverBall.y
      ball.z = serverBall.z
      ball.vx = serverBall.vx
      ball.vy = serverBall.vy
      ball.vz = serverBall.vz
    }
  })

  conn.room.onMessage('header', ({ seat }: { seat: number }) => {
    if (seat === mySeat) return // local prediction already played it
    for (const remote of remotes.values()) {
      if (remote.stub.seat === seat) remote.bean.header()
    }
  })
  conn.room.onMessage('elim', () => {})
  conn.room.onMessage('round', () => {})

  /** per-step ball correction: rate scales with error size (architecture.md §2) */
  function blendBallToServer(dt: number): void {
    const ex = serverBall.x - ball.x
    const ey = serverBall.y - ball.y
    const ez = serverBall.z - ball.z
    const err = Math.hypot(ex, ey, ez)
    if (err < 0.01) return
    const rate = err > 1 ? 14 : 6 // firm when wrong, gentle when close
    const k = 1 - Math.exp(-rate * dt)
    ball.x += ex * k
    ball.y += ey * k
    ball.z += ez * k
    ball.vx += (serverBall.vx - ball.vx) * k
    ball.vz += (serverBall.vz - ball.vz) * k
    ball.vy += (serverBall.vy - ball.vy) * k * 0.5
  }

  const aliveOf = (seat: number): boolean => {
    let alive = true
    state.players.forEach((p) => {
      if (p.seat === seat) alive = p.alive
    })
    return alive
  }

  return {
    get gameOver() {
      return false // the server owns rounds in M2
    },
    get tickRemaining() {
      return state.tickRemaining ?? 0
    },
    reset(): void {
      /* server-side */
    },

    fixedStep(input: PlayerInputFrame): void {
      ensureLocal()
      if (!localSim) return
      const dt = FIXED_DELTA

      prevLocal.x = localSim.x
      prevLocal.y = localSim.y
      prevLocal.z = localSim.z
      prevBall.x = ball.x
      prevBall.y = ball.y
      prevBall.z = ball.z

      // 1. predict yourself + tell the server
      seq++
      const net: NetInput = { seq, ...input }
      stepPlayer(localSim, net, arena, dt)
      inputBuffer.push(net)
      if (inputBuffer.length > 120) inputBuffer.splice(0, inputBuffer.length - 120)
      conn.send('input', net)

      // 2. predict the ball: synced wind + local physics + player contacts
      ball.vx += (state.windX ?? 0) * (state.windStrength ?? 0) * dt
      ball.vz += (state.windZ ?? 0) * (state.windStrength ?? 0) * dt
      stepBall(ball, arena, dt, events)
      const bodies: PlayerSim[] = [localSim]
      const bodiesAlive: boolean[] = new Array(SEATS).fill(true)
      for (const remote of remotes.values()) bodies.push(remote.stub)
      interactBallPlayers(ball, bodies, bodiesAlive, dt, events)
      for (const header of events.headers) {
        if (header.seat === mySeat) {
          myBean?.header()
          camera.kick(0.7)
        }
      }
      clearEvents(events)
      blendBallToServer(dt)
    },

    frameUpdate(dt: number, alpha: number, lean: number): void {
      // decay the reconciliation render offset (~100ms feel)
      const decay = Math.exp(-10 * dt)
      renderOffset.x *= decay
      renderOffset.y *= decay
      renderOffset.z *= decay

      if (localSim && myBean) {
        const px = prevLocal.x + (localSim.x - prevLocal.x) * alpha + renderOffset.x
        const py = Math.max(0, prevLocal.y + (localSim.y - prevLocal.y) * alpha + renderOffset.y)
        const pz = prevLocal.z + (localSim.z - prevLocal.z) * alpha + renderOffset.z
        const run = Math.min(1, Math.hypot(localSim.vx, localSim.vz) / SPRINT_SPEED)
        const look = lookToward(localSim, ball.x, ball.y, ball.z)
        myBean.update(dt, {
          x: px,
          y: py,
          z: pz,
          yaw: localSim.yaw,
          run,
          grounded: localSim.grounded,
          diving: localSim.diving,
          sprinting: localSim.sprinting,
          lean,
          lookX: look.x,
          lookY: look.y,
        })
        camera.update(dt, px, py, pz)
      }

      // remotes at interpolated render time
      const nowS = performance.now() / 1000
      const renderTime = timeOffset === null ? null : nowS + timeOffset - INTERP_DELAY_MS / 1000
      for (const remote of remotes.values()) {
        const pose = sampleSnaps(remote.snaps, renderTime)
        if (!pose) continue
        remote.stub.x = pose.x
        remote.stub.y = pose.y
        remote.stub.z = pose.z
        remote.stub.yaw = pose.yaw
        const look = lookToward(remote.stub, ball.x, ball.y, ball.z)
        remote.bean.update(dt, {
          x: pose.x,
          y: pose.y,
          z: pose.z,
          yaw: pose.yaw,
          run: pose.run,
          grounded: pose.grounded,
          diving: pose.diving,
          sprinting: pose.sprinting,
          lean: 0,
          lookX: look.x,
          lookY: look.y,
        })
        remote.bean.group.visible = true
      }

      const bx = prevBall.x + (ball.x - prevBall.x) * alpha
      const by = prevBall.y + (ball.y - prevBall.y) * alpha
      const bz = prevBall.z + (ball.z - prevBall.z) * alpha
      const zone = footprintZone(arena, bx, bz)
      ballView.update(bx, by, bz, zone >= 0 ? (SEAT_COLORS[zone] ?? null) : null)

      const interval = TICK_SECONDS_PER_SURVIVOR * SEATS
      const fracs: number[] = []
      for (let seat = 0; seat < SEATS; seat++) fracs.push((state.meters?.[seat] ?? 0) / Math.max(1, interval * 0.5))
      arenaView.setDanger(fracs)
    },

    hudZones(): HudZone[] {
      const interval = TICK_SECONDS_PER_SURVIVOR * SEATS
      const zones: HudZone[] = []
      for (let seat = 0; seat < SEATS; seat++) {
        zones.push({
          color: `#${(SEAT_COLORS[seat] ?? 0).toString(16).padStart(6, '0')}`,
          frac: (state.meters?.[seat] ?? 0) / Math.max(1, interval * 0.5),
          isPlayer: seat === mySeat,
        })
      }
      return zones
    },

    ballAlarm(): boolean {
      if (mySeat < 0 || !aliveOf(mySeat)) return false
      return footprintZone(arena, ball.x, ball.z) === mySeat
    },

    staminaFrac(): number {
      return (localSim?.stamina ?? STAMINA_MAX) / STAMINA_MAX
    },
  }
}

function lookToward(p: PlayerSim, tx: number, ty: number, tz: number): { x: number; y: number } {
  const dx = tx - p.x
  const dz = tz - p.z
  const angleTo = Math.atan2(dx, dz)
  let diff = angleTo - p.yaw
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const dist = Math.max(1, Math.hypot(dx, dz))
  return {
    x: Math.max(-1, Math.min(1, Math.sin(diff) * 1.4)),
    y: Math.max(-1, Math.min(1, (ty - (p.y + 1)) / dist)),
  }
}

interface SampledPose {
  x: number
  y: number
  z: number
  yaw: number
  run: number
  grounded: boolean
  diving: boolean
  sprinting: boolean
}

/** interpolate between the two snapshots bracketing renderTime */
function sampleSnaps(snaps: RemoteSnap[], renderTime: number | null): SampledPose | null {
  if (snaps.length === 0) return null
  const last = snaps[snaps.length - 1]!
  if (renderTime === null || snaps.length === 1 || renderTime >= last.t) {
    return { ...last, run: 0 }
  }
  let after = 1
  while (after < snaps.length && snaps[after]!.t < renderTime) after++
  const b = snaps[Math.min(after, snaps.length - 1)]!
  const a = snaps[Math.max(0, Math.min(after, snaps.length - 1) - 1)]!
  const span = Math.max(1e-4, b.t - a.t)
  const f = Math.max(0, Math.min(1, (renderTime - a.t) / span))

  let dyaw = b.yaw - a.yaw
  while (dyaw > Math.PI) dyaw -= Math.PI * 2
  while (dyaw < -Math.PI) dyaw += Math.PI * 2

  const dx = b.x - a.x
  const dz = b.z - a.z
  const speed = Math.hypot(dx, dz) / span

  return {
    x: a.x + dx * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    yaw: a.yaw + dyaw * f,
    run: Math.min(1, speed / SPRINT_SPEED),
    grounded: b.grounded,
    diving: b.diving,
    sprinting: b.sprinting,
  }
}
