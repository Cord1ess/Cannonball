import * as THREE from 'three'
import { WALL_HEIGHT } from '@shared/constants.ts'
import type { Arena } from '@shared/sim/arena.ts'
import { yawTowardCenter } from '@shared/sim/arena.ts'
import { addInkOutline, disposeHierarchy, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'
import { tickDecalTexture } from './textures.ts'

/**
 * THE colosseum (M5): one permanent round stadium — floor, seamless ring
 * wall, three audience tiers with an instanced crowd, floating-island
 * underside. Built ONCE and never rebuilt. Only the ZONE LAYER morphs:
 * painted wedge tints, ink division lines, and the wall-crown cannons
 * (one per zone, wearing that seat's color band).
 */

export interface ArenaView {
  readonly group: THREE.Group
  /** repaint the floor divisions + cannons for a new zone layout */
  setZones(arena: Arena, zoneColors: readonly number[]): void
  /** meterFrac per zone [0..1] tints wedges hotter as danger rises */
  setDanger(fracs: readonly number[]): void
  dispose(): void
}

const SEGMENTS = 64

/** Flat XZ ring-sector fan between two radii across an angle span. */
function sectorGeometry(inner: number, outer: number, a0: number, a1: number, segments = 16): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments
    const c = Math.cos(a)
    const s = Math.sin(a)
    positions.push(c * inner, 0, s * inner, c * outer, 0, s * outer)
  }
  for (let i = 0; i < segments; i++) {
    const base = i * 2
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** Flat XZ strip along +X from r0 to r1, width w — the painted division line. */
function stripGeometry(r0: number, r1: number, w: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const h = w / 2
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([r0, 0, -h, r1, 0, -h, r0, 0, h, r1, 0, h], 3),
  )
  geo.setIndex([0, 2, 1, 1, 2, 3])
  geo.computeVertexNormals()
  return geo
}

/** Watertight annulus wall: ring shape extruded up from y=0 to `height`. */
function ringGeometry(inner: number, outer: number, height: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: SEGMENTS })
  geo.rotateX(-Math.PI / 2) // extrusion axis -> up
  return geo
}

let decalTex: THREE.Texture | null = null

/** empty + dispose a group's children (shared textures survive) */
function clearGroup(group: THREE.Group): void {
  disposeHierarchy(group)
  group.clear()
}

