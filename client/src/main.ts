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
import { createParticles } from './render/particles.ts'
import { createUiBeanStage } from './render/uiBean.ts'
import { createMainMenu, type MainMenu } from './game/mainMenu.ts'
import { createGameAudio } from './game/audio.ts'
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

// spectate control hint (shown only while eliminated/spectating)
const specHint = document.createElement('div')
specHint.style.cssText =
  'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#1c1a18cc;' +
  'color:#fbf6e8;font:600 13px system-ui;padding:8px 16px;border-radius:10px;z-index:20;' +
  'display:none;pointer-events:none;letter-spacing:0.3px;'
document.body.appendChild(specHint)

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
// M6 VFX: pooled particle bursts (headers, knocks, elims, launches)
const particles = createParticles()
scene.add(particles.group)
// M6 AUDIO: real recorded SFX + a lo-fi music bed, over the vendored WebAudio
// backend. Loads whatever files exist in client/public/audio/ (missing = silent),
// unlocks on the first user gesture, mutes when the tab is hidden.
const audio = createGameAudio()
// Load audio in the background right away — request the loops NOW so they're
// armed; they actually begin the instant BOTH (a) their clip has decoded and
// (b) the first user gesture has unlocked the AudioContext, whichever is last.
// (The earlier window.load deferral raced: load often fired before this module
// finished its top-level await, so the listener missed it and audio never ran.)
audio.startMusic()
audio.startCrowd()
void audio.load()
// M key toggles mute (any time)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) audio.toggleMute()
})
// a soft UI click on any button press (menu, lobby, settings)
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement)?.closest('button')) audio.play('click', { volume: 0.5, vary: 0.06 })
})
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
// lively UI characters (menu jersey picker + lobby roster) + the main menu
const uiBeans = createUiBeanStage()
let mainMenu: MainMenu | null = null
// menuActive = the player is at the menu (not in their own live match). The
// backdrop is a bot match (instantArena); starting a real match hides the menu.
let menuActive = 'match' in game
let menuClock = 0 // drives the menu's looping day↔night cycle
const devSkipMenu = new URLSearchParams(location.search).has('dev')
if ('match' in game) {
  matchUi = createMatchUi(game.match)
  leaderboard = createLeaderboard(game.match)
  const match = game.match

  if (!devSkipMenu) {
    mainMenu = createMainMenu(match, uiBeans, {
      startSolo(botCount: number, mode: number, matchTime: number): void {
        // clean slate → apply settings → fill bots → start; menu hides on play
        game.debug.send('resetLobby')
        ;('setMenuMode' in game) && game.setMenuMode(false)
        setTimeout(() => {
          match.setSettings(mode, matchTime) // solo host owns the settings
          for (let i = 0; i < botCount; i++) match.addBot()
          setTimeout(() => match.start(), 160)
        }, 120)
        menuActive = false
        mainMenu?.setShown(false)
      },
      startOnline(): void {
        ;('setMenuMode' in game) && game.setMenuMode(false)
        match.start()
        menuActive = false
        mainMenu?.setShown(false)
      },
    })
    // hide the in-match overlays (HUD/leaderboard/matchUi) while the menu is up
    const menuCss = document.createElement('style')
    menuCss.textContent = '.menu-mode .game-overlay{display:none!important;}'
    document.head.appendChild(menuCss)
    // the match behind the menu is a pure backdrop — no tags, no labels
    if ('setMenuMode' in game) game.setMenuMode(true)
    // kick off the ENDLESS menu-demo match behind the menu: 6 beans play forever,
    // nobody is eliminated, it never ends (a real match starts on Play).
    game.debug.send('menuDemo')
  }

  // M6 juice: spawn particle bursts off match events (positions come from the
  // server for headers/knocks, resolved bean positions for elims)
  const seatHex = (seat: number): number => parseInt(game.match.seatColorHex(seat).slice(1), 16)
  game.match.onEvent((ev) => {
    if (ev.type === 'header' && ev.x !== undefined) {
      particles.header(ev.x, ev.y ?? 1, ev.z ?? 0, ev.force ?? 0.7)
      // KICK — force scales loudness; pitched DOWN a touch (heavy ball) + varied
      audio.play('kick', { volume: 0.4 + (ev.force ?? 0.7) * 0.6, rate: 0.9, vary: 0.12 })
    } else if (ev.type === 'knock' && ev.x !== undefined) {
      particles.knock(ev.x, ev.y ?? 0.15, ev.z ?? 0, ev.force ?? 0.5)
      audio.play('land', { volume: 0.3 + (ev.force ?? 0.5) * 0.4, rate: 0.95, vary: 0.1 })
    } else if (ev.type === 'elim' && ev.x !== undefined) {
      particles.eliminate(ev.x, ev.y ?? 0, ev.z ?? 0, ev.seat !== undefined ? seatHex(ev.seat) : 0xffffff)
      audio.play('elim', { volume: 0.9 })
      audio.play('cheer', { volume: 0.5, vary: 0.08 })
    } else if (ev.type === 'goal' && ev.x !== undefined) {
      // GOLDEN BOOT goal: a celebratory confetti burst in the shooter's colour
      particles.eliminate(ev.x, ev.y ?? 1, ev.z ?? 0, ev.seat !== undefined ? seatHex(ev.seat) : 0xffffff)
      audio.play('goal', { volume: 0.95 })
      audio.play('cheer', { volume: 0.7 })
    } else if (ev.type === 'volley') {
      audio.play('cannon', { volume: 1, vary: 0.06 }) // kickoff boom
      audio.play('whistle', { volume: 0.6 })
    } else if (ev.type === 'save' && ev.seat !== undefined) {
      audio.play('save', { volume: 0.6 })
    } else if (ev.type === 'overtime') {
      audio.play('whistle', { volume: 0.8, rate: 1.1 })
    } else if (ev.type === 'bounce') {
      // heavy ball: pitched down, loudness by impact speed, varied per hit
      audio.play('bounce', { volume: 0.25 + (ev.force ?? 0.3) * 0.5, rate: 0.85, vary: 0.14 })
    }
  })

  // the floodlights-on "bang" at nightfall (hook was reserved for this)
  if ('onNightfall' in game && game.onNightfall) game.onNightfall(() => audio.play('bang', { volume: 0.9 }))
}

