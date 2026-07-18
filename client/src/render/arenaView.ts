import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { WALL_HEIGHT } from '@shared/constants.ts'
import type { Arena } from '@shared/sim/arena.ts'
import { yawTowardCenter } from '@shared/sim/arena.ts'
import { KITS } from '@shared/cosmetics/jerseys.ts'
import { createGrassField, type GrassBody, type GrassField, type GustCell } from './grass.ts'
import { createDayNight, type DayNight } from './dayNight.ts'
import { createWindField, type WindField } from './windField.ts'
import { createWindStreaks, type StreakCell, type WindStreaks } from './windStreaks.ts'
import { createWindMarks, type WindMark, type WindMarks } from './windMarks.ts'
import { addInkOutline, disposeHierarchy, INK_WEIGHT, makeToonMaterial } from './materials.ts'
import { PALETTE } from './palette.ts'

/**
 * THE colosseum (M5): one permanent round stadium — grass pitch, seamless
 * ring wall, five audience tiers packed with instanced BEAN spectators in
 * team jerseys, pennant flags, floating-island underside. Built ONCE.
 * Zone morphs are uniform writes on the grass shader (chalk lines, danger
 * heat) + a cannon rebuild + a crowd recolor — no geometry churn.
 */

/** the scene lighting the day->night arc drives (owned by main.ts). */
export interface WorldLighting {
  scene: THREE.Scene
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  sky: THREE.Mesh
}

export interface ArenaView {
  readonly group: THREE.Group
  /** repaint the floor divisions + cannons + home-fan sections */
  setZones(arena: Arena, zoneColors: readonly number[]): void
  /** survivor count → target of the day->night arc (full night at <=3) */
  setSurvivors(survivors: number): void
  /** debug: force full night on/off, overriding the survivor-driven arc */
  debugForceNight(on: boolean): void
  /** meterFrac per zone [0..1] heats that wedge's grass */
  setDanger(fracs: readonly number[]): void
  /** blink one zone red (ball in your own wedge); zone=-1 off, pulse 0..1 */
  setAlarm(zone: number, pulse: number): void
  /** bodies (players + ball) that flatten/part the grass this frame */
  setGrassBodies(bodies: readonly GrassBody[]): void
  /** advance the wind field, grass, and streaks (self-driven gust cells) */
  update(dt: number): void
  /** the current wind direction (from the field) for marks + airborne visuals */
  windDir(): { x: number; z: number }
  /** direction lines beside bodies the wind is currently pushing */
  setWindMarks(marks: readonly WindMark[], windX: number, windZ: number): void
  dispose(): void
}

const SEGMENTS = 64
const TIERS = 5

/** A fully-configured tiling ground texture from an ALREADY-painted canvas.
 *  Built atomically (fresh CanvasTexture, needsUpdate implicit) so it never
 *  races a partially-drawn canvas against the GPU upload. */
function makeGroundTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(10, 10)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
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

/** The spectator bean: the player silhouette (torso stack + arms), merged. */
function crowdBeanGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const rows: ReadonlyArray<readonly [number, number]> = [
    [0.88, 0.22],
    [0.86, 0.26],
    [0.76, 0.26],
    [0.58, 0.2],
  ]
  let y = 0.46
  for (const [rw, rh] of rows) {
    const box = new THREE.BoxGeometry(rw, rh, rw * 0.8)
    box.translate(0, y + rh / 2, 0)
    parts.push(box)
    y += rh
  }
  for (const side of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.16, 0.44, 0.2)
    arm.translate(side * 0.52, 0.78, 0)
    parts.push(arm)
  }
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  return merged
}

/** Cream face plate with two ink eyes, baked into one little texture. */
function crowdFaceTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  ctx.fillStyle = '#fbf6e8'
  ctx.fillRect(4, 8, size - 8, size - 16)
  ctx.fillStyle = '#1c1a18'
  ctx.fillRect(size * 0.3 - 3, size * 0.32, 7, 18)
  ctx.fillRect(size * 0.7 - 3, size * 0.32, 7, 18)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** every kit colorway a fan could wear */
const FAN_COLORS: readonly number[] = [
  ...KITS.flatMap((kit) => [kit.home.primary, kit.away.primary]),
  PALETTE.offWhite,
  PALETTE.uiGold,
]

