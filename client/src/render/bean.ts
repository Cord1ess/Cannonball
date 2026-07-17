import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { addInkOutline, disposeHierarchy, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'

/**
 * The blocky bean (art_direction.md §4): Fall Guys proportions, Minecraft
 * construction. ~6 animated parts, each a voxel-box cluster merged ONCE at
 * build time. Code-driven animation — no mixer, no skinning.
 *
 * Animation set: bouncy idle + random fidgets, T-pose wind-glide run with
 * mini-hops and jitter, tucked jump, superman dive, Q/E lean, eye tracking
 * (looks at the ball) and blinking.
 */

export interface BeanPose {
  x: number
  y: number
  z: number
  yaw: number
  /** horizontal speed 0..1 (fraction of MOVE_SPEED) */
  run: number
  grounded: boolean
  diving: boolean
  /** -1 (Q, left) .. +1 (E, right) */
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

export function createBean(teamColor: number, shortsColor: number = PALETTE.offWhite): Bean {
  const group = new THREE.Group()
  group.rotation.order = 'YXZ' // yaw first, THEN pitch/roll — the lean-axis bug fix

  // inner rig carries all body animation; group carries position + yaw
  const rig = new THREE.Group()
  group.add(rig)

  // shorts band (bottom rows) + body (upper rows) — the stepped bean silhouette
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

  // arms — origin at the shoulder; rotation.x swings, rotation.z spreads (T-pose)
  const armGeo = new THREE.BoxGeometry(0.16, 0.44, 0.2)
  armGeo.translate(0, -0.22, 0)
  const arms: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
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

  // blob shadow (kept on group so it never inherits rig tilt)
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
  let blinkTimer = 1 + Math.random() * 3
  let blinkPhase = 0 // >0 while blinking
  let fidgetTimer = 2 + Math.random() * 4
  let fidget = 0 // 0 none, 1 look-around, 2 stretch, 3 weight shift
  let fidgetT = 0
  const eyeLook = { x: 0, y: 0 }

  const springTo = (current: number, target: number, rate: number, dt: number): number =>
    current + (target - current) * (1 - Math.exp(-rate * dt))

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

      // lean: springy, addictive — works standing AND running
      leanSmooth = springTo(leanSmooth, pose.lean, 10, dt)
      const leanRoll = -leanSmooth * 0.42

      // eyes: track the ball, blink
      blinkTimer -= dt
      if (blinkTimer <= 0) {
        blinkPhase = 0.11
        blinkTimer = 1.6 + Math.random() * 3.4
      }
      if (blinkPhase > 0) blinkPhase -= dt
      eyeLook.x = springTo(eyeLook.x, pose.lookX, 12, dt)
      eyeLook.y = springTo(eyeLook.y, pose.lookY, 12, dt)
      const eyeScaleY = blinkPhase > 0 ? 0.1 : 1
      for (const side of [0, 1]) {
        const eye = eyes[side]!
        eye.position.x = (side === 0 ? -0.11 : 0.11) + eyeLook.x * 0.05
        eye.position.y = 0.98 + eyeLook.y * 0.035
        eye.scale.y = eyeScaleY
      }

      if (pose.diving) {
        // superman: body horizontal, arms spread forward, feet trailing
        rig.rotation.x = springTo(rig.rotation.x, 1.25, 14, dt)
        rig.rotation.z = springTo(rig.rotation.z, leanRoll * 0.4, 10, dt)
        rig.position.y = 0.35
        arms[0]!.rotation.x = -2.9
        arms[1]!.rotation.x = -2.9
        arms[0]!.rotation.z = 0.7
        arms[1]!.rotation.z = -0.7
        feet[0]!.rotation.x = -0.5
        feet[1]!.rotation.x = -0.5
      } else if (!pose.grounded) {
        // tucked jump
        rig.rotation.x = springTo(rig.rotation.x, -0.12 - snap, 12, dt)
        rig.rotation.z = springTo(rig.rotation.z, leanRoll * 0.5, 10, dt)
        rig.position.y = 0
        arms[0]!.rotation.x = -2.4 - snap
        arms[1]!.rotation.x = -2.4 - snap
        arms[0]!.rotation.z = 0.3
        arms[1]!.rotation.z = -0.3
        feet[0]!.rotation.x = 0.6
        feet[1]!.rotation.x = 0.6
      } else if (pose.run > 0.08) {
        // wind-glider sprint: arms spread to a T, mini-hops, a little jitter
        const hop = Math.abs(Math.sin(t * 9)) * 0.09 * pose.run
        const jitterX = (Math.sin(t * 31) + Math.sin(t * 47.3)) * 0.012 * pose.run
        const jitterZ = (Math.sin(t * 37.7) + Math.sin(t * 53.1)) * 0.012 * pose.run
        rig.position.y = hop
        rig.rotation.x = springTo(rig.rotation.x, 0.16 * pose.run + jitterX - snap, 12, dt)
        rig.rotation.z = springTo(rig.rotation.z, leanRoll + jitterZ, 10, dt)
        // T-pose glide: arms out sideways, fluttering in the wind
        const flutter = Math.sin(t * 13) * 0.12 * pose.run
        arms[0]!.rotation.x = flutter
        arms[1]!.rotation.x = -flutter
        arms[0]!.rotation.z = springTo(arms[0]!.rotation.z, 1.35 + flutter * 0.5, 10, dt)
        arms[1]!.rotation.z = springTo(arms[1]!.rotation.z, -1.35 + flutter * 0.5, 10, dt)
        // little scamper kicks
        const kick = Math.sin(t * 18) * 0.55 * pose.run
        feet[0]!.rotation.x = kick
        feet[1]!.rotation.x = -kick
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

        const bob = Math.sin(t * 2.4) * 0.025
        rig.position.y = bob
        rig.rotation.x = springTo(rig.rotation.x, -snap, 10, dt)

        let idleRoll = leanRoll
        let armL = Math.sin(t * 2.4) * 0.08
        let armR = Math.sin(t * 2.4 + 1) * 0.08
        let armLz = 0.06
        let armRz = -0.06
        if (fidget === 1) {
          // look around: eyes dart + slight body turn
          const dart = Math.sin(fidgetT * 5)
          eyes[0]!.position.x += dart * 0.03
          eyes[1]!.position.x += dart * 0.03
          idleRoll += Math.sin(fidgetT * 3) * 0.05
        } else if (fidget === 2) {
          // stretch: both arms up briefly
          const up = Math.sin(Math.min(1, fidgetT) * Math.PI)
          armL = -2.6 * up
          armR = -2.6 * up
        } else if (fidget === 3) {
          // weight shift
          idleRoll += Math.sin(fidgetT * 2.6) * 0.12
        }
        rig.rotation.z = springTo(rig.rotation.z, idleRoll, 8, dt)
        arms[0]!.rotation.x = armL
        arms[1]!.rotation.x = armR
        arms[0]!.rotation.z = springTo(arms[0]!.rotation.z, armLz, 8, dt)
        arms[1]!.rotation.z = springTo(arms[1]!.rotation.z, armRz, 8, dt)
        feet[0]!.rotation.x = 0
        feet[1]!.rotation.x = 0
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
