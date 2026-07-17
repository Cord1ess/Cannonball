import * as THREE from 'three'
import {
  BALL_RADIUS,
  DUEL_METER_CAPACITY_S,
  FIXED_DELTA,
  INTERP_DELAY_MS,
  LAUNCH_AIM_ARC_DEG,
  PATCH_HZ,
  SPRINT_SPEED,
  STAMINA_MAX,
} from '@shared/constants.ts'
import { footprintZone, makeArena, type Arena } from '@shared/sim/arena.ts'
import type { NetHandoutRead, NetInput, NetPlayerRead, NetStateRead } from '@shared/sim/net.ts'
import {
  clearEvents,
  makeBall,
  makeEvents,
  makePlayer,
  stepBallWithPlayers,
  stepPlayer,
  type PlayerInputFrame,
  type PlayerSim,
} from '@shared/sim/physics.ts'
import { isPlayPhase, Phase, tickInterval } from '@shared/match/phases.ts'
import { ABILITIES, computeMods } from '@shared/cards/effects.ts'
import type { CardPool } from '@shared/cards/definitions.ts'
import { kitColors, type KitColors } from '@shared/cosmetics/jerseys.ts'
import {
  createIndexedDbSaveStore,
  createMemorySaveStore,
  type SaveStore,
} from '@vendor/platform/save-data.ts'
import { createArenaView, type ArenaView } from '../render/arenaView.ts'
import { createBallView, type BallView } from '../render/ballView.ts'
import { createBean, type Bean } from '../render/bean.ts'
import { PALETTE } from '../render/palette.ts'
import type { ChaseCamera } from './camera.ts'
import type { DebugHooks } from './debug.ts'
import type { Hud, HudZone } from './hud.ts'
import type { Connection } from '../net/connection.ts'
import { SEAT_COLORS } from './sandbox.ts'

/**
 * Phase-aware online client (M3).
 * - PLAY phases (arena/overtime/duel): local player predicted + reconciled,
 *   ball locally simulated + server-corrected, remotes interpolated.
 * - Every other phase: EVERYONE (including self) renders from server
 *   snapshots — the server owns drafts, launches, and pauses.
 * - The MatchClient surface feeds the DOM match UI.
 */

const SNAP_ERROR = 3
const SERVER_BALL_LOOKAHEAD_S = 0.7 / PATCH_HZ

const toHex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

interface Snap {
  t: number
  x: number
  y: number
  z: number
  yaw: number
  grounded: boolean
  diving: boolean
  knocked: boolean
  sprinting: boolean
}

interface RemoteEntity {
  bean: Bean
  snaps: Snap[]
  stub: PlayerSim
  seat: number
  kitKey: string
}

export interface MatchEvent {
  type: 'elim' | 'overtime' | 'volley' | 'emote' | 'save' | 'ability'
  seat?: number
  seats?: number[]
  id?: number
  abilityId?: string
}

export interface MatchPlayerInfo {
  sessionId: string
  seat: number
  alive: boolean
  connected: boolean
  bot: boolean
  cards: string[]
  kitId: string
  kitAway: boolean
  /** '#rrggbb' identity color = effective kit primary */
  color: string
}

export interface MatchClient {
  readonly roomId: string
  phase(): number
  phaseRemaining(): number
  mySeat(): number
  myAlive(): boolean
  isHost(): boolean
  seatsAtStart(): number
  players(): MatchPlayerInfo[]
  handout(): NetHandoutRead | null
  winnerSeat(): number
  halftime(): boolean
  overtimeSeats(): number[]
  draftOffers(): Record<CardPool, string[]> | null
  picks(): Partial<Record<CardPool, string>>
  aimAngle(): number
  start(): void
  addBot(): void
  fillBots(): void
  pick(pool: CardPool, index: number): void
  assign(advTo: number, curseTo: number): void
  rematch(): void
  emote(id: number): void
  setKit(id: string): void
  myKitId(): string
  myKitAway(): boolean
  /** identity color for a seat as '#rrggbb' (kit primary, SEAT_COLORS fallback) */
  seatColorHex(seat: number): string
  onEvent(cb: (event: MatchEvent) => void): void
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
  abilityInfo(): { id: string; cdFrac: number } | null
  spectating(): boolean
  readonly match: MatchClient
  readonly debug: DebugHooks
}

