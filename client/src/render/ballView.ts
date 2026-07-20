import * as THREE from 'three'
import { BALL_RADIUS } from '@shared/constants.ts'
import { addInkOutline, INK_WEIGHT, toonRamp } from './materials.ts'
import { ballTexture } from './textures.ts'

/**
 * The most-watched object in the game, with PHYSICAL rolling: rotation is
 * derived from actual motion — rolls exactly when grounded, keeps its spin
 * decaying through the air, and NEVER rotates while at rest.
 *
 * The ball is OUR simple sphere (so it takes a clean toon ink outline + toon
 * shading, unlike the dense downloaded model whose 32k unmerged verts explode
 * the hull), wearing `ball_pattern.png` — the classic pentagon/hexagon football
 * pattern BAKED to an equirectangular texture from the downloaded model, so the
 * pattern is perfect AND it maps cleanly to the sphere's UVs. Near-white, matte.
 * The texture loads async; a procedural sphere stands in until it's ready.
 * Grounded by the REAL cast shadow only — no fake blob disc.
 */

export interface BallView {
  readonly group: THREE.Group
  update(x: number, y: number, z: number, zoneColor: number | null): void
}

export function createBallView(): BallView {
  const group = new THREE.Group()
  // the SPINNER carries all rolling rotation
  const spinner = new THREE.Group()
  group.add(spinner)

  // OUR sphere — clean geometry that takes a proper ink outline. Starts on the
  // procedural painted texture, swaps to the baked football pattern once loaded.
  const mat = new THREE.MeshToonMaterial({ gradientMap: toonRamp(), map: ballTexture() })
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 32), mat)
  ball.castShadow = true
  addInkOutline(ball, INK_WEIGHT.character) // the clean toon rim — works on our sphere
  spinner.add(ball)

  // swap in the baked football pattern (equirect → wraps our sphere perfectly)
  new THREE.TextureLoader().load('/ball_pattern.png', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    mat.map = tex
    // tone toward near-white (a hair warm) so it reads as a clean white football
    mat.color.setHex(0xfbf7ee)
    mat.needsUpdate = true
  })

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
