import * as THREE from 'three'
import { BALL_RADIUS } from '@shared/constants.ts'
import { ballTexture } from './textures.ts'
import { addInkOutline, INK_WEIGHT, toonRamp } from './materials.ts'

/**
 * The most-watched object in the game. Smooth sphere (the sketchy art lives
 * in shading/outline, not the silhouette), with PHYSICAL rolling: rotation is
 * derived from actual motion — rolls exactly when grounded, keeps its spin
 * decaying through the air, and NEVER rotates while at rest.
 *
 * The ball wears a colourful world-cup-style panel skin (canvas texture) and is
 * grounded by the REAL cast shadow only — no fake blob disc.
 */

export interface BallView {
  readonly group: THREE.Group
  update(x: number, y: number, z: number, zoneColor: number | null): void
}

export function createBallView(): BallView {
  const group = new THREE.Group()

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 40, 28),
    new THREE.MeshToonMaterial({ gradientMap: toonRamp(), map: ballTexture() }),
  )
  ball.castShadow = true
  addInkOutline(ball, INK_WEIGHT.character)
  group.add(ball)

  const rollAxis = new THREE.Vector3()
  const airAxis = new THREE.Vector3(1, 0, 0)
  const q = new THREE.Quaternion()
  let airSpin = 0 // radians per frame carried into the air
  let last: { x: number; z: number } | null = null

  return {
    group,
    update(x: number, y: number, z: number, _zone: number | null): void {
      ball.position.set(x, y, z)

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
          ball.quaternion.premultiply(q)
          airAxis.copy(rollAxis)
          airSpin = angle
        } else if (!grounded && airSpin > 1e-4) {
          airSpin *= 0.99 // spin persists through flight, slowly bleeding off
          q.setFromAxisAngle(airAxis, airSpin)
          ball.quaternion.premultiply(q)
        } else if (grounded) {
          airSpin = 0
        }
      }
      last = { x, z }
    },
  }
}
