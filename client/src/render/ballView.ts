import * as THREE from 'three'
import { BALL_RADIUS } from '@shared/constants.ts'
import { addInkOutline, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'

/**
 * The most-watched object in the game. Cream ball, heaviest ink weight,
 * and a footprint blob that doubles as the GAMEPLAY zone marker — players
 * read whose wedge the ball is in from this blob (idea.md §1).
 */

export interface BallView {
  readonly group: THREE.Group
  update(x: number, y: number, z: number, zoneColor: number | null): void
}

export function createBallView(): BallView {
  const group = new THREE.Group()

  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 20, 14), makeToonMaterial(PALETTE.ballCream))
  addInkOutline(ball, INK_WEIGHT.character)
  group.add(ball)

  const blobMat = new THREE.MeshBasicMaterial({
    color: PALETTE.shadowShape,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  })
  const blob = new THREE.Mesh(new THREE.CircleGeometry(BALL_RADIUS * 1.15, 24), blobMat)
  blob.rotation.x = -Math.PI / 2
  group.add(blob)

  const zoneColor = new THREE.Color()

  return {
    group,
    update(x: number, y: number, z: number, zone: number | null): void {
      ball.position.set(x, y, z)
      // spin readably along travel (visual only)
      ball.rotation.z -= 0.06
      ball.rotation.x += 0.02

      blob.position.set(x, 0.014, z)
      const heightFade = Math.max(0.25, 0.65 - (y - BALL_RADIUS) * 0.08)
      blobMat.opacity = heightFade
      if (zone === null) {
        blobMat.color.setHex(PALETTE.shadowShape)
      } else {
        zoneColor.setHex(zone)
        blobMat.color.copy(zoneColor)
      }
    },
  }
}
