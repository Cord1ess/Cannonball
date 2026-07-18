import * as THREE from 'three'
import { makeToonMaterial } from './materials.ts'

/**
 * The sky's clouds (M5b revamp): real 3D BUBBLY toon clouds, not painted PNGs.
 * Each cloud is a lumpy cluster of overlapping spheres — puffs — merged into one
 * blob so a single crayon INK HULL wraps the whole silhouette, matching the
 * game's flat-shaded, hand-outlined art style. Flat toon white fill (so they
 * warm/cool with the day->night sun for free).
 *
 * RANDOM every session (puff counts, shapes, sizes, sky positions) and ALIVE:
 * they drift slowly around the sky bowl, bob gently, and each puff breathes so
 * the silhouette subtly churns like real cloud volume — never a static decal.
 */

export interface Clouds {
  readonly group: THREE.Group
  /** drift + bob + breathe; call every frame with real seconds */
  update(dt: number): void
  dispose(): void
}

interface Puff {
  mesh: THREE.Mesh
  baseScale: number
  bx: number
  by: number
  bz: number
  phase: number
  rate: number
  amp: number
}

interface Cloud {
  group: THREE.Group
  puffs: Puff[]
  // slow orbit around the sky
  orbitR: number
  angle: number
  angVel: number
  height: number
  bobPhase: number
  bobRate: number
  bobAmp: number
}

const COUNT = 11 // clouds ringing the sky
// orbit far out near the sky dome (300) so clouds sit at a LOW elevation — the
// chase cam pitch is clamped (~[-7°, +34°]), so clouds must ride the horizon
// band just above the stadium rim to actually be seen from the pitch.
const SKY_R = 250

/** one lumpy cloud: a cluster of overlapping spheres merged to a single blob. */
function buildCloud(rng: () => number): Cloud {
  const group = new THREE.Group()
  const puffs: Puff[] = []

  // a bumpy horizontal cluster — bigger core puffs, smaller ones piled on top.
  // puffs are packed TIGHT + heavily overlapping so they melt into one soft
  // lumpy mass, not a pile of separate balls (the "full circles" look).
  const n = 7 + Math.floor(rng() * 5) // 7..11 puffs
  const spread = 12 + rng() * 8 // TIGHTER so puffs deeply overlap
  for (let i = 0; i < n; i++) {
    // lay puffs along a flattened line so clouds are wide + low, deeply
    // overlapping neighbours; a couple ride a little higher for a lumpy top
    const t = i / n
    const bx = (rng() - 0.5) * spread * 1.4
    const bz = (rng() - 0.5) * spread * 0.5
    const by = (rng() - 0.5) * 3 + (rng() < 0.35 ? 3 + rng() * 4 : 0)
    const r = 10 + rng() * 8 * (1 - t * 0.3) // big, so neighbours overlap a lot
    // low-poly sphere: reads as a soft toon lump, cheap
    const geo = new THREE.SphereGeometry(r, 10, 8)
    // squash flatter so it's a cloud mass, not a round ball
    geo.scale(1.15, 0.6, 1.0)
    const mesh = new THREE.Mesh(geo, makeToonMaterial(0xf7f9f4))
    mesh.position.set(bx, by, bz)
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
    puffs.push({
      mesh,
      baseScale: 1,
      bx,
      by,
      bz,
      phase: rng() * Math.PI * 2,
      rate: 0.3 + rng() * 0.5,
      amp: 0.05 + rng() * 0.07, // subtle breathing
    })
  }

  // NO ink outline on clouds — the merged hull read as an odd silhouette. Just
  // the bubbly toon puffs, packed tight so they melt into one soft mass.
  return {
    group,
    puffs,
    orbitR: SKY_R * (0.82 + rng() * 0.32),
    angle: rng() * Math.PI * 2,
    angVel: (rng() < 0.5 ? 1 : -1) * (0.006 + rng() * 0.01), // slow, mixed directions
    // low-ish so clouds ride the visible sky band above the rim, not overhead
    height: 34 + rng() * 46,
    bobPhase: rng() * Math.PI * 2,
    bobRate: 0.15 + rng() * 0.2,
    bobAmp: 2 + rng() * 3,
  }
}

export function createClouds(rng: () => number = Math.random): Clouds {
  const group = new THREE.Group()
  group.name = 'clouds'
  const clouds: Cloud[] = []
  for (let i = 0; i < COUNT; i++) {
    const c = buildCloud(rng)
    clouds.push(c)
    group.add(c.group)
  }

  function place(c: Cloud): void {
    const x = Math.cos(c.angle) * c.orbitR
    const z = Math.sin(c.angle) * c.orbitR
    const y = c.height + Math.sin(c.bobPhase) * c.bobAmp
    c.group.position.set(x, y, z)
    // face roughly inward so the flattened disc reads broadside from the pitch
    c.group.rotation.y = -c.angle + Math.PI / 2
  }
  for (const c of clouds) place(c)

  let elapsed = 0
  return {
    group,
    update(dt: number): void {
      elapsed += dt
      for (const c of clouds) {
        c.angle += c.angVel * dt
        c.bobPhase += c.bobRate * dt
        place(c)
        // per-puff breathing: each puff pulses a touch so the silhouette churns
        for (const p of c.puffs) {
          const s = p.baseScale + Math.sin(elapsed * p.rate + p.phase) * p.amp
          p.mesh.scale.setScalar(s)
        }
      }
    },
    dispose(): void {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) m.dispose()
        }
      })
    },
  }
}
