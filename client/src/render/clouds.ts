import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { addInkOutline, INK_WEIGHT, makeToonMaterial } from './materials.ts'

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

  // a bumpy horizontal cluster — bigger core puffs, smaller ones piled on top
  const n = 6 + Math.floor(rng() * 5) // 6..10 puffs
  const spread = 20 + rng() * 16 // how wide the cloud is (big, reads far out)
  for (let i = 0; i < n; i++) {
    // lay puffs along a flattened disc so clouds are wider than tall, with a
    // few stacked higher for a cauliflower top
    const t = i / n
    const bx = (rng() - 0.5) * spread * 2
    const bz = (rng() - 0.5) * spread
    const by = (rng() - 0.5) * 6 + (rng() < 0.4 ? 6 + rng() * 8 : 0) // some ride high
    const r = 9 + rng() * 10 * (1 - t * 0.4) // core puffs bigger
    // low-poly sphere: reads as a soft toon lump, cheap
    const geo = new THREE.SphereGeometry(r, 10, 8)
    // squash very slightly so the blob is cloud-like, not a ball pile
    geo.scale(1, 0.82, 1)
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

  // ONE crayon ink hull around the whole merged silhouette — the outline reads
  // as a single hand-drawn cloud edge, not per-puff rings. Build a merged hull
  // geometry from all puffs (in the cloud's local space) and wrap it.
  const hullSources: THREE.BufferGeometry[] = []
  for (const p of puffs) {
    const g = p.mesh.geometry.clone()
    g.translate(p.bx, p.by, p.bz)
    hullSources.push(g)
  }
  const merged = mergeGeometries(hullSources)
  for (const g of hullSources) g.dispose()
  const outlineHost = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ visible: false }))
  addInkOutline(outlineHost, INK_WEIGHT.prop)
  group.add(outlineHost)

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