export function createArenaView(radius = 28): ArenaView {
  const group = new THREE.Group()

  // --- the permanent building --------------------------------------------------

  // floor slab
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.6, SEGMENTS),
    makeToonMaterial(PALETTE.groundCream, 10),
  )
  floor.position.y = -0.3
  addInkOutline(floor, INK_WEIGHT.arena)
  group.add(floor)

  // seamless ring wall the players bounce off
  const wall = new THREE.Mesh(ringGeometry(radius, radius + 1.8, WALL_HEIGHT), makeToonMaterial(PALETTE.warmGray, 0.15))
  addInkOutline(wall, INK_WEIGHT.arena)
  group.add(wall)

  // three stepped audience tiers + a tall outer rim: the colosseum bowl
  const tierTops: Array<{ inner: number; outer: number; top: number }> = []
  for (let tier = 0; tier < 3; tier++) {
    const inner = radius + 1.8 + tier * 2.6
    const outer = inner + 2.6
    const top = WALL_HEIGHT + 1.1 + tier * 1.5
    tierTops.push({ inner, outer, top })
    const ring = new THREE.Mesh(
      ringGeometry(inner, outer, top),
      makeToonMaterial(tier % 2 === 0 ? PALETTE.warmGray : PALETTE.greenGray, 0.12),
    )
    addInkOutline(ring, INK_WEIGHT.arena)
    group.add(ring)
  }
  const rim = new THREE.Mesh(
    ringGeometry(radius + 9.6, radius + 10.9, WALL_HEIGHT + 6.6),
    makeToonMaterial(PALETTE.warmGray, 0.1),
  )
  addInkOutline(rim, INK_WEIGHT.arena)
  group.add(rim)

  // instanced crowd: little blocky spectators scattered over the tiers
  const CROWD = 400
  const crowdGeo = new THREE.BoxGeometry(0.55, 0.75, 0.45)
  crowdGeo.translate(0, 0.375, 0)
  const crowdMat = makeToonMaterial(0xffffff, 0.5)
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, CROWD)
  crowd.frustumCulled = false
  const crowdColors = [
    PALETTE.teamRed,
    PALETTE.teamBlue,
    PALETTE.teamYellow,
    PALETTE.teamGreen,
    PALETTE.teamViolet,
    PALETTE.teamOrange,
    PALETTE.offWhite,
    PALETTE.uiGold,
    PALETTE.horizonCream,
  ]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const color = new THREE.Color()
  for (let i = 0; i < CROWD; i++) {
    const tier = tierTops[Math.floor(Math.random() * tierTops.length)]!
    const a = Math.random() * Math.PI * 2
    const r = tier.inner + 0.6 + Math.random() * (tier.outer - tier.inner - 1.2)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    q.setFromAxisAngle(up, yawTowardCenter(x, z) + (Math.random() - 0.5) * 0.5)
    const s = 0.8 + Math.random() * 0.45
    m.compose(new THREE.Vector3(x, tier.top, z), q, new THREE.Vector3(s, s * (0.85 + Math.random() * 0.3), s))
    crowd.setMatrixAt(i, m)
    color.setHex(crowdColors[Math.floor(Math.random() * crowdColors.length)]!)
    crowd.setColorAt(i, color)
  }
  crowd.instanceMatrix.needsUpdate = true
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true
  group.add(crowd)

  // floating dream island: tapered rock mass under the floor
  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.02, radius * 0.28, 9, 24),
    makeToonMaterial(PALETTE.greenGray, 0.15),
  )
  island.position.y = -5.1
  addInkOutline(island, INK_WEIGHT.arena)
  group.add(island)

  // neutral center disc + its painted ring outline (radius never changes)
  const neutralRadius = radius * 0.15
  const disc = new THREE.Mesh(new THREE.CircleGeometry(neutralRadius, 40), makeToonMaterial(PALETTE.offWhite, 3))
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.05
  group.add(disc)
  const inkLine = () =>
    new THREE.MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.5, depthWrite: false })
  const neutralRing = new THREE.Mesh(
    sectorGeometry(neutralRadius - 0.12, neutralRadius + 0.18, 0, Math.PI * 2, 56),
    inkLine(),
  )
  neutralRing.position.y = 0.06
  group.add(neutralRing)

  // scatter tick/pebble decals (trait 2.2)
  decalTex ??= tickDecalTexture()
  const decalMat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false })
  for (let i = 0; i < 26; i++) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), decalMat)
    const a = Math.random() * Math.PI * 2
    const r = neutralRadius + 2 + Math.random() * (radius - neutralRadius - 5)
    decal.position.set(Math.cos(a) * r, 0.07, Math.sin(a) * r)
    decal.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2)
    group.add(decal)
  }

  // --- the morphing zone layer -------------------------------------------------

  const zonesGroup = new THREE.Group()
  group.add(zonesGroup)
  let wedgeMats: THREE.MeshBasicMaterial[] = []

  function buildCannon(angle: number, zoneColor: number): THREE.Group {
    const cannon = new THREE.Group()
    const px = Math.cos(angle) * (radius + 0.9)
    const pz = Math.sin(angle) * (radius + 0.9)
    cannon.position.set(px, WALL_HEIGHT, pz)
    cannon.rotation.y = yawTowardCenter(px, pz) // local +Z aims at the center

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.4), makeToonMaterial(PALETTE.ink, 0.5))
    base.position.y = 0.45
    addInkOutline(base, INK_WEIGHT.prop)
    cannon.add(base)

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.6, 2.6, 12), makeToonMaterial(PALETTE.ink, 0.5))
    barrel.geometry.translate(0, 1.0, 0) // pivot at the breech
    barrel.position.set(0, 0.8, 0.1)
    barrel.rotation.x = 0.92 // tip the muzzle up-and-inward over the wall
    addInkOutline(barrel, INK_WEIGHT.prop)
    cannon.add(barrel)

    // the seat's colors on a muzzle band
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.42, 12), makeToonMaterial(zoneColor, 0.5))
    band.position.y = 2.05
    barrel.add(band)
    return cannon
  }

  return {
    group,

    setZones(arena: Arena, zoneColors: readonly number[]): void {
      clearGroup(zonesGroup)
      wedgeMats = []
      const n = arena.seats
      const half = Math.PI / n

      for (let zone = 0; zone < n; zone++) {
        const center = arena.zoneAngles[zone] ?? 0
        const zoneColor = zoneColors[zone] ?? PALETTE.warmGray

        // translucent wedge tint (danger heat lives here)
        const mat = new THREE.MeshBasicMaterial({
          color: zoneColor,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
        })
        wedgeMats.push(mat)
        const wedge = new THREE.Mesh(
          sectorGeometry(arena.neutralRadius + 0.4, radius * 0.985, center - half + 0.015, center + half - 0.015),
          mat,
        )
        wedge.position.y = 0.035
        zonesGroup.add(wedge)

        // painted division line on the zone's leading boundary
        const line = new THREE.Mesh(stripGeometry(arena.neutralRadius + 0.1, radius - 0.25, 0.34), inkLine())
        line.rotation.y = -(center + half)
        line.position.y = 0.06
        zonesGroup.add(line)

        // the cannon on the wall crown, wearing the seat's color
        zonesGroup.add(buildCannon(center, zoneColor))
      }
    },

    setDanger(fracs: readonly number[]): void {
      for (let zone = 0; zone < wedgeMats.length; zone++) {
        wedgeMats[zone]!.opacity = 0.08 + Math.min(1, fracs[zone] ?? 0) * 0.3
      }
    },

    dispose(): void {
      disposeHierarchy(group)
    },
  }
}