renderer.domElement.addEventListener('click', () => {
  if (menuActive) return // menu is up — don't grab the mouse
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
    // spectate controls (only do anything while eliminated/spectating)
    if ('spectateToggleMode' in game && game.spectateToggleMode) {
      if (input.justPressed('specMode')) game.spectateToggleMode()
      if (input.justPressed('specNext')) game.spectateNext?.()
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
      // jump gates on `grounded` in the sim, so passing the HELD state is
      // identical to the edge for jumping — but it also lets the kickoff use
      // hold-Space as the launch CHARGE without a second input path.
      jump: jumpQueued || input.pressed('jump'),
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
  particles.update(time.unscaledDelta)

  // MAIN MENU: while up, override the camera with the cinematic low inside-pitch
  // orbit and suppress the in-match HUD/leaderboard — the bot match plays behind.
  if (menuActive && mainMenu) {
    chase.updateMenuOrbit(time.unscaledDelta)
    mainMenu.update(time.unscaledDelta)
    uiBeans.update(time.unscaledDelta)
    menuClock += time.unscaledDelta
    const frac = 0.5 - 0.5 * Math.cos((menuClock / 17) * Math.PI)
    if ('setMenuDayNight' in game) game.setMenuDayNight(frac)
  }
  document.body.classList.toggle('menu-mode', menuActive)

  if (!menuActive) {
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
  }
  debugPanel.update(time.unscaledDelta)

  // spectate control hint — never on the main menu (the backdrop match reads as
  // "spectating" but there's nothing to follow there)
  if (!menuActive && 'spectating' in game && game.spectating() && 'spectateInfo' in game) {
    const info = game.spectateInfo()
    specHint.style.display = 'block'
    specHint.innerHTML =
      info.mode === 'follow'
        ? `👁 Watching <b>${info.name}</b> &nbsp;·&nbsp; <b>Space</b> next player &nbsp;·&nbsp; <b>V</b> overview`
        : `👁 Overview &nbsp;·&nbsp; <b>V</b> or <b>Space</b> to follow a player`
  } else {
    specHint.style.display = 'none'
  }

  renderer.clear()
  renderer.render(scene, camera3)

  // MENU: render the lively UI beans into their card viewports (over the scene,
  // under the grain). Only while the menu is up. The PIP selfie cam is skipped.
  if (menuActive && mainMenu?.visible) {
    uiBeans.render(renderer)
    grain.render(renderer)
    return
  }

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

// PRE-WARM the shaders before the first animated frame. three.js compiles a
// material's program the first time it's rendered; with our custom shader
// materials (grass/crowd) + 4 spotlights + shadows that first compile is a big
// synchronous stall (seen as a ~340ms "GPU stall / ReadPixels" hitch on some
// drivers that froze the opening frames). compile() does it up front instead.
try {
  renderer.compile(scene, camera3)
} catch {
  /* compile is best-effort — never block startup on it */
}

requestAnimationFrame(frame)

// drop the boot LOADING… overlay once the game has actually drawn a real frame
// (two rAFs in, so the first scene render is on-screen — no blank gap). This
// also covers the reload-into-a-fresh-room path.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    document.getElementById('boot')?.remove()
  }),
)

console.log('[cannonball] WASD run, Shift sprint, Space jump, Click/Ctrl mid-air = DIVE, Q/E tilt')
