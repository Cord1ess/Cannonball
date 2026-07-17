import * as THREE from 'three'
import { BALL_RADIUS } from '@shared/constants.ts'
import { addInkOutline, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'

/**
 * The most-watched object in the game. Smooth sphere (the sketchy art lives
 * in shading/outline, not the silhouette), with PHYSICAL rolling: rotation is
 * derived from actual motion — rolls exactly when grounded, keeps its spin
 * decaying through the air, and NEVER rotates while at rest.
 */

export interface BallView {
  readonly group: THREE.Group
  update(x: number, y: number, z: number, zoneColor: number | null): void
}

export function createBallView(): BallView {
  const group = new THREE.Group()

  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 36, 24), makeToonMaterial(PALETTE.ballCream))
  addInkOutline(ball, INK_WEIGHT.character)
  group.add(ball)

  const blobMat = new THREE.MeshBasicMaterial({
    color: PALETTE.shadowShape,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  })
  const blob = new THREE.Mesh(new THREE.CircleGeometry(BALL_RADIUS * 1.15, 32), blobMat)
  blob.rotation.x = -Math.PI / 2
  group.add(blob)

  const zoneColor = new THREE.Color()
  const rollAxis = new THREE.Vector3()
  const airAxis = new THREE.Vector3(1, 0, 0)
  const q = new THREE.Quaternion()
  let airSpin = 0 // radians per frame carried into the air
  let last: { x: number; z: number } | null = null

  return {
    group,
    update(x: number, y: number, z: number, zone: number | null): void {
      ball.position.set(x, y, z)

      // physical roll from actual displacement — no phantom spin
      if (last) {
        const dx = x - last.x
        const dz = z - last.z
        const dist = Math.hypot(dx, dz)
        const grounded = y < BALL_RADIUS + 0.08
        if (grounded && dist > 1e-5) {
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

      blob.position.set(x, 0.045, z)
      blobMat.opacity = Math.max(0.25, 0.65 - (y - BALL_RADIUS) * 0.08)
      if (zone === null) {
        blobMat.color.setHex(PALETTE.shadowShape)
      } else {
        zoneColor.setHex(zone)
        blobMat.color.copy(zoneColor)
      }
    },
  }
}
