import * as THREE from 'three'
import { Time } from '@vendor/scheduler/time.ts'
import { isPointerLocked, requestPointerLock } from '@vendor/platform/fullscreen.ts'
import { ChaseCamera } from './game/camera.ts'
import { createDebugPanel } from './game/debug.ts'
import { createHud } from './game/hud.ts'
import { createMatchUi, type MatchUi } from './game/matchUi.ts'
import { createLeaderboard, type Leaderboard } from './game/leaderboard.ts'
import { createGameInput } from './game/input.ts'
import { createOnlineGame, type OnlineGame } from './game/online.ts'
import { createSandbox, type Sandbox } from './game/sandbox.ts'
import { connect, currentServerUrl, saveServerUrl } from './net/connection.ts'
import { createGrainOverlay } from './render/grain.ts'
import { PALETTE } from './render/palette.ts'
import { makeSky } from './render/sky.ts'
import { createClouds } from './render/clouds.ts'
import type { WorldLighting } from './render/arenaView.ts'

/**
 * M2: online by default (server-authoritative, predicted), `?offline` for
 * the M1 sandbox. `?lag=100` adds artificial send latency for honesty.
 */

// --- renderer ---------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.autoClear = false
// ONE directional shadow map, soft PCF — beans/ball/props cast onto the pitch.
// Grass + ground receive it in-shader (cheap: one shadow-map read/fragment, no
// per-blade self-shadow). Fitted tight to the arena so 2048² stays crisp.
renderer.shadowMap.enabled = true
// NB r0.185: PCFShadowMap is the SOFT Vogel-disk path; PCFSoftShadowMap falls
// through to hard BASIC. So PCFShadowMap here = the soft shadows we want.
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.appendChild(renderer.domElement)

const camera3 = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 600)
// picture-in-picture "selfie" camera pointed at the local bean's face
const pipCam = new THREE.PerspectiveCamera(42, 1, 0.1, 200)

window.addEventListener('resize', () => {
  camera3.aspect = window.innerWidth / window.innerHeight
  camera3.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// CIRCULAR PIP window, top-right. GL renders a square viewport; a radial mask
// (transparent center → sky color past the circle) hides the square corners,
// and a ring frame draws the border. Top-right is ~always sky, so it blends.
const pipMask = document.createElement('div')
pipMask.style.cssText =
  'position:fixed;top:16px;right:16px;pointer-events:none;z-index:13;display:none;' +
  'background:radial-gradient(circle at center, transparent 0 70%, #7dcdc2 71%);'
document.body.appendChild(pipMask)
const pipFrame = document.createElement('div')
pipFrame.style.cssText =
  'position:fixed;top:16px;right:16px;border-radius:50%;border:3px solid #4a443c;' +
  'box-shadow:0 3px 10px #0005;pointer-events:none;z-index:14;display:none;'
const pipTab = document.createElement('div')
pipTab.textContent = 'YOU'
pipTab.style.cssText =
  'position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);background:#4a443c;' +
  'color:#fbf6e8;font:700 9px system-ui;padding:2px 10px;border-radius:8px;letter-spacing:1px;'
pipFrame.appendChild(pipTab)
document.body.appendChild(pipFrame)

// --- scene ------------------------------------------------------------------------

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(PALETTE.horizonCream, 60, 240)
const hemi = new THREE.HemisphereLight(0xdcefe8, 0xcbbfa6, 0.95)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xfff3e0, 1.35)
sun.position.set(60, 120, 40)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
// fit the shadow camera tight to the pitch (radius ~28) + a margin for beans
// launched onto the wall crown, so 2048² stays crisp on the play area
sun.shadow.camera.left = -40
sun.shadow.camera.right = 40
sun.shadow.camera.top = 40
sun.shadow.camera.bottom = -40
sun.shadow.camera.near = 40
sun.shadow.camera.far = 360
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.02
scene.add(sun)
scene.add(sun.target) // the arc aims the sun at the arena center each frame
const sky = makeSky()
scene.add(sky)
// real 3D bubbly toon clouds drifting in the sky (random each session, alive)
const clouds = createClouds()
scene.add(clouds.group)
// bundle the world lighting the day->night arc drives (owned here, passed
// into the game so its arenaView can ease it toward night as players drop)
const lighting: WorldLighting = { scene, sun, hemi, sky }

// --- game boot -----------------------------------------------------------------------

const input = createGameInput()
const chase = new ChaseCamera(camera3)
const hud = createHud()
const grain = createGrainOverlay()
const time = new Time()

let game: Sandbox | OnlineGame
const wantOffline = new URLSearchParams(location.search).has('offline')
if (wantOffline) {
  game = createSandbox(scene, chase, hud, lighting)
  console.log('[cannonball] offline sandbox mode')
} else {
  try {
    const conn = await connect()
    game = createOnlineGame(scene, chase, hud, conn, lighting)
    console.log(`[cannonball] online — session ${conn.sessionId}`)
  } catch (error) {
    console.warn('[cannonball] server unreachable, falling back to offline sandbox', error)
    game = createSandbox(scene, chase, hud, lighting)
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
let leaderboard: Leaderboard | null = null
if ('match' in game) {
  matchUi = createMatchUi(game.match)
  leaderboard = createLeaderboard(game.match)
}

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
  clouds.update(time.unscaledDelta)

  hud.update({
    // tick timer + zone meters moved to the leaderboard HUD; the plain HUD
    // now only carries stamina, the ability chip, the danger vignette + hint
    tickRemaining: game.tickRemaining,
    zones: game.hudZones(),
    alarm: game.ballAlarm(),
    stamina: game.staminaFrac(),
    ability: game.abilityInfo(),
    locked,
  })

  matchUi?.update()
  leaderboard?.update()
  debugPanel.update(time.unscaledDelta)

  renderer.clear()
  renderer.render(scene, camera3)

  // PICTURE-IN-PICTURE selfie cam: a second view framed on the local bean's
  // face, top-right, so you see your character's expressions + motion live.
  if ('selfView' in game && game.selfView) {
    const sv = game.selfView()
    if (sv.visible) {
      const fx = Math.sin(sv.yaw)
      const fz = Math.cos(sv.yaw)
      // stand in FRONT of the bean looking back at its face, slightly above
      pipCam.position.set(sv.x + fx * 3.2, sv.y + 1.7, sv.z + fz * 3.2)
      pipCam.lookAt(sv.x, sv.y + 1.05, sv.z)

      const W = window.innerWidth
      const H = window.innerHeight
      const d = Math.round(Math.min(140, W * 0.12)) // SMALL square (circle diameter)
      const px = W - d - 16
      const py = H - d - 16 // gl viewport origin is bottom-left → top-right
      renderer.setViewport(px, py, d, d)
      renderer.setScissor(px, py, d, d)
      renderer.setScissorTest(true)
      pipCam.aspect = 1
      pipCam.updateProjectionMatrix()
      renderer.render(scene, pipCam)
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, W, H)
      for (const el of [pipFrame, pipMask]) {
        el.style.display = 'block'
        el.style.width = `${d}px`
        el.style.height = `${d}px`
      }
    } else {
      pipFrame.style.display = 'none'
      pipMask.style.display = 'none'
    }
  }

  grain.render(renderer)
}

requestAnimationFrame(frame)

console.log('[cannonball] WASD run, Shift sprint, Space jump, Click/Ctrl mid-air = DIVE, Q/E tilt')
