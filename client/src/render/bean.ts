import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { addInkOutline, disposeHierarchy, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'

/**
 * The blocky bean (art_direction.md §4): Fall Guys proportions, Minecraft
 * construction, code-driven animation — no mixer, no skinning.
 *
 * Every animated value is a TARGET passed through a spring each frame, so
 * state changes (run -> jump -> dive) always transition, never snap.
 *
 * Arm spread convention: arms hang from shoulders; for the LEFT arm (-x)
 * "outward" is rotation.z NEGATIVE, for the RIGHT arm (+x) POSITIVE —
 * i.e. rotation.z = side * spread.
 */

export interface BeanPose {
  x: number
  y: number
  z: number
  yaw: number
  /** horizontal speed 0..1 (fraction of SPRINT_SPEED) */
  run: number
  grounded: boolean
  diving: boolean
  /** ball hit you: tumbling, flailing, no control */
  knocked: boolean
  /** true while shift-sprinting: blends run arms -> T-pose glide */
  sprinting: boolean
  /** -1 (Q, left) .. +1 (E, right); works grounded AND in the air */
  lean: number
  /** where the eyes look, local to facing: x -1..1 (left/right), y -1..1 (down/up) */
  lookX: number
  lookY: number
}

export interface Bean {
  readonly group: THREE.Group
  update(dt: number, pose: BeanPose): void
  /** whole-body snap on a header connect */
  header(): void
  dispose(): void
}

/** Stack rows: [width, height] bottom-up. Depth is width * 0.8. */
function stackGeometry(rows: ReadonlyArray<readonly [number, number]>, y0: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  let y = y0
  for (const [w, h] of rows) {
    const box = new THREE.BoxGeometry(w, h, w * 0.8)
    box.translate(0, y + h / 2, 0)
    parts.push(box)
    y += h
  }
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  return merged
}

const spring = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt))

