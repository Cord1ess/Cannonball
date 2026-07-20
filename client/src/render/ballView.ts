import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BALL_RADIUS } from '@shared/constants.ts'
import { addInkOutline, INK_WEIGHT, toonRamp } from './materials.ts'
import { ballTexture } from './textures.ts'

/**
 * The most-watched object in the game, with PHYSICAL rolling: rotation is
 * derived from actual motion — rolls exactly when grounded, keeps its spin
 * decaying through the air, and NEVER rotates while at rest.
 *
 * The ball is a downloaded GLB football model (`client/public/ball.glb`),
 * scaled to BALL_RADIUS and given an ink outline in our style. Until the model
 * loads (async) a procedural painted sphere stands in, so the ball is never
 * missing. Grounded by the REAL cast shadow only — no fake blob disc.
 */

export interface BallView {
  readonly group: THREE.Group
  update(x: number, y: number, z: number, zoneColor: number | null): void
}

export function createBallView(): BallView {
  const group = new THREE.Group()
  // the SPINNER carries all rolling rotation; its child is swapped from the
  // stand-in sphere to the loaded GLB model without touching the roll state.
  const spinner = new THREE.Group()
  group.add(spinner)

  // stand-in: the procedural painted sphere (shows until the GLB loads)
  const placeholder = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 48, 32),
    new THREE.MeshToonMaterial({ gradientMap: toonRamp(), map: ballTexture() }),
  )
  placeholder.castShadow = true
  addInkOutline(placeholder, INK_WEIGHT.character)
  spinner.add(placeholder)

  // load the real football model; swap it in once ready
  new GLTFLoader().load(
    '/ball.glb',
    (gltf) => {
      const model = gltf.scene
      // scale the model so its widest extent == the ball diameter
      const box = new THREE.Box3().setFromObject(model)
      const size = new THREE.Vector3()
      box.getSize(size)
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const s = (BALL_RADIUS * 2) / maxDim
      model.scale.setScalar(s)
      // recenter on its own centroid so it spins about its middle, not a corner
      const center = new THREE.Vector3()
      box.getCenter(center)
      model.position.set(-center.x * s, -center.y * s, -center.z * s)
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh
          m.castShadow = true
          // keep the model's OWN material (the good football texture); just tame
          // any high metalness so it reads under our toon/flat light rig
          const mat = m.material as THREE.MeshStandardMaterial
          if (mat && 'metalness' in mat) mat.metalness = Math.min(mat.metalness ?? 0, 0.1)
          // ink outline per sub-mesh (addInkOutline needs a real geometry)
          addInkOutline(m, INK_WEIGHT.character)
        }
      })
      spinner.remove(placeholder)
      placeholder.geometry.dispose()
      ;(placeholder.material as THREE.Material).dispose()
      spinner.add(model)
    },
    undefined,
    () => {
      // load failed → keep the procedural sphere (never a missing ball)
    },
  )

  const rollAxis = new THREE.Vector3()
  const airAxis = new THREE.Vector3(1, 0, 0)
  const q = new THREE.Quaternion()
  let airSpin = 0 // radians per frame carried into the air
  let last: { x: number; z: number } | null = null

  return {
    group,
    update(x: number, y: number, z: number, _zone: number | null): void {
      group.position.set(x, y, z)

      // physical roll from actual displacement — no phantom spin
      if (last) {
        const dx = x - last.x
        const dz = z - last.z
        const dist = Math.hypot(dx, dz)
        const grounded = y < BALL_RADIUS + 0.08
        if (grounded && dist > 2e-3) {
          rollAxis.set(dz, 0, -dx).normalize() // up x velocity
          const angle = dist / BALL_RADIUS
          q.setFromAxisAngle(rollAxis, angle)
          spinner.quaternion.premultiply(q)
          airAxis.copy(rollAxis)
          airSpin = angle
        } else if (!grounded && airSpin > 1e-4) {
          airSpin *= 0.99 // spin persists through flight, slowly bleeding off
          q.setFromAxisAngle(airAxis, airSpin)
          spinner.quaternion.premultiply(q)
        } else if (grounded) {
          airSpin = 0
        }
      }
      last = { x, z }
    },
  }
}
