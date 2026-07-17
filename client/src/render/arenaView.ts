import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { WALL_HEIGHT } from '@shared/constants.ts'
import type { Arena } from '@shared/sim/arena.ts'
import { addInkOutline, disposeHierarchy, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'
import { tickDecalTexture } from './textures.ts'

/**
 * Builds one arena shape: N-gon floor, walls, neutral disc, per-zone wedge
 * tint sectors, scatter decals. Built at morph time (during the pause) and
 * fully disposed on replacement — geometry never changes mid-play.
 */

export interface ArenaView {
  readonly group: THREE.Group
  /** meterFrac per zone [0..1] tints wedges hotter as danger rises */
  setDanger(fracs: readonly number[]): void
  dispose(): void
}

/** Flat XZ ring-sector fan between two radii across an angle span. */
function sectorGeometry(inner: number, outer: number, a0: number, a1: number, segments = 10): THREE.BufferGeometry {
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
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

let decalTex: THREE.Texture | null = null

export function createArenaView(arena: Arena, zoneColors: readonly number[]): ArenaView {
  const group = new THREE.Group()
  const disposables: Array<{ dispose(): void }> = []
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d)
    return d
  }

  const wallSegments = arena.circle ? 24 : arena.seats
  const floorRadialSegments = arena.circle ? 48 : arena.seats
  const thetaOffset = arena.circle ? 0 : Math.PI / arena.seats

  // floor slab — polygon prism (or cylinder for the duel circle)
  const floorGeo = track(new THREE.CylinderGeometry(arena.radius, arena.radius, 0.5, floorRadialSegments, 1, false, thetaOffset))
  const floor = new THREE.Mesh(floorGeo, makeToonMaterial(PALETTE.groundCream))
  floor.position.y = -0.25
  addInkOutline(floor, INK_WEIGHT.arena)
  group.add(floor)

  // walls: boxes along each side (circle fakes roundness with 24 segments)
  const wallParts: THREE.BufferGeometry[] = []
  const segAngle = (Math.PI * 2) / wallSegments
  const segApothem = arena.circle ? arena.radius * Math.cos(segAngle / 2) : arena.apothem
  const segLength = 2 * arena.radius * Math.sin(segAngle / 2)
  for (let i = 0; i < wallSegments; i++) {
    const a = i * segAngle
    const box = new THREE.BoxGeometry(0.35, WALL_HEIGHT, segLength * 1.02)
    box.rotateY(-a)
    box.translate(Math.cos(a) * (segApothem + 0.175), WALL_HEIGHT / 2, Math.sin(a) * (segApothem + 0.175))
    wallParts.push(box)
  }
  const wallsGeo = track(mergeGeometries(wallParts))
  for (const part of wallParts) part.dispose()
  const walls = new THREE.Mesh(wallsGeo, makeToonMaterial(PALETTE.warmGray))
  addInkOutline(walls, INK_WEIGHT.arena)
  group.add(walls)

  // neutral center disc — belongs to nobody (idea.md §1)
  const disc = new THREE.Mesh(track(new THREE.CircleGeometry(arena.neutralRadius, 32)), makeToonMaterial(PALETTE.offWhite))
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.02
  group.add(disc)

  // wedge tint sectors, one per zone
  const wedgeMats: THREE.MeshBasicMaterial[] = []
  const zoneCount = arena.circle ? 2 : arena.seats
  const half = Math.PI / zoneCount
  for (let zone = 0; zone < zoneCount; zone++) {
    const center = arena.circle ? (zone === 0 ? 0 : Math.PI) : (arena.wallAngles[zone] ?? 0)
    const geo = track(sectorGeometry(arena.neutralRadius + 0.15, arena.apothem * 0.97, center - half + 0.02, center + half - 0.02))
    const mat = track(
      new THREE.MeshBasicMaterial({
        color: zoneColors[zone] ?? PALETTE.warmGray,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    )
    wedgeMats.push(mat)
    const wedge = new THREE.Mesh(geo, mat)
    wedge.position.y = 0.011
    group.add(wedge)
  }

  // scatter tick/pebble decals (trait 2.2)
  decalTex ??= tickDecalTexture()
  const decalMat = track(new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false }))
  for (let i = 0; i < 8; i++) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), decalMat)
    const a = Math.random() * Math.PI * 2
    const r = arena.neutralRadius + 0.8 + Math.random() * (arena.apothem - arena.neutralRadius - 1.6)
    decal.position.set(Math.cos(a) * r, 0.012, Math.sin(a) * r)
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
      for (const d of disposables) d.dispose()
    },
  }
}
