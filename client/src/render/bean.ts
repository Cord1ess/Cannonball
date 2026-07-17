import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { addInkOutline, disposeHierarchy, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'
import { faceTexture } from './textures.ts'

/**
 * The blocky bean (art_direction.md §4): Fall Guys proportions, Minecraft
 * construction. ~6 animated parts, each a voxel-box cluster merged ONCE at
 * build time. Code-driven animation — no mixer, no skinning.
 */

export interface BeanPose {
  x: number
  y: number
  z: number
  yaw: number
  /** horizontal speed 0..1 (fraction of MOVE_SPEED) */
  run: number
  grounded: boolean
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

let sharedFace: THREE.Texture | null = null

export function createBean(teamColor: number, shortsColor: number = PALETTE.offWhite): Bean {
  const group = new THREE.Group()
  const disposables: Array<{ dispose(): void }> = []

  const track = (mesh: THREE.Mesh): THREE.Mesh => {
    disposables.push(mesh.geometry)
    return mesh
  }

  // shorts band (bottom rows) + body (upper rows) — the stepped bean silhouette
  const shorts = track(
    new THREE.Mesh(
      stackGeometry(
        [
          [0.72, 0.16],
          [0.82, 0.18],
        ],
        0.12,
      ),
      makeToonMaterial(shortsColor),
    ),
  )
  const body = track(
    new THREE.Mesh(
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
    ),
  )
  addInkOutline(shorts, INK_WEIGHT.character)
  addInkOutline(body, INK_WEIGHT.character)
  group.add(shorts, body)

  // feet
  const footGeo = new THREE.BoxGeometry(0.24, 0.12, 0.32)
  footGeo.translate(0, 0.06, 0.02)
  const feet: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(footGeo.clone(), makeToonMaterial(PALETTE.ink))
    foot.position.set(side * 0.2, 0, 0)
    addInkOutline(foot, INK_WEIGHT.character)
    track(foot)
    feet.push(foot)
    group.add(foot)
  }
  footGeo.dispose()

  // arms — origin at the shoulder so rotation.x swings them
  const armGeo = new THREE.BoxGeometry(0.16, 0.44, 0.2)
  armGeo.translate(0, -0.22, 0)
  const arms: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo.clone(), makeToonMaterial(teamColor))
    arm.position.set(side * 0.52, 1.0, 0)
    addInkOutline(arm, INK_WEIGHT.character)
    track(arm)
    arms.push(arm)
    group.add(arm)
  }
  armGeo.dispose()

  // face plate: pale panel + eyes, inset into the front of the top rows
  const plate = track(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.05), makeToonMaterial(0xfbf6e8)))
  plate.position.set(0, 0.98, 0.33)
  group.add(plate)
  sharedFace ??= faceTexture()
  const eyes = track(
    new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.36),
      new THREE.MeshBasicMaterial({ map: sharedFace, transparent: true }),
    ),
  )
  eyes.position.set(0, 0.98, 0.362)
  group.add(eyes)

  // blob shadow
  const blob = track(
    new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 20),
      new THREE.MeshBasicMaterial({ color: PALETTE.shadowShape, transparent: true, opacity: 0.55, depthWrite: false }),
    ),
  )
  blob.rotation.x = -Math.PI / 2
  group.add(blob)

  let t = Math.random() * 10 // desync idle phases between beans
  let headerSnap = 0

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
      const snap = headerSnap * headerSnap * 0.5

      if (!pose.grounded) {
        // tucked jump: arms up, feet gathered
        arms[0]!.rotation.x = -2.4 - snap
        arms[1]!.rotation.x = -2.4 - snap
        feet[0]!.rotation.x = 0.6
        feet[1]!.rotation.x = 0.6
        group.rotation.x = -snap
        body.position.y = 0
        shorts.position.y = 0
      } else if (pose.run > 0.08) {
        // flaily sprint
        const swing = Math.sin(t * 11) * 0.9 * pose.run
        arms[0]!.rotation.x = swing
        arms[1]!.rotation.x = -swing
        feet[0]!.rotation.x = -swing * 0.7
        feet[1]!.rotation.x = swing * 0.7
        group.rotation.x = 0.12 * pose.run - snap
        const bob = Math.abs(Math.sin(t * 11)) * 0.05 * pose.run
        body.position.y = bob
        shorts.position.y = bob
      } else {
        // bouncy idle
        arms[0]!.rotation.x = Math.sin(t * 2.4) * 0.08
        arms[1]!.rotation.x = Math.sin(t * 2.4 + 1) * 0.08
        feet[0]!.rotation.x = 0
        feet[1]!.rotation.x = 0
        group.rotation.x = -snap
        const bob = Math.sin(t * 2.4) * 0.02
        body.position.y = bob
        shorts.position.y = bob
      }

      // blob shadow stays on the floor, fades with height
      blob.position.y = 0.013 - pose.y
      const blobMat = blob.material as THREE.MeshBasicMaterial
      blobMat.opacity = Math.max(0.12, 0.55 - pose.y * 0.18)
    },
    dispose(): void {
      disposeHierarchy(group)
      for (const d of disposables) d.dispose()
    },
  }
}