export function createOnlineGame(
  scene: THREE.Scene,
  camera: ChaseCamera,
  _hud: Hud,
  conn: Connection,
): OnlineGame {
  const state = conn.room.state as unknown as NetStateRead

  let arena: Arena = makeArena(6)
  // the colosseum is permanent — only its painted zone layer morphs
  const arenaView: ArenaView = createArenaView(arena.radius)
  scene.add(arenaView.group)
  let arenaKey = ''

  const ballView: BallView = createBallView()
  scene.add(ballView.group)

  // --- local player ------------------------------------------------------------
  let mySeat = -1
  let localSim: PlayerSim | null = null
  let myBean: Bean | null = null
  const selfSnaps: Snap[] = []
  const inputBuffer: NetInput[] = []
  let seq = 0
  let wasPredicting = false
  const renderOffset = { x: 0, y: 0, z: 0 }
  const prevLocal = { x: 0, y: 0, z: 0 }
  let myAim = 0
  let aimSendCd = 0

  // --- remotes / ball / time -------------------------------------------------------
  const remotes = new Map<string, RemoteEntity>()
  const ball = makeBall()
  const prevBall = { x: 0, y: 0, z: 0 }
  const serverBall = { x: 0, y: BALL_RADIUS, z: 0, vx: 0, vy: 0, vz: 0 }
  const ballCorr = { x: 0, y: 0, z: 0 }
  const events = makeEvents()
  let timeOffset: number | null = null
  let lastPatchAt = 0
  const serverMe = { x: 0, y: 0, z: 0, has: false }

  // --- match UI plumbing --------------------------------------------------------------
  let draftOffers: Record<CardPool, string[]> | null = null
  const myPicks: Partial<Record<CardPool, string>> = {}
  const eventListeners: Array<(event: MatchEvent) => void> = []
  const emitEvent = (event: MatchEvent): void => {
    for (const listener of eventListeners) listener(event)
  }

  // --- jerseys (M4b) ------------------------------------------------------------------
  // the server resolves kit + clash; we paint what the state says and keep a
  // seat -> identity-color map for everything that used to read SEAT_COLORS
  const seatColors: number[] = [...SEAT_COLORS]
  let myKitKey = ''

  function kitOf(p: NetPlayerRead): KitColors {
    return (
      kitColors(p.kitId, p.kitAway) ?? {
        primary: SEAT_COLORS[p.seat] ?? PALETTE.teamRed,
        secondary: PALETTE.offWhite,
        pattern: 'solid',
        shorts: PALETTE.offWhite,
      }
    )
  }
  const kitKeyOf = (p: NetPlayerRead): string => `${p.kitId}|${p.kitAway}`

  let saveStore: SaveStore
  try {
    saveStore = createIndexedDbSaveStore('cannonball')
  } catch {
    saveStore = createMemorySaveStore()
  }
  let kitChosenThisSession = false
  void saveStore
    .get('kitId')
    .then((stored) => {
      // re-apply the saved kit on join, unless the user already picked one
      if (!kitChosenThisSession && typeof stored === 'string' && kitColors(stored, false)) {
        conn.send('kit', { id: stored })
      }
    })
    .catch(() => {})

  const predicting = (): boolean => isPlayPhase(state.phase ?? 0) && aliveOf(mySeat) && localSim !== null

  function aliveOf(seat: number): boolean {
    let alive = false
    state.players.forEach((p) => {
      if (p.seat === seat) alive = p.alive
    })
    return alive
  }

  function ensureLocal(): void {
    if (localSim) return
    const me = state.players?.get?.(conn.sessionId)
    if (!me) return
    mySeat = me.seat
    localSim = makePlayer(me.seat, me.x, me.z, me.yaw)
    localSim.y = me.y
    myKitKey = kitKeyOf(me)
    myBean = createBean(kitOf(me))
    scene.add(myBean.group)
    camera.yaw = me.yaw
  }

  function rebuildArenaIfNeeded(): void {
    const zoneSeat = state.zoneSeat
    if (!zoneSeat || zoneSeat.length === 0) return
    const seats: number[] = []
    for (let i = 0; i < zoneSeat.length; i++) seats.push(zoneSeat[i] ?? 0)
    const colors = seats.map((seat) => seatColors[seat] ?? PALETTE.warmGray)
    const key = `${seats.join(',')}#${colors.join(',')}`
    if (key === arenaKey) return
    arenaKey = key
    arena = makeArena(Math.max(2, seats.length))
    arenaView.setZones(arena, colors)
  }

  function pushSnap(buffer: Snap[], p: NetPlayerRead): void {
    buffer.push({
      t: state.serverTime,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      grounded: p.grounded,
      diving: p.diving,
      knocked: p.knocked,
      sprinting: p.sprinting,
    })
    if (buffer.length > 40) buffer.splice(0, buffer.length - 40)
  }

  conn.room.onStateChange(() => {
    // identity colors first — the arena/bean paths below read them
    state.players.forEach((p: NetPlayerRead) => {
      seatColors[p.seat] = kitOf(p).primary
    })
    ensureLocal()
    // kit changed in the lobby? rebuild my bean in the new jersey
    const meKit = state.players.get(conn.sessionId)
    if (meKit && myBean && kitKeyOf(meKit) !== myKitKey) {
      myKitKey = kitKeyOf(meKit)
      scene.remove(myBean.group)
      myBean.dispose()
      myBean = createBean(kitOf(meKit))
      scene.add(myBean.group)
    }
    rebuildArenaIfNeeded()
    lastPatchAt = performance.now()

    const nowS = performance.now() / 1000
    const measured = state.serverTime - nowS
    timeOffset = timeOffset === null ? measured : timeOffset + (measured - timeOffset) * 0.1

    const me = state.players.get(conn.sessionId)
    if (me) {
      serverMe.x = me.x
      serverMe.y = me.y
      serverMe.z = me.z
      serverMe.has = true
      pushSnap(selfSnaps, me)
    }

    // reconcile only while predicting
    if (me && localSim && predicting()) {
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
      localSim.abilityCd = me.abilityCd
      if (me.knocked) localSim.knockedCd = Math.max(localSim.knockedCd, 0.1)

      let i = 0
      while (i < inputBuffer.length && inputBuffer[i]!.seq <= me.lastSeq) i++
      inputBuffer.splice(0, i)
      for (const pending of inputBuffer) stepPlayer(localSim, pending, arena, FIXED_DELTA)

      renderOffset.x += beforeX - localSim.x
      renderOffset.y += beforeY - localSim.y
      renderOffset.z += beforeZ - localSim.z
      if (Math.hypot(renderOffset.x, renderOffset.y, renderOffset.z) > SNAP_ERROR) {
        renderOffset.x = renderOffset.y = renderOffset.z = 0
      }
    }

    // remotes
    state.players.forEach((p: NetPlayerRead, id: string) => {
      if (id === conn.sessionId) return
      let remote = remotes.get(id)
      if (!remote) {
        const bean = createBean(kitOf(p))
        scene.add(bean.group)
        remote = {
          bean,
          snaps: [],
          stub: makePlayer(p.seat, p.x, p.z, p.yaw),
          seat: p.seat,
          kitKey: kitKeyOf(p),
        }
        remotes.set(id, remote)
      } else if (remote.kitKey !== kitKeyOf(p)) {
        remote.kitKey = kitKeyOf(p)
        scene.remove(remote.bean.group)
        remote.bean.dispose()
        remote.bean = createBean(kitOf(p))
        scene.add(remote.bean.group)
      }
      pushSnap(remote.snaps, p)
      remote.stub.diving = p.diving
    })
    for (const [id, remote] of remotes) {
      if (!state.players.get(id)) {
        scene.remove(remote.bean.group)
        remote.bean.dispose()
        remotes.delete(id)
      }
    }

    // ball truth
    serverBall.x = state.ball.x
    serverBall.y = state.ball.y
    serverBall.z = state.ball.z
    serverBall.vx = state.ball.vx
    serverBall.vy = state.ball.vy
    serverBall.vz = state.ball.vz
    if (!isPlayPhase(state.phase ?? 0)) {
      // pauses: the server parks the ball — just follow it exactly
      ball.x = serverBall.x
      ball.y = serverBall.y
      ball.z = serverBall.z
      ball.vx = serverBall.vx
      ball.vy = serverBall.vy
      ball.vz = serverBall.vz
      ballCorr.x = ballCorr.y = ballCorr.z = 0
      return
    }
    const srvSpeed = Math.hypot(serverBall.vx, serverBall.vy, serverBall.vz)
    const lookahead = srvSpeed > 0.5 ? SERVER_BALL_LOOKAHEAD_S : 0
    const sx = serverBall.x + serverBall.vx * lookahead
    const sy = Math.max(BALL_RADIUS, serverBall.y + serverBall.vy * lookahead)
    const sz = serverBall.z + serverBall.vz * lookahead
    const errX = sx - ball.x
    const errY = sy - ball.y
    const errZ = sz - ball.z
    const err = Math.hypot(errX, errY, errZ)
    if (err > SNAP_ERROR) {
      ball.x = serverBall.x
      ball.y = serverBall.y
      ball.z = serverBall.z
      ball.vx = serverBall.vx
      ball.vy = serverBall.vy
      ball.vz = serverBall.vz
      ballCorr.x = ballCorr.y = ballCorr.z = 0
    } else if (err > 0.06) {
      ballCorr.x = errX
      ballCorr.y = errY
      ballCorr.z = errZ
      ball.vx += (serverBall.vx - ball.vx) * 0.5
      ball.vy += (serverBall.vy - ball.vy) * 0.35
      ball.vz += (serverBall.vz - ball.vz) * 0.5
    } else {
      ballCorr.x = ballCorr.y = ballCorr.z = 0
    }
  })

  conn.room.onMessage('draftOffer', (offers: Record<CardPool, string[]>) => {
    draftOffers = offers
    for (const pool of Object.keys(myPicks) as CardPool[]) delete myPicks[pool]
  })
  conn.room.onMessage('header', ({ seat }: { seat: number }) => {
    if (seat === mySeat) return
    for (const remote of remotes.values()) if (remote.seat === seat) remote.bean.header()
  })
  conn.room.onMessage('knock', ({ seat }: { seat: number }) => {
    if (seat === mySeat) camera.kick(0.9)
  })
  conn.room.onMessage('elim', ({ seat }: { seat: number }) => emitEvent({ type: 'elim', seat }))
  conn.room.onMessage('overtime', ({ seats }: { seats: number[] }) => emitEvent({ type: 'overtime', seats }))
  conn.room.onMessage('volley', () => emitEvent({ type: 'volley' }))
  conn.room.onMessage('emote', ({ seat, id }: { seat: number; id: number }) =>
    emitEvent({ type: 'emote', seat, id }),
  )
  conn.room.onMessage('ability', ({ seat, id }: { seat: number; id: string }) =>
    emitEvent({ type: 'ability', seat, abilityId: id }),
  )
  conn.room.onMessage('save', ({ seat }: { seat: number }) => emitEvent({ type: 'save', seat }))
  conn.room.onMessage('round', () => {})

  function blendBallToServer(dt: number): void {
    const remaining = Math.hypot(ballCorr.x, ballCorr.y, ballCorr.z)
    if (remaining < 1e-4) return
    const k = Math.min(1, dt / 0.1)
    ball.x += ballCorr.x * k
    ball.y += ballCorr.y * k
    ball.z += ballCorr.z * k
    ballCorr.x *= 1 - k
    ballCorr.y *= 1 - k
    ballCorr.z *= 1 - k
  }

  const match: MatchClient = {
    roomId: conn.room.roomId,
    phase: () => state.phase ?? 0,
    phaseRemaining: () => state.phaseRemaining ?? 0,
    mySeat: () => mySeat,
    myAlive: () => aliveOf(mySeat),
    isHost: () => state.hostSessionId === conn.sessionId,
    seatsAtStart: () => state.seatsAtStart ?? 0,
    players(): MatchPlayerInfo[] {
      const list: MatchPlayerInfo[] = []
      state.players.forEach((p, sessionId) => {
        list.push({
          sessionId,
          seat: p.seat,
          alive: p.alive,
          connected: p.connected,
          bot: p.bot,
          cards: [p.cardAbility, p.cardEquipment, p.cardAdvantage].filter(Boolean),
          kitId: p.kitId,
          kitAway: p.kitAway,
          color: toHex(kitOf(p).primary),
        })
      })
      return list.sort((a, b) => a.seat - b.seat)
    },
    handout: () => state.handout ?? null,
    winnerSeat: () => state.winnerSeat ?? -1,
    halftime: () => state.halftime ?? false,
    overtimeSeats(): number[] {
      const seats: number[] = []
      const raw = state.overtimeSeats
      for (let i = 0; i < (raw?.length ?? 0); i++) seats.push(raw[i] ?? 0)
      return seats
    },
    draftOffers: () => draftOffers,
    picks: () => myPicks,
    aimAngle: () => myAim,
    start: () => conn.send('start'),
    addBot: () => conn.send('addBot'),
    fillBots: () => conn.send('fillBots'),
    pick(pool: CardPool, index: number): void {
      const id = draftOffers?.[pool]?.[index]
      if (id) myPicks[pool] = id
      conn.send('pick', { pool, index })
    },
    assign: (advTo: number, curseTo: number) => conn.send('assign', { advTo, curseTo }),
    rematch: () => conn.send('rematch'),
    emote: (id: number) => conn.send('emote', { id }),
    setKit(id: string): void {
      kitChosenThisSession = true
      conn.send('kit', { id })
      void saveStore.set('kitId', id).catch(() => {})
    },
    myKitId: () => state.players.get(conn.sessionId)?.kitId ?? '',
    myKitAway: () => state.players.get(conn.sessionId)?.kitAway ?? false,
    seatColorHex: (seat: number) => toHex(seatColors[seat] ?? SEAT_COLORS[seat] ?? 0x888888),
    onEvent: (cb) => eventListeners.push(cb),
  }

  return {
    match,
    get gameOver() {
      return false
    },
    get tickRemaining() {
      const phase = state.phase ?? 0
      if (phase === Phase.Duel || phase === Phase.Overtime) return Number.NaN
      return state.tickRemaining ?? 0
    },
    reset(): void {},
    abilityInfo(): { id: string; cdFrac: number } | null {
      const me = state.players.get(conn.sessionId)
      if (!me || !me.cardAbility) return null
      const spec = ABILITIES[me.cardAbility]
      if (!spec) return null
      const cd = localSim ? Math.max(localSim.abilityCd, 0) : me.abilityCd
      return { id: me.cardAbility, cdFrac: Math.min(1, cd / spec.cooldown) }
    },

    spectating(): boolean {
      return (state.phase ?? 0) !== Phase.Lobby && mySeat >= 0 && !aliveOf(mySeat)
    },

    fixedStep(input: PlayerInputFrame): void {
      ensureLocal()
      if (!localSim) return
      const dt = FIXED_DELTA
      const phase = state.phase ?? 0

      // launch: A/D steers the cannon aim
      if (phase === Phase.Launch) {
        const arc = (LAUNCH_AIM_ARC_DEG * Math.PI) / 360
        myAim = Math.max(-arc, Math.min(arc, myAim + input.dirX * 1.4 * dt))
        aimSendCd -= dt
        if (aimSendCd <= 0) {
          aimSendCd = 0.1
          conn.send('aim', { angle: myAim })
        }
      } else if (phase === Phase.Restart) {
        myAim = 0
      }

      const isPredicting = predicting()
      if (isPredicting && !wasPredicting) {
        // entering play: adopt server truth, fresh input stream
        const me = state.players.get(conn.sessionId)
        if (me) {
          localSim.x = me.x
          localSim.y = me.y
          localSim.z = me.z
          localSim.vx = me.vx
          localSim.vy = me.vy
          localSim.vz = me.vz
          localSim.yaw = me.yaw
        }
        inputBuffer.length = 0
        renderOffset.x = renderOffset.y = renderOffset.z = 0
      }
      wasPredicting = isPredicting
      if (!isPredicting) return

      // M4: self-prediction uses the SAME modifier stack as the server
      const meNow = state.players.get(conn.sessionId)
      if (meNow) {
        localSim.ability = meNow.cardAbility
        let highest = -1
        let highestSeat = -1
        state.players.forEach((p) => {
          if (p.alive && (state.meters?.[p.seat] ?? 0) > highest) {
            highest = state.meters?.[p.seat] ?? 0
            highestSeat = p.seat
          }
        })
        const myCards = [
          meNow.cardAbility,
          meNow.cardEquipment,
          meNow.cardAdvantage,
          meNow.activeAdv,
          meNow.activeCurse,
        ].filter(Boolean)
        localSim.mods = computeMods(myCards, { meterIsHighest: highestSeat === mySeat && highest > 0 })
      }

      prevLocal.x = localSim.x
      prevLocal.y = localSim.y
      prevLocal.z = localSim.z
      prevBall.x = ball.x
      prevBall.y = ball.y
      prevBall.z = ball.z

      seq++
      const net: NetInput = { seq, ...input }
      stepPlayer(localSim, net, arena, dt)
      inputBuffer.push(net)
      if (inputBuffer.length > 120) inputBuffer.splice(0, inputBuffer.length - 120)
      conn.send('input', net)

      ball.vx += (state.windX ?? 0) * (state.windStrength ?? 0) * dt
      ball.vz += (state.windZ ?? 0) * (state.windStrength ?? 0) * dt
      const bodies: PlayerSim[] = [localSim]
      const bodiesAlive: boolean[] = new Array(8).fill(true)
      for (const remote of remotes.values()) bodies.push(remote.stub)
      stepBallWithPlayers(ball, bodies, bodiesAlive, arena, dt, events)
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
      arenaView.update(dt)
      const decay = Math.exp(-10 * dt)
      renderOffset.x *= decay
      renderOffset.y *= decay
      renderOffset.z *= decay

      const nowS = performance.now() / 1000
      const renderTime = timeOffset === null ? null : nowS + timeOffset - INTERP_DELAY_MS / 1000

      // self: predicted while playing, server-sampled otherwise
      let selfX = 0
      let selfY = 0
      let selfZ = 0
      if (localSim && myBean) {
        if (predicting()) {
          selfX = prevLocal.x + (localSim.x - prevLocal.x) * alpha + renderOffset.x
          selfY = Math.max(0, prevLocal.y + (localSim.y - prevLocal.y) * alpha + renderOffset.y)
          selfZ = prevLocal.z + (localSim.z - prevLocal.z) * alpha + renderOffset.z
          const run = Math.min(1, Math.hypot(localSim.vx, localSim.vz) / SPRINT_SPEED)
          const look = lookToward(localSim, ball.x, ball.y, ball.z)
          myBean.update(dt, {
            x: selfX,
            y: selfY,
            z: selfZ,
            yaw: localSim.yaw,
            run,
            grounded: localSim.grounded,
            diving: localSim.diving,
            knocked: localSim.knockedCd > 0,
            sprinting: localSim.sprinting,
            lean,
            lookX: look.x,
            lookY: look.y,
          })
        } else {
          const pose = sampleSnaps(selfSnaps, renderTime)
          if (pose) {
            selfX = pose.x
            selfY = pose.y
            selfZ = pose.z
            localSim.x = pose.x
            localSim.y = pose.y
            localSim.z = pose.z
            const look = lookToward(localSim, ball.x, ball.y, ball.z)
            myBean.update(dt, { ...pose, lean, lookX: look.x, lookY: look.y })
          }
        }
        myBean.group.visible = aliveOf(mySeat) || (state.phase ?? 0) === Phase.Lobby
      }

      // remotes
      for (const remote of remotes.values()) {
        const remoteAlive = aliveOf(remote.seat)
        remote.bean.group.visible = remoteAlive || (state.phase ?? 0) === Phase.Lobby
        if (!remoteAlive) continue
        const pose = sampleSnaps(remote.snaps, renderTime)
        if (!pose) continue
        remote.stub.x = pose.x
        remote.stub.y = pose.y
        remote.stub.z = pose.z
        remote.stub.yaw = pose.yaw
        const look = lookToward(remote.stub, ball.x, ball.y, ball.z)
        remote.bean.update(dt, { ...pose, lean: 0, lookX: look.x, lookY: look.y })
      }

      const bx = prevBall.x + (ball.x - prevBall.x) * alpha
      const by = prevBall.y + (ball.y - prevBall.y) * alpha
      const bz = prevBall.z + (ball.z - prevBall.z) * alpha
      const zone = footprintZone(arena, bx, bz)
      const zoneSeatArr = state.zoneSeat
      const zoneOwner = zone >= 0 && zoneSeatArr ? zoneSeatArr[zone] : undefined
      ballView.update(bx, by, bz, zoneOwner !== undefined ? (seatColors[zoneOwner] ?? null) : null)

      const fracs: number[] = []
      const capacity =
        (state.phase ?? 0) === Phase.Duel ? DUEL_METER_CAPACITY_S : tickInterval(state.survivors || 6) * 0.5
      for (let i = 0; i < (zoneSeatArr?.length ?? 0); i++) {
        const seat = zoneSeatArr[i] ?? 0
        fracs.push((state.meters?.[seat] ?? 0) / Math.max(1, capacity))
      }
      arenaView.setDanger(fracs)

      // camera: chase while playing/waiting, slow orbit while eliminated
      if (this.spectating()) {
        camera.updateOrbit(dt, arena.radius + 14, 14)
      } else {
        camera.update(dt, selfX, selfY, selfZ)
      }
    },

    hudZones(): HudZone[] {
      const zones: HudZone[] = []
      const zoneSeatArr = state.zoneSeat
      const capacity =
        (state.phase ?? 0) === Phase.Duel ? DUEL_METER_CAPACITY_S : tickInterval(state.survivors || 6) * 0.5
      for (let i = 0; i < (zoneSeatArr?.length ?? 0); i++) {
        const seat = zoneSeatArr[i] ?? 0
        zones.push({
          color: toHex(seatColors[seat] ?? 0),
          frac: (state.meters?.[seat] ?? 0) / Math.max(1, capacity),
          isPlayer: seat === mySeat,
        })
      }
      return zones
    },

    ballAlarm(): boolean {
      if (mySeat < 0 || !aliveOf(mySeat) || !isPlayPhase(state.phase ?? 0)) return false
      const zone = footprintZone(arena, ball.x, ball.z)
      const zoneSeatArr = state.zoneSeat
      return zone >= 0 && zoneSeatArr?.[zone] === mySeat
    },

    staminaFrac(): number {
      return (localSim?.stamina ?? STAMINA_MAX) / STAMINA_MAX
    },

    debug: {
      label: 'online',
      send(cmd: string): void {
        conn.send('debug', { cmd })
      },
      info(): Record<string, string | number> {
        const offMag = Math.hypot(renderOffset.x, renderOffset.y, renderOffset.z)
        const corrMag = Math.hypot(ballCorr.x, ballCorr.y, ballCorr.z)
        return {
          session: conn.sessionId,
          seat: mySeat,
          phase: state.phase ?? 0,
          players: state.players?.size ?? 0,
          seq,
          buffered: inputBuffer.length,
          renderOff: `${offMag.toFixed(3)}m`,
          ballCorr: `${corrMag.toFixed(3)}m`,
          patchAge: `${(performance.now() - lastPatchAt).toFixed(0)}ms`,
          offset: timeOffset === null ? 'n/a' : `${timeOffset.toFixed(3)}s`,
          ball: `${ball.x.toFixed(1)}, ${ball.z.toFixed(1)} y${ball.y.toFixed(1)}`,
        }
      },
      ghosts(draw): void {
        if (serverMe.has) draw.wireBox(serverMe.x, serverMe.y + 0.7, serverMe.z, 0.45, 0.7, 0.45, 1, 0, 1)
        draw.wireSphere(serverBall.x, serverBall.y, serverBall.z, BALL_RADIUS, 0, 1, 1)
        draw.line(ball.x, ball.y, ball.z, serverBall.x, serverBall.y, serverBall.z, 1, 1, 0)
      },
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
  knocked: boolean
  sprinting: boolean
}

function sampleSnaps(snaps: Snap[], renderTime: number | null): SampledPose | null {
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
    knocked: b.knocked,
    sprinting: b.sprinting,
  }
}