export function createBean(teamColor: number, shortsColor: number = PALETTE.offWhite): Bean {
  const group = new THREE.Group()
  group.rotation.order = 'YXZ' // yaw first, THEN pitch/roll — keeps lean/tilt axes local

  // inner rig carries all body animation; group carries position + yaw
  const rig = new THREE.Group()
  group.add(rig)

  const shorts = new THREE.Mesh(
    stackGeometry(
      [
        [0.72, 0.16],
        [0.82, 0.18],
      ],
      0.12,
    ),
    makeToonMaterial(shortsColor),
  )
  const body = new THREE.Mesh(
    stackGeometry(
      [
        [0.88, 0.22],
        [0.86, 0.26],
        [0.76, 0.26],
        [0.58, 0.2],
      ],
      0.46,
    ),
    makeToonMaterial(teamColor),
  )
  addInkOutline(shorts, INK_WEIGHT.character)
  addInkOutline(body, INK_WEIGHT.character)
  rig.add(shorts, body)

  // feet
  const footGeo = new THREE.BoxGeometry(0.24, 0.12, 0.32)
  footGeo.translate(0, 0.06, 0.02)
  const feet: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(footGeo.clone(), makeToonMaterial(PALETTE.ink))
    foot.position.set(side * 0.2, 0, 0)
    addInkOutline(foot, INK_WEIGHT.character)
    feet.push(foot)
    rig.add(foot)
  }
  footGeo.dispose()

  // arms — origin at the shoulder; rotation.x swings, rotation.z = side * spread
  const armGeo = new THREE.BoxGeometry(0.16, 0.44, 0.2)
  armGeo.translate(0, -0.22, 0)
  const arms: THREE.Mesh[] = []
  const armSides = [-1, 1] as const
  for (const side of armSides) {
    const arm = new THREE.Mesh(armGeo.clone(), makeToonMaterial(teamColor))
    arm.position.set(side * 0.52, 1.0, 0)
    addInkOutline(arm, INK_WEIGHT.character)
    arms.push(arm)
    rig.add(arm)
  }
  armGeo.dispose()

  // face plate + two animatable eyes
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.05), makeToonMaterial(0xfbf6e8))
  plate.position.set(0, 0.98, 0.33)
  rig.add(plate)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1c1a18 })
  const eyes: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.15), eyeMat)
    eye.position.set(side * 0.11, 0.98, 0.362)
    eyes.push(eye)
    rig.add(eye)
  }

  // blob shadow (on group so it never inherits rig tilt)
  const blobMat = new THREE.MeshBasicMaterial({
    color: PALETTE.shadowShape,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), blobMat)
  blob.rotation.x = -Math.PI / 2
  group.add(blob)

  // --- animation state -----------------------------------------------------------

  let t = Math.random() * 10 // desync phases between beans
  let headerSnap = 0
  let leanSmooth = 0
  let sprintBlend = 0
  let blinkTimer = 1 + Math.random() * 3
  let blinkPhase = 0
  let fidgetTimer = 2 + Math.random() * 4
  let fidget = 0 // 0 none, 1 look-around, 2 stretch, 3 weight shift
  let fidgetT = 0
  const eyeLook = { x: 0, y: 0 }

  return {
    group,
    header(): void {
      headerSnap = 1
    },
    update(dt: number, pose: BeanPose): void {
      t += dt
      group.position.set(pose.x, pose.y, pose.z)
      group.rotation.y = pose.yaw

      headerSnap = Math.max(0, headerSnap - dt * 4)
      const snap = headerSnap * headerSnap * 0.6

      // lean (Q/E): springy, grounded AND airborne. Positive lean = tip right.
      leanSmooth = spring(leanSmooth, pose.lean, 10, dt)
      const leanRoll = leanSmooth * 0.42

      sprintBlend = spring(sprintBlend, pose.sprinting ? 1 : 0, 8, dt)

      // eyes: track the ball, blink
      blinkTimer -= dt
      if (blinkTimer <= 0) {
        blinkPhase = 0.11
        blinkTimer = 1.6 + Math.random() * 3.4
      }
      if (blinkPhase > 0) blinkPhase -= dt
      eyeLook.x = spring(eyeLook.x, pose.lookX, 12, dt)
      eyeLook.y = spring(eyeLook.y, pose.lookY, 12, dt)
      const eyeScaleY = blinkPhase > 0 ? 0.1 : 1
      let eyeDart = 0

      // --- compute TARGETS per state; springs apply uniformly below ----------------
      let armX = [0, 0]
      let armSpread = 0.08 // outward, applied as side * spread
      let footX = [0, 0]
      let rigX = 0
      let rigZ = leanRoll
      let rigY = 0

      if (pose.knocked) {
        // oof: thrown back, limbs flailing
        const wobble = Math.sin(t * 22)
        armX = [-2.2 + wobble * 0.5, -2.2 - wobble * 0.5]
        armSpread = 0.9
        footX = [0.8 + wobble * 0.3, 0.8 - wobble * 0.3]
        rigX = -0.75
        rigZ = leanRoll + wobble * 0.15
        rigY = 0.1
      } else if (pose.diving) {
        // superman: horizontal body, arms swept forward-out, feet trailing
        armX = [-2.9, -2.9]
        armSpread = 0.7
        footX = [-0.5, -0.5]
        rigX = 1.25
        rigZ = leanRoll * 0.6
        rigY = 0.35
      } else if (!pose.grounded) {
        // tucked jump — springs make the entry/exit read as a motion, not a cut
        armX = [-2.4 - snap, -2.4 - snap]
        armSpread = 0.3
        footX = [0.6, 0.6]
        rigX = -0.12 - snap
      } else if (pose.run > 0.08) {
        // NORMAL RUN: back-and-forth arm swing ... SPRINT: T-pose wind glide.
        // sprintBlend crossfades every target smoothly.
        const b = sprintBlend
        const swing = Math.sin(t * 11) * 0.9 * pose.run
        const flutter = Math.sin(t * 13) * 0.12
        armX = [swing * (1 - b) + flutter * b, -swing * (1 - b) - flutter * b]
        armSpread = 0.12 * (1 - b) + 1.35 * b
        const kickRate = 14 + 4 * b
        const kick = Math.sin(t * kickRate) * (0.5 + 0.1 * b) * pose.run
        footX = [kick, -kick]
        const hop = Math.abs(Math.sin(t * 9)) * (0.035 + 0.06 * b) * pose.run
        const jitterX = (Math.sin(t * 31) + Math.sin(t * 47.3)) * 0.012 * pose.run * b
        const jitterZ = (Math.sin(t * 37.7) + Math.sin(t * 53.1)) * 0.012 * pose.run * b
        rigY = hop
        rigX = (0.1 + 0.1 * b) * pose.run + jitterX - snap
        rigZ = leanRoll + jitterZ
      } else {
        // bouncy idle + random fidgets
        fidgetTimer -= dt
        if (fidgetTimer <= 0) {
          fidget = 1 + Math.floor(Math.random() * 3)
          fidgetT = 0
          fidgetTimer = 3 + Math.random() * 5
        }
        fidgetT += dt
        if (fidgetT > 1.2) fidget = 0

        rigY = Math.sin(t * 2.4) * 0.025
        rigX = -snap
        armX = [Math.sin(t * 2.4) * 0.08, Math.sin(t * 2.4 + 1) * 0.08]

        if (fidget === 1) {
          eyeDart = Math.sin(fidgetT * 5) * 0.03
          rigZ += Math.sin(fidgetT * 3) * 0.05
        } else if (fidget === 2) {
          const up = Math.sin(Math.min(1, fidgetT) * Math.PI)
          armX = [-2.6 * up, -2.6 * up]
          armSpread = 0.08 + up * 0.4
        } else if (fidget === 3) {
          rigZ += Math.sin(fidgetT * 2.6) * 0.12
        }
      }

      // --- apply through springs (uniform smoothing everywhere) ---------------------
      rig.rotation.x = spring(rig.rotation.x, rigX, 12, dt)
      rig.rotation.z = spring(rig.rotation.z, rigZ, 10, dt)
      rig.position.y = spring(rig.position.y, rigY, 14, dt)
      for (let i = 0; i < 2; i++) {
        const side = armSides[i]!
        arms[i]!.rotation.x = spring(arms[i]!.rotation.x, armX[i]!, 12, dt)
        arms[i]!.rotation.z = spring(arms[i]!.rotation.z, side * armSpread, 10, dt)
        feet[i]!.rotation.x = spring(feet[i]!.rotation.x, footX[i]!, 16, dt)
        const eye = eyes[i]!
        eye.position.x = side * 0.11 + eyeLook.x * 0.05 + eyeDart
        eye.position.y = 0.98 + eyeLook.y * 0.035
        eye.scale.y = eyeScaleY
      }

      // blob shadow stays on the floor, fades with height
      blob.position.y = 0.03 - pose.y
      blobMat.opacity = Math.max(0.12, 0.55 - pose.y * 0.18)
    },
    dispose(): void {
      disposeHierarchy(group)
    },
  }
}