export function createArenaView(radius = 28, lighting?: WorldLighting): ArenaView {
  const group = new THREE.Group()
  const neutralRadius = radius * 0.15

  // --- the permanent building --------------------------------------------------

  // floor slab: the user's grass_02 tile as ground fill between the 3D
  // blades. Its luminance is remapped onto the EXACT blade palette at load
  // (grassBase -> grassTip) and rendered UNLIT like the blades, so ground
  // and blades can never drift apart in color.
  // placeholder tile — dark strokes on a DEEP base (never bright grassBase):
  // this is what shows for the split-second before the remapped PNG arrives,
  // so a slow load can never flash a bright untextured floor.
  const placeholder = document.createElement('canvas')
  placeholder.width = placeholder.height = 64
  {
    const seed = placeholder.getContext('2d')
    if (seed) {
      seed.fillStyle = `#${new THREE.Color(PALETTE.grassBase).multiplyScalar(0.72).getHexString()}`
      seed.fillRect(0, 0, 64, 64)
      seed.strokeStyle = `#${PALETTE.grassBase.toString(16).padStart(6, '0')}`
      seed.lineCap = 'round'
      for (let i = 0; i < 70; i++) {
        seed.globalAlpha = 0.3 + Math.random() * 0.3
        seed.lineWidth = 1 + Math.random()
        const x = Math.random() * 64
        const y = Math.random() * 64
        seed.beginPath()
        seed.moveTo(x, y)
        seed.lineTo(x + (Math.random() - 0.5) * 5, y - 3 - Math.random() * 4)
        seed.stroke()
      }
      seed.globalAlpha = 1
    }
  }
  const floorTopMat = new THREE.MeshBasicMaterial({ map: makeGroundTexture(placeholder) })
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.6, SEGMENTS), [
    makeToonMaterial(PALETTE.warmGray), // side
    floorTopMat, // top: unlit, like the blades
    makeToonMaterial(PALETTE.warmGray), // bottom
  ])

  // load + remap the real tile off-thread; swap the map in ATOMICALLY once the
  // remapped canvas is fully painted. The old code mutated a live canvas and
  // flipped needsUpdate, which raced the GPU upload — sometimes the bright
  // placeholder won and stuck. Building a detached canvas first kills the race.
  {
    const img = new Image()
    img.onload = () => {
      const s = img.width
      const off = document.createElement('canvas')
      off.width = off.height = s
      const ctx = off.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      const id = ctx.getImageData(0, 0, s, s)
      const d = id.data
      // EXACT approved remap — absolute min/max luminance of the ORIGINAL PNG.
      // Never feed this a lossy re-encode (JPEG ringing shifts the bounds and
      // washes the pitch out) and never touch these constants — see PROGRESS.
      let lo = 1
      let hi = 0
      for (let i = 0; i < s * s; i++) {
        const lum = (d[i * 4]! + d[i * 4 + 1]! + d[i * 4 + 2]!) / 765
        if (lum < lo) lo = lum
        if (lum > hi) hi = lum
      }
      // GROUND_DARKEN uniformly deepens the finished tile (1 = neutral).
      // This is the ONE knob for "make the ground darker/lighter."
      const GROUND_DARKEN = 0.88
      const base = new THREE.Color(PALETTE.grassBase).multiplyScalar(0.85)
      const tip = new THREE.Color(PALETTE.grassTip)
      const span = Math.max(0.01, hi - lo)
      for (let i = 0; i < s * s; i++) {
        const lum = (d[i * 4]! + d[i * 4 + 1]! + d[i * 4 + 2]!) / 765
        const t = Math.pow((lum - lo) / span, 1.2) * 0.9
        d[i * 4] = Math.round((base.r + (tip.r - base.r) * t) * 255 * GROUND_DARKEN)
        d[i * 4 + 1] = Math.round((base.g + (tip.g - base.g) * t) * 255 * GROUND_DARKEN)
        d[i * 4 + 2] = Math.round((base.b + (tip.b - base.b) * t) * 255 * GROUND_DARKEN)
      }
      ctx.putImageData(id, 0, 0)
      // canvas is fully painted NOW — build a fresh texture from it and swap.
      const old = floorTopMat.map
      floorTopMat.map = makeGroundTexture(off)
      floorTopMat.needsUpdate = true
      old?.dispose()
    }
    img.src = '/textures/pitch_grass.png'
  }
  floor.position.y = -0.3
  addInkOutline(floor, INK_WEIGHT.arena)
  group.add(floor)

  // ground wash only — NO chalk lines here (the blade shader draws the only
  // lines; a second ground copy read as doubled strokes). Just the pale
  // neutral disc and faint mow bands, which sit under the blade versions.
  const washCanvas = document.createElement('canvas')
  washCanvas.width = washCanvas.height = 512
  const washCtx = washCanvas.getContext('2d')
  if (washCtx) {
    const S = 512
    const c = S / 2
    const pxm = S / (radius * 2)
    washCtx.fillStyle = 'rgba(240, 236, 220, 0.32)'
    washCtx.beginPath()
    washCtx.arc(c, c, neutralRadius * pxm, 0, Math.PI * 2)
    washCtx.fill()
    washCtx.fillStyle = 'rgba(255, 255, 255, 0.05)'
    for (let r0 = 2.4; r0 < radius; r0 += 4.8) {
      washCtx.beginPath()
      washCtx.arc(c, c, Math.min(radius, r0 + 2.4) * pxm, 0, Math.PI * 2)
      washCtx.arc(c, c, r0 * pxm, 0, Math.PI * 2, true)
      washCtx.fill()
    }
  }
  const washTex = new THREE.CanvasTexture(washCanvas)
  washTex.colorSpace = THREE.SRGBColorSpace
  const wash = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.995, SEGMENTS),
    new THREE.MeshBasicMaterial({ map: washTex, transparent: true, depthWrite: false }),
  )
  wash.rotation.x = -Math.PI / 2
  wash.position.y = 0.045
  group.add(wash)

  // THE PITCH — instanced stadium grass; zones/chalk/danger live in its shader
  const grass = createGrassField(radius, neutralRadius)
  group.add(grass.mesh)

  // day -> night arc: eases the sun/hemi/fog/sky + the unlit grass toward
  // night as survivors thin out (full night at 3). Null in contexts that
  // didn't pass scene lighting (kept working for older call sites).
  const dayNight: DayNight | null = lighting
    ? createDayNight(lighting.scene, lighting.sun, lighting.hemi, lighting.sky, grass)
    : null

  // wind: localized travelling GUST CELLS drive both the grass bend and the
  // streaks, so gusts appear in small areas, whiz past, and disappear
  const windField: WindField = createWindField()
  const streaks: WindStreaks = createWindStreaks()
  group.add(streaks.mesh)
  // direction lines that appear beside bodies the wind is pushing
  const marks: WindMarks = createWindMarks()
  group.add(marks.mesh)
  // reused per-frame scratch so the hot path never allocates
  const gustScratch: GustCell[] = []
  const streakScratch: StreakCell[] = []

  // seamless ring wall the players bounce off
  const wall = new THREE.Mesh(ringGeometry(radius, radius + 1.8, WALL_HEIGHT), makeToonMaterial(PALETTE.warmGray))
  addInkOutline(wall, INK_WEIGHT.arena)
  group.add(wall)

  // five stepped audience tiers, each with a parapet lip, + a tall outer rim
  const tierTops: Array<{ inner: number; outer: number; top: number }> = []
  for (let tier = 0; tier < TIERS; tier++) {
    const inner = radius + 1.8 + tier * 2.5
    const outer = inner + 2.5
    const top = WALL_HEIGHT + 1.0 + tier * 1.35
    tierTops.push({ inner, outer, top })
    const ring = new THREE.Mesh(
      ringGeometry(inner, outer, top),
      makeToonMaterial(tier % 2 === 0 ? PALETTE.warmGray : PALETTE.greenGray),
    )
    addInkOutline(ring, INK_WEIGHT.arena)
    group.add(ring)
    const parapet = new THREE.Mesh(ringGeometry(inner, inner + 0.35, top + 0.55), makeToonMaterial(PALETTE.greenGray))
    group.add(parapet)
  }
  const rimInner = radius + 1.8 + TIERS * 2.5
  const rimTop = WALL_HEIGHT + 1.0 + TIERS * 1.35 + 1.9
  const rim = new THREE.Mesh(ringGeometry(rimInner, rimInner + 1.3, rimTop), makeToonMaterial(PALETTE.warmGray))
  addInkOutline(rim, INK_WEIGHT.arena)
  group.add(rim)

  // pennant flags around the crown
  const FLAGS = 20
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6)
  poleGeo.translate(0, 1.3, 0)
  const poles = new THREE.InstancedMesh(poleGeo, makeToonMaterial(PALETTE.ink), FLAGS)
  const flagGeo = new THREE.BufferGeometry()
  flagGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 2.5, 0, 0, 1.9, 0, 1.15, 2.2, 0], 3),
  )
  flagGeo.setIndex([0, 1, 2])
  flagGeo.computeVertexNormals()
  const flags = new THREE.InstancedMesh(
    flagGeo,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    FLAGS,
  )
  poles.frustumCulled = flags.frustumCulled = false
  {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const color = new THREE.Color()
    for (let i = 0; i < FLAGS; i++) {
      const a = ((i + 0.5) / FLAGS) * Math.PI * 2
      const x = Math.cos(a) * (rimInner + 0.65)
      const z = Math.sin(a) * (rimInner + 0.65)
      q.setFromAxisAngle(up, yawTowardCenter(x, z) + Math.PI / 2)
      m.compose(new THREE.Vector3(x, rimTop, z), q, new THREE.Vector3(1, 1, 1))
      poles.setMatrixAt(i, m)
      flags.setMatrixAt(i, m)
      color.setHex(FAN_COLORS[i % FAN_COLORS.length]!)
      flags.setColorAt(i, color)
    }
    poles.instanceMatrix.needsUpdate = true
    flags.instanceMatrix.needsUpdate = true
    if (flags.instanceColor) flags.instanceColor.needsUpdate = true
  }
  group.add(poles, flags)

  // --- the crowd: BEAN spectators in team jerseys ------------------------------
  // placement first, then two instanced draws sharing transforms (body + face)
  const placements: Array<{ x: number; z: number; y: number; yaw: number; s: number; angle: number; pick: number }> = []
  for (const tier of tierTops) {
    const r = (tier.inner + tier.outer) / 2
    const count = Math.floor((Math.PI * 2 * r) / 1.05)
    for (let i = 0; i < count; i++) {
      if (Math.random() > 0.85) continue // empty seats read organic
      const a = ((i + Math.random() * 0.55) / count) * Math.PI * 2
      const x = Math.cos(a) * (r + (Math.random() - 0.5) * 1.3)
      const z = Math.sin(a) * (r + (Math.random() - 0.5) * 1.3)
      placements.push({
        x,
        z,
        y: tier.top,
        yaw: yawTowardCenter(x, z) + (Math.random() - 0.5) * 0.45,
        s: 0.82 + Math.random() * 0.4,
        angle: (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2),
        pick: Math.random(),
      })
    }
  }
  const crowdCount = placements.length
  const crowdBody = new THREE.InstancedMesh(crowdBeanGeometry(), makeToonMaterial(0xffffff), crowdCount)
  const faceGeo = new THREE.PlaneGeometry(0.5, 0.42)
  faceGeo.translate(0, 0.98, 0.36)
  const crowdFace = new THREE.InstancedMesh(
    faceGeo,
    new THREE.MeshBasicMaterial({ map: crowdFaceTexture(), transparent: true }),
    crowdCount,
  )
  crowdBody.frustumCulled = crowdFace.frustumCulled = false
  {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < crowdCount; i++) {
      const p = placements[i]!
      q.setFromAxisAngle(up, p.yaw)
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s, p.s))
      crowdBody.setMatrixAt(i, m)
      crowdFace.setMatrixAt(i, m)
    }
    crowdBody.instanceMatrix.needsUpdate = true
    crowdFace.instanceMatrix.needsUpdate = true
  }
  const crowdColor = new THREE.Color()
  function recolorCrowd(zoneCount: number, zoneColors: readonly number[]): void {
    const span = (Math.PI * 2) / Math.max(2, zoneCount)
    for (let i = 0; i < crowdCount; i++) {
      const p = placements[i]!
      const zone = Math.floor(((p.angle + span / 2) % (Math.PI * 2)) / span) % Math.max(2, zoneCount)
      const home = zoneColors[zone]
      // each wedge's stands fill with that seat's supporters, plus neutrals
      if (home !== undefined && p.pick < 0.62) crowdColor.setHex(home)
      else crowdColor.setHex(FAN_COLORS[Math.floor(p.pick * 997) % FAN_COLORS.length]!)
      crowdBody.setColorAt(i, crowdColor)
    }
    if (crowdBody.instanceColor) crowdBody.instanceColor.needsUpdate = true
  }
  recolorCrowd(6, []) // pre-match: everyone in random team colors
  group.add(crowdBody, crowdFace)

  // floating dream island: tapered rock mass under the floor
  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.02, radius * 0.28, 9, 24),
    makeToonMaterial(PALETTE.greenGray),
  )
  island.position.y = -5.1
  addInkOutline(island, INK_WEIGHT.arena)
  group.add(island)

  // --- the morphing layer: just the cannons ------------------------------------

  const cannonsGroup = new THREE.Group()
  group.add(cannonsGroup)

  function buildCannon(angle: number, zoneColor: number): THREE.Group {
    const cannon = new THREE.Group()
    const px = Math.cos(angle) * (radius + 0.9)
    const pz = Math.sin(angle) * (radius + 0.9)
    cannon.position.set(px, WALL_HEIGHT, pz)
    cannon.rotation.y = yawTowardCenter(px, pz) // local +Z aims at the center

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.4), makeToonMaterial(PALETTE.ink))
    base.position.y = 0.45
    addInkOutline(base, INK_WEIGHT.prop)
    cannon.add(base)

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.6, 2.6, 12), makeToonMaterial(PALETTE.ink))
    barrel.geometry.translate(0, 1.0, 0) // pivot at the breech
    barrel.position.set(0, 0.8, 0.1)
    barrel.rotation.x = 0.92 // tip the muzzle up-and-inward over the wall
    addInkOutline(barrel, INK_WEIGHT.prop)
    cannon.add(barrel)

    // the seat's colors on a muzzle band
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.42, 12), makeToonMaterial(zoneColor))
    band.position.y = 2.05
    barrel.add(band)
    return cannon
  }

  let elapsed = 0
  let forceNight = false // debug override of the survivor-driven arc

  return {
    group,

    setZones(arena: Arena, zoneColors: readonly number[]): void {
      grass.setZones(arena.seats, zoneColors)
      recolorCrowd(arena.seats, zoneColors)
      disposeHierarchy(cannonsGroup)
      cannonsGroup.clear()
      for (let zone = 0; zone < arena.seats; zone++) {
        cannonsGroup.add(buildCannon(arena.zoneAngles[zone] ?? 0, zoneColors[zone] ?? PALETTE.warmGray))
      }
    },

    setSurvivors(survivors: number): void {
      if (!forceNight) dayNight?.setSurvivors(survivors)
    },

    debugForceNight(on: boolean): void {
      forceNight = on
      dayNight?.setTarget(on ? 1 : 0)
    },

    setDanger(fracs: readonly number[]): void {
      grass.setDanger(fracs)
    },

    setAlarm(zone: number, pulse: number): void {
      grass.setAlarm(zone, pulse)
    },

    setGrassBodies(list: readonly GrassBody[]): void {
      grass.setBodies(list)
    },

    update(dt: number): void {
      elapsed += dt
      dayNight?.update(dt)
      const cells = windField.step(dt)
      const dx = windField.dirX
      const dz = windField.dirZ
      // hand the live gust cells to grass (bend) and streaks (clusters).
      // each cell carries its OWN travel direction (curved arc around the bowl)
      gustScratch.length = 0
      streakScratch.length = 0
      for (const c of cells) {
        gustScratch.push({ x: c.x, z: c.z, radius: c.radius, strength: c.strength, dirX: c.dirX, dirZ: c.dirZ })
        streakScratch.push({ x: c.x, z: c.z, strength: c.strength, dirX: c.dirX, dirZ: c.dirZ })
      }
      grass.setGusts(gustScratch)
      grass.update(elapsed, dx, dz)
      streaks.update(dt, streakScratch, dx, dz)
    },

    windDir(): { x: number; z: number } {
      return { x: windField.dirX, z: windField.dirZ }
    },

    setWindMarks(list: readonly WindMark[], windX: number, windZ: number): void {
      marks.set(list, windX, windZ, elapsed)
    },

    dispose(): void {
      grass.dispose()
      streaks.dispose()
      marks.dispose()
      disposeHierarchy(group)
    },
  }
}
