import * as THREE from 'three'
import { PALETTE } from './palette.ts'
import {
  cannonMouth,
  launchArcPoint,
  launchFlightTime,
  launchLandingPoint,
  launchVelocity,
  type Arena,
} from '@shared/sim/arena.ts'

/**
 * The PREDICTIVE LAUNCH TRAJECTORY (M6b, art_direction.md §8 — everything drawn).
 * A beaded arc of small paint dots from the cannon muzzle to the landing point,
 * plus a painted landing-RING on the pitch. NO numbers — purely visual. Updates
 * live as the player aims (yaw) and charges (distance/height). The arc is the
 * SAME ballistic solve the server flies, so the dots show exactly where you land.
 *
 * Pooled: a fixed set of instanced dots + one ring, shown/hidden per frame; zero
 * allocation while aiming. Colour = the player's team so it reads as "yours".
 */

const DOTS = 22 // beads along the arc

export interface Trajectory {
  readonly group: THREE.Object3D
  /** redraw the arc for a zone launch (aim yaw offset, charge 0..1, team colour) */
  show(arena: Arena, zone: number, aim: number, charge: number, color: number): void
  hide(): void
}

export function createTrajectory(): Trajectory {
  const group = new THREE.Group()
  group.visible = false

  // beaded dots — small camera-facing sprites so they read as painted marks
  const dotTex = dotTexture()
  const dotMat = new THREE.SpriteMaterial({ map: dotTex, transparent: true, depthWrite: false, depthTest: true })
  const dots: THREE.Sprite[] = []
  for (let i = 0; i < DOTS; i++) {
    const s = new THREE.Sprite(dotMat.clone())
    s.scale.setScalar(0.9)
    group.add(s)
    dots.push(s)
  }

  // landing RING on the pitch — a flat painted hoop that sits just above grass
  const ringGeo = new THREE.RingGeometry(1.5, 2.1, 32)
  ringGeo.rotateX(-Math.PI / 2)
  const ringMat = new THREE.MeshBasicMaterial({
    color: PALETTE.ink,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  group.add(ring)
  // a filled soft target under the ring, team-tinted
  const spotGeo = new THREE.CircleGeometry(1.5, 32)
  spotGeo.rotateX(-Math.PI / 2)
  const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false })
  const spot = new THREE.Mesh(spotGeo, spotMat)
  group.add(spot)

  const from = { x: 0, y: 0, z: 0 }

  return {
    group,
    show(arena, zone, aim, charge, color) {
      group.visible = true
      const mouth = cannonMouth(arena, zone)
      from.x = mouth.x
      from.y = mouth.y
      from.z = mouth.z
      const land = launchLandingPoint(arena, zone, aim, charge)
      const flight = launchFlightTime(charge)
      const vel = launchVelocity(mouth, land, flight)

      // colour the beads + spot to the team
      const col = new THREE.Color(color)
      for (let i = 0; i < DOTS; i++) {
        const u = (i + 1) / (DOTS + 1)
        const p = launchArcPoint(mouth, vel, flight, u)
        const s = dots[i]!
        s.position.set(p.x, p.y, p.z)
        // beads shrink toward the landing so the arc reads directionally
        s.scale.setScalar(1.05 - u * 0.5)
        ;(s.material as THREE.SpriteMaterial).color.copy(col)
      }
      ring.position.set(land.x, 0.06, land.z)
      spot.position.set(land.x, 0.05, land.z)
      spotMat.color.copy(col)
    },
    hide() {
      group.visible = false
    },
  }
}

/** a soft round paint dot with a faint ink rim — the bead sprite. */
function dotTexture(): THREE.CanvasTexture {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.85, 'rgba(74,68,60,0.5)')
  g.addColorStop(1, 'rgba(74,68,60,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
