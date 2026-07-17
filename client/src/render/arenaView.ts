import * as THREE from 'three'
import { WALL_HEIGHT } from '@shared/constants.ts'
import type { Arena } from '@shared/sim/arena.ts'
import { addInkOutline, disposeHierarchy, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'
import { tickDecalTexture } from './textures.ts'

/**
 * One arena shape: seamless N-gon floor + ONE watertight extruded ring wall
 * (no per-segment boxes, no gaps — M1 feedback), neutral disc, per-zone wedge
 * tints, scatter decals. Built at morph time (during the pause) and fully
 * disposed on replacement.
 *
 * Colosseum note (M5): tiered audience seating rings on top of this wall,
 * cannons mounted on the wall crown above each wedge.
 */

export interface ArenaView {
  readonly group: THREE.Group
  /** meterFrac per zone [0..1] tints wedges hotter as danger rises */
  setDanger(fracs: readonly number[]): void
  dispose(): void
}

/** Flat XZ ring-sector fan between two radii across an angle span. */
function sectorGeometry(inner: number, outer: number, a0: number, a1: number, segments = 12): THREE.BufferGeometry {
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

/**
 * One watertight ring wall: an N-gon ring shape (outer polygon with an inner
 * polygon hole) extruded upward. Single mesh, single ink hull — zero seams.
 * Corners of both polygons sit at the floor's own corner angles.
 */
function ringWallGeometry(arena: Arena, thickness: number): THREE.ExtrudeGeometry {
  const n = arena.circle ? 48 : arena.seats
  const cornerAngle = (i: number): number => ((i + 0.5) / n) * Math.PI * 2
  const innerCorner = arena.radius / (arena.circle ? 1 : 1) // circumradius: corners ON the floor edge
  const outerCorner = innerCorner + thickness

  const shape = new THREE.Shape()
  for (let i = 0; i < n; i++) {
    const a = cornerAngle(i)
    const x = Math.cos(a) * outerCorner
    const y = Math.sin(a) * outerCorner
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()

  const hole = new THREE.Path()
  for (let i = 0; i < n; i++) {
    const a = cornerAngle(i)
    const x = Math.cos(a) * innerCorner
    const y = Math.sin(a) * innerCorner
    if (i === 0) hole.moveTo(x, y)
    else hole.lineTo(x, y)
  }
  hole.closePath()
  shape.holes.push(hole)

  const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_HEIGHT, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2) // extrusion axis -> up
  return geo
}

let decalTex: THREE.Texture | null = null

export function createArenaView(arena: Arena, zoneColors: readonly number[]): ArenaView {
  const group = new THREE.Group()

  const floorSegments = arena.circle ? 48 : arena.seats
  const thetaOffset = Math.PI / floorSegments

  // floor slab — one seamless prism
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(arena.radius, arena.radius, 0.6, floorSegments, 1, false, thetaOffset),
    makeToonMaterial(PALETTE.groundCream, 10),
  )
  floor.position.y = -0.3
  addInkOutline(floor, INK_WEIGHT.arena)
  group.add(floor)

  // ONE watertight ring wall (extrude UVs are in meters -> fractional repeat)
  const wall = new THREE.Mesh(ringWallGeometry(arena, 1.6), makeToonMaterial(PALETTE.warmGray, 0.15))
  addInkOutline(wall, INK_WEIGHT.arena)
  group.add(wall)

  // neutral center disc — belongs to nobody (idea.md §1)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(arena.neutralRadius, 40), makeToonMaterial(PALETTE.offWhite, 3))
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.05
  group.add(disc)

  // wedge tint sectors, one per zone
  const wedgeMats: THREE.MeshBasicMaterial[] = []
  const zoneCount = arena.circle ? 2 : arena.seats
  const half = Math.PI / zoneCount
  for (let zone = 0; zone < zoneCount; zone++) {
    const center = arena.circle ? (zone === 0 ? 0 : Math.PI) : (arena.wallAngles[zone] ?? 0)
    const geo = sectorGeometry(arena.neutralRadius + 0.4, arena.apothem * 0.985, center - half + 0.015, center + half - 0.015, 16)
    const mat = new THREE.MeshBasicMaterial({
      color: zoneColors[zone] ?? PALETTE.warmGray,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    })
    wedgeMats.push(mat)
    const wedge = new THREE.Mesh(geo, mat)
    wedge.position.y = 0.035
    group.add(wedge)
  }

  // scatter tick/pebble decals (trait 2.2)
  decalTex ??= tickDecalTexture()
  const decalMat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false })
  for (let i = 0; i < 22; i++) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), decalMat)
    const a = Math.random() * Math.PI * 2
    const r = arena.neutralRadius + 2 + Math.random() * (arena.apothem - arena.neutralRadius - 4)
    decal.position.set(Math.cos(a) * r, 0.07, Math.sin(a) * r)
    decal.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2)
    group.add(decal)
  }

  return {
    group,
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
