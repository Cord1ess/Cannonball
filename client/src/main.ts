import * as THREE from 'three'
import { Time } from '@vendor/scheduler/time.ts'
import { isPointerLocked, requestPointerLock } from '@vendor/platform/fullscreen.ts'
import { ChaseCamera } from './game/camera.ts'
import { createHud } from './game/hud.ts'
import { createGameInput } from './game/input.ts'
import { createSandbox } from './game/sandbox.ts'
import { createGrainOverlay } from './render/grain.ts'
import { PALETTE } from './render/palette.ts'
import { makeSky } from './render/sky.ts'

/**
 * M1: the offline arena sandbox — the header fun-test.
 * One player, five dummies, full local tick loop, morphing polygon arena.
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

// --- game -------------------------------------------------------------------------

const input = createGameInput()
const chase = new ChaseCamera(camera3)
const hud = createHud()
const sandbox = createSandbox(scene, chase, hud)
const grain = createGrainOverlay()
const time = new Time()

renderer.domElement.addEventListener('click', () => {
  if (!isPointerLocked(document)) void requestPointerLock(renderer.domElement)
})

let jumpQueued = false
let diveQueued = false

function frame(nowMs: number): void {
  requestAnimationFrame(frame)
  time.advance(nowMs)

  input.pump()
  const locked = isPointerLocked(document)
  if (locked) chase.addMouse(input.pointerDeltaX, input.pointerDeltaY)
  if (input.justPressed('jump')) jumpQueued = true
  if (input.justPressed('dive')) diveQueued = true
  if (input.justPressed('restart') && sandbox.gameOver) sandbox.reset()

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

    sandbox.fixedStep({ dirX, dirZ, jump: jumpQueued, dive: diveQueued, sprint: input.pressed('sprint') })
    jumpQueued = false
    diveQueued = false
  }

  sandbox.frameUpdate(time.unscaledDelta, time.alpha, input.axis('lean'))

  hud.update({
    tickRemaining: sandbox.tickRemaining,
    zones: sandbox.hudZones(),
    alarm: sandbox.ballAlarm(),
    stamina: sandbox.staminaFrac(),
    locked,
  })

  renderer.clear()
  renderer.render(scene, camera3)
  grain.render(renderer)
}

requestAnimationFrame(frame)

console.log('[cannonball] M1 sandbox — WASD run, Shift sprint, Space jump, Click/Ctrl mid-air = DIVE, Q/E tilt, R restart')
