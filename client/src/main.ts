import * as THREE from 'three'
import { Time } from '@vendor/scheduler/time.ts'
import { isPointerLocked, requestPointerLock } from '@vendor/platform/fullscreen.ts'
import { ChaseCamera } from './game/camera.ts'
import { createDebugPanel } from './game/debug.ts'
import { createHud } from './game/hud.ts'
import { createMatchUi, type MatchUi } from './game/matchUi.ts'
import { createGameInput } from './game/input.ts'
import { createOnlineGame, type OnlineGame } from './game/online.ts'
import { createSandbox, type Sandbox } from './game/sandbox.ts'
import { connect, currentServerUrl, saveServerUrl } from './net/connection.ts'
import { createGrainOverlay } from './render/grain.ts'
import { PALETTE } from './render/palette.ts'
import { makeSky } from './render/sky.ts'

/**
 * M2: online by default (server-authoritative, predicted), `?offline` for
 * the M1 sandbox. `?lag=100` adds artificial send latency for honesty.
 */

// --- renderer ---------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.autoClear = false
document.body.appendChild(renderer.domElement)

const camera3 = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 600)

window.addEventListener('resize', () => {
  camera3.aspect = window.innerWidth / window.innerHeight
  camera3.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- scene ------------------------------------------------------------------------

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(PALETTE.horizonCream, 60, 240)
scene.add(new THREE.HemisphereLight(0xdcefe8, 0xcbbfa6, 0.95))
const sun = new THREE.DirectionalLight(0xfff3e0, 0.85)
sun.position.set(6, 10, 4)
scene.add(sun)
scene.add(makeSky())

// --- game boot -----------------------------------------------------------------------

const input = createGameInput()
const chase = new ChaseCamera(camera3)
const hud = createHud()
const grain = createGrainOverlay()
const time = new Time()

let game: Sandbox | OnlineGame
const wantOffline = new URLSearchParams(location.search).has('offline')
if (wantOffline) {
  game = createSandbox(scene, chase, hud)
  console.log('[cannonball] offline sandbox mode')
} else {
  try {
    const conn = await connect()
    game = createOnlineGame(scene, chase, hud, conn)
    console.log(`[cannonball] online — session ${conn.sessionId}`)
  } catch (error) {
    console.warn('[cannonball] server unreachable, falling back to offline sandbox', error)
    game = createSandbox(scene, chase, hud)
    // make the fallback IMPOSSIBLE to miss, and let a FRIEND fix the server
    // address right here (their tunnel URL) + retry, without editing any files
    const bar = document.createElement('div')
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;background:#d96c6c;color:#fff;font:600 13px system-ui;' +
      'text-align:center;padding:8px;z-index:100;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;'
    const label = document.createElement('span')
    label.textContent = `OFFLINE — can't reach ${currentServerUrl()}. Paste the host's server address:`
    const input = document.createElement('input')
    input.placeholder = 'wss://your-tunnel-url  (or  192.168.1.5:2567)'
    input.style.cssText = 'font:12px ui-monospace,monospace;padding:4px 8px;border-radius:6px;border:0;min-width:280px;'
    input.value = currentServerUrl()
    const go = document.createElement('button')
    go.textContent = 'connect'
    go.style.cssText = 'font:700 12px system-ui;background:#fff;color:#4a443c;border:0;border-radius:6px;padding:5px 12px;cursor:pointer;'
    const retry = (): void => {
      const url = saveServerUrl(input.value)
      if (url) location.href = `${location.pathname}?fresh`
    }
    go.addEventListener('click', retry)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') retry()
    })
    bar.append(label, input, go)
    document.body.appendChild(bar)
  }
}

const debugPanel = createDebugPanel(renderer, scene, game.debug)
let matchUi: MatchUi | null = null
if ('match' in game) matchUi = createMatchUi(game.match)

renderer.domElement.addEventListener('click', () => {
  if (!isPointerLocked(document)) void requestPointerLock(renderer.domElement)
})

let jumpQueued = false
let diveQueued = false
let abilityQueued = false
window.addEventListener('contextmenu', (e) => e.preventDefault()) // right-click = ability

function frame(nowMs: number): void {
  requestAnimationFrame(frame)
  time.advance(nowMs)

  input.pump()
  const locked = isPointerLocked(document)
  if (locked) chase.addMouse(input.pointerDeltaX, input.pointerDeltaY)
  if (input.justPressed('jump')) jumpQueued = true
  if (input.justPressed('dive')) diveQueued = true
  if (input.justPressed('ability')) abilityQueued = true
  if (input.justPressed('restart') && game.gameOver) game.reset()
  if ('match' in game) {
    for (let e = 0; e < 4; e++) {
      if (input.justPressed(`emote${e + 1}`)) game.match.emote(e)
    }
  }

  const steps = time.consumeFixedSteps()
  for (let i = 0; i < steps; i++) {
    time.beginFixedStep()

    // camera-relative move: forward = chase yaw, screen-right = (-fz, fx)
    const mx = input.axis('moveX')
    const mz = input.axis('moveZ')
    const fx = chase.forwardX
    const fz = chase.forwardZ
    let dirX = fx * mz + -fz * mx
    let dirZ = fz * mz + fx * mx
    const len = Math.hypot(dirX, dirZ)
    if (len > 1) {
      dirX /= len
      dirZ /= len
    }

    game.fixedStep({
      dirX,
      dirZ,
      jump: jumpQueued,
      dive: diveQueued,
      sprint: input.pressed('sprint'),
      ability: abilityQueued,
    })
    jumpQueued = false
    diveQueued = false
    abilityQueued = false
  }

  game.frameUpdate(time.unscaledDelta, time.alpha, input.axis('lean'))

  hud.update({
    tickRemaining: game.tickRemaining,
    zones: game.hudZones(),
    alarm: game.ballAlarm(),
    stamina: game.staminaFrac(),
    ability: game.abilityInfo(),
    locked,
  })

  matchUi?.update()
  debugPanel.update(time.unscaledDelta)

  renderer.clear()
  renderer.render(scene, camera3)
  grain.render(renderer)
}

requestAnimationFrame(frame)

console.log('[cannonball] WASD run, Shift sprint, Space jump, Click/Ctrl mid-air = DIVE, Q/E tilt')
