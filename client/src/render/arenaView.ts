import * as THREE from 'three'
import type { Arena } from '@shared/sim/arena.ts'
import { yawTowardCenter } from '@shared/sim/arena.ts'
import { KITS } from '@shared/cosmetics/jerseys.ts'
import { createGrassField, type GrassBody, type GrassField, type GustCell } from './grass.ts'
import { createDayNight, type DayNight } from './dayNight.ts'
import { createWindField, type WindField } from './windField.ts'
import { createWindStreaks, type StreakCell, type WindStreaks } from './windStreaks.ts'
import { createWindMarks, type WindMark, type WindMarks } from './windMarks.ts'
import { createCrowd, type CrowdSeat } from './crowd.ts'
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
  /** match progress → day->night arc target (elims done / elims-to-night) */
  setMatchProgress(survivors: number, seatsAtStart: number): void
  /** debug: force full night on/off, overriding the progress-driven arc */
  debugForceNight(on: boolean): void
  /** register the one-shot nightfall pop (future light-prop + audio bang) */
  onNightfall(cb: () => void): void
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

/** Thin net weave: a transparent tile of fine ink lines for the pitch barrier. */
function netTexture(): THREE.CanvasTexture {
  const s = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = s
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  ctx.clearRect(0, 0, s, s)
  ctx.strokeStyle = 'rgba(40,38,34,0.85)'
  ctx.lineWidth = 1.4
  const step = s / 9
  for (let i = 0; i <= 9; i++) {
    ctx.beginPath()
    ctx.moveTo(i * step, 0)
    ctx.lineTo(i * step, s)
    ctx.moveTo(0, i * step)
    ctx.lineTo(s, i * step)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(80, 5) // fine mesh around the ring, a few rows tall
  return tex
}

/** every kit colorway a fan could wear */
const FAN_COLORS: readonly number[] = [
  ...KITS.flatMap((kit) => [kit.home.primary, kit.away.primary]),
  PALETTE.offWhite,
  PALETTE.uiGold,
]

/** Stadium art-style palette — warm, colourful, in-style (no flat off-white). */
const STADIUM = {
  frame: 0xcbb489, // warm SANDY structural frame (apron/plinth/rim base)
  rail: 0x5c5346, // dark taupe rails/posts
  aisle: 0xc9bfa2, // walkway strips (toned down from bright off-white)
  // seat-block tones cycled up the rake: teal/coral/butter/sage/rose/sky bands
  seatTones: [0x6fb2ac, 0xe08a6e, 0xf0c97a, 0x8bb87e, 0xd98f8f, 0x6f9ec2],
} as const

interface FlagField {
  group: THREE.Group
  update(t: number): void
}

/** A ring of WAVING team flags on poles around the rim, waved in the vertex
 *  shader (one instanced draw, one uniform/frame — no CPU cost). */
function createFlags(ringR: number, baseY: number): FlagField {
  const group = new THREE.Group()
  const N = 24
  // poles
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 4.2, 6)
  poleGeo.translate(0, 2.1, 0)
  const poles = new THREE.InstancedMesh(poleGeo, makeToonMaterial(PALETTE.ink), N)
  poles.frustumCulled = false

  // flag cloth: a small grid so the shader can ripple it
  const COLS = 8
  const ROWS = 5
  const flagGeo = new THREE.PlaneGeometry(1.7, 1.05, COLS, ROWS)
  flagGeo.translate(0.85, 3.4, 0) // hang from the top of the pole, extend +x
  const flagMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;
      varying vec3 vColor;
      uniform float uTime;
      void main() {
        vColor = aColor;
        vec3 p = position;
        // ripple grows toward the free (outer) edge of the flag
        float edge = clamp((position.x - 0.0) / 1.7, 0.0, 1.0);
        float w = sin(position.x * 3.5 - uTime * 6.0 + aPhase) * 0.22
                + sin(position.y * 4.0 + uTime * 4.0 + aPhase) * 0.1;
        p.z += w * edge;
        p.y += w * 0.25 * edge;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec3 vColor;
      void main() { gl_FragColor = vec4(vColor, 1.0); }
    `,
  })
  const flags = new THREE.InstancedMesh(flagGeo, flagMat, N)
  flags.frustumCulled = false

  const instColor = new Float32Array(N * 3)
  const instPhase = new Float32Array(N)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const col = new THREE.Color()
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const x = Math.cos(a) * ringR
    const z = Math.sin(a) * ringR
    q.setFromAxisAngle(up, yawTowardCenter(x, z) + Math.PI / 2)
    m.compose(new THREE.Vector3(x, baseY, z), q, new THREE.Vector3(1, 1, 1))
    poles.setMatrixAt(i, m)
    flags.setMatrixAt(i, m)
    col.setHex(FAN_COLORS[i % FAN_COLORS.length]!)
    instColor[i * 3] = col.r
    instColor[i * 3 + 1] = col.g
    instColor[i * 3 + 2] = col.b
    instPhase[i] = (i * 1.7) % 6.28
  }
  poles.instanceMatrix.needsUpdate = true
  flags.instanceMatrix.needsUpdate = true
  // wire the per-instance color/phase as instanced attributes the shader reads
  flagGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(instColor, 3))
  flagGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(instPhase, 1))
  group.add(poles, flags)

  return {
    group,
    update(t: number): void {
      flagMat.uniforms.uTime!.value = t
    },
  }
}

/** A tall floodlight tower: pole + a lamp bank of little bright cells + a soft
 *  beam sprite. Static geometry (cheap); the lamps brighten at night via the
 *  material already reacting to the scene light. */
function buildLightTower(x: number, z: number, baseY: number): THREE.Group {
  const tower = new THREE.Group()
  tower.position.set(x, baseY, z)
  tower.rotation.y = yawTowardCenter(x, z)

  const H = 22
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, H, 8), makeToonMaterial(PALETTE.ink))
  pole.geometry.translate(0, H / 2, 0)
  pole.castShadow = true
  addInkOutline(pole, INK_WEIGHT.prop)
  tower.add(pole)

  // lamp bank head: a boxy panel of bright cells tilted toward the pitch
  const head = new THREE.Group()
  head.position.set(0, H, 0.3)
  head.rotation.x = 0.5
  const backing = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.4, 0.4), makeToonMaterial(PALETTE.ink))
  addInkOutline(backing, INK_WEIGHT.prop)
  head.add(backing)
  const lampGeo = new THREE.CircleGeometry(0.36, 10)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3c8 }) // always-bright bulbs
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 12)
  const lm = new THREE.Matrix4()
  let k = 0
  for (let ry = 0; ry < 3; ry++) {
    for (let rx = 0; rx < 4; rx++) {
      lm.makeTranslation(-1.5 + rx * 1.0, -0.8 + ry * 0.8, 0.22)
      lamps.setMatrixAt(k++, lm)
    }
  }
  lamps.instanceMatrix.needsUpdate = true
  head.add(lamps)
  tower.add(head)
  return tower
}

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

  // day -> night arc: a visible sun arcs across the sky and eases the light,
  // hemi, fog, sky, the unlit grass, and the unlit GROUND toward night as the
  // match progresses. Passes floorTopMat so night can multiply the (fine-tuned,
  // bright) ground texture DOWN so it stops glowing — only the color multiplier
  // is touched, never the texture or its remap. Null when no lighting passed.
  const dayNight: DayNight | null = lighting
    ? createDayNight(lighting.scene, lighting.sun, lighting.hemi, lighting.sky, grass, floorTopMat)
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

  // EVERYTHING here anchors to the GROUND (field surface = y=0), not up high.
  // Order out from the field: NET -> DISPLAY WALL -> STANDS, all sitting flush.

  // --- STANDS layout constants (used by the apron/display below too) ---------
  const STANDS_INNER = radius + 1.7 // seating starts here, right behind the display
  const ROWS = 16 // seating rows (the rake)
  const ROW_DEPTH = 0.95 // shallower tread → steeper climb, no flat track
  const ROW_RISE = 0.82 // taller riser than tread → the bowl rakes up hard
  const AISLES = 10 // radial walkways cut through the seating
  const AISLE_HALF = 0.075 // half-angular-width of each aisle
  const PLINTH_H = 1.15 // low sandy stand the display sits on (lifts ads off the ground)
  const DISPLAY_BAND = 1.5 // the ad band height on top of the plinth
  const STANDS_BASE = PLINTH_H + DISPLAY_BAND // first seat row rests on top of the display

  // --- APRON: extend the ground out from the grass to under the stands so the
  // net + display + first seats have SOLID ground to sit on (no floating/hole)
  const apron = new THREE.Mesh(
    new THREE.CylinderGeometry(STANDS_INNER + 0.1, STANDS_INNER + 0.1, 0.6, SEGMENTS),
    makeToonMaterial(STADIUM.frame),
  )
  apron.position.y = -0.3 // top surface flush with the field (y=0)
  group.add(apron)

  // --- protective NET right at the field edge, standing UP FROM THE GROUND ----
  const NET_R = radius + 0.4
  const NET_H = 6.2 // taller
  const netGeo = new THREE.CylinderGeometry(NET_R, NET_R, NET_H, SEGMENTS, 1, true)
  const netMat = new THREE.MeshBasicMaterial({
    map: netTexture(),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    opacity: 0.42,
  })
  const net = new THREE.Mesh(netGeo, netMat)
  net.position.y = NET_H / 2 // base at the field surface (y=0)
  net.renderOrder = 3
  group.add(net)
  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(NET_R, 0.035, 5, SEGMENTS),
    makeToonMaterial(STADIUM.rail),
  )
  rail.rotation.x = Math.PI / 2
  rail.position.y = NET_H
  group.add(rail)

  // --- DISPLAY behind the net: a low sandy PLINTH from the ground, then the
  // raised ad BAND on top (so the ads sit at a viewable height, not on the
  // floor). Together they span net->stands and rise to the first seat row.
  const DISPLAY_INNER = radius + 0.7
  // 1) plinth: solid sandy stand, ground -> PLINTH_H
  const plinth = new THREE.Mesh(
    ringGeometry(DISPLAY_INNER, STANDS_INNER + 0.05, PLINTH_H),
    makeToonMaterial(STADIUM.frame),
  )
  addInkOutline(plinth, INK_WEIGHT.arena)
  group.add(plinth)
  // 2) display band frame on top of the plinth, PLINTH_H -> STANDS_BASE
  const boardWall = new THREE.Mesh(
    ringGeometry(DISPLAY_INNER, STANDS_INNER + 0.05, DISPLAY_BAND),
    makeToonMaterial(STADIUM.frame),
  )
  boardWall.position.y = PLINTH_H
  addInkOutline(boardWall, INK_WEIGHT.arena)
  group.add(boardWall)
  // 3) the dark LED ad screen on the inner (pitch-facing) face of the band
  const screen = new THREE.Mesh(
    new THREE.CylinderGeometry(DISPLAY_INNER - 0.02, DISPLAY_INNER - 0.02, DISPLAY_BAND * 0.86, SEGMENTS, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x2b3038, side: THREE.BackSide }),
  )
  screen.position.y = PLINTH_H + DISPLAY_BAND * 0.5
  group.add(screen)

  // each seating row is a stepped ring (riser + tread) — the classic rake.
  // rows cycle through a set of ART-STYLE seat-block colours so the bowl reads
  // colourful + alive instead of flat off-white.
  const SEAT_TONES = STADIUM.seatTones
  const rowTops: Array<{ r: number; y: number }> = []
  for (let row = 0; row < ROWS; row++) {
    const inner = STANDS_INNER + row * ROW_DEPTH
    const y = STANDS_BASE + row * ROW_RISE
    rowTops.push({ r: inner + ROW_DEPTH * 0.5, y })
    const step = new THREE.Mesh(
      ringGeometry(inner, inner + ROW_DEPTH + 0.05, y + ROW_RISE),
      makeToonMaterial(SEAT_TONES[row % SEAT_TONES.length]!),
    )
    step.receiveShadow = true
    group.add(step)
  }
  // aisle strips: pale radial wedges laid over the rake so walkways read
  {
    const aisleMat = makeToonMaterial(STADIUM.aisle)
    for (let a = 0; a < AISLES; a++) {
      const mid = (a / AISLES) * Math.PI * 2
      const shape = new THREE.Shape()
      const r0 = STANDS_INNER - 0.1
      const r1 = STANDS_INNER + ROWS * ROW_DEPTH + 0.3
      const w = AISLE_HALF
      shape.moveTo(Math.cos(mid - w) * r0, Math.sin(mid - w) * r0)
      shape.lineTo(Math.cos(mid - w) * r1, Math.sin(mid - w) * r1)
      shape.lineTo(Math.cos(mid + w) * r1, Math.sin(mid + w) * r1)
      shape.lineTo(Math.cos(mid + w) * r0, Math.sin(mid + w) * r0)
      shape.closePath()
      const geo = new THREE.ShapeGeometry(shape)
      geo.rotateX(-Math.PI / 2)
      const strip = new THREE.Mesh(geo, aisleMat)
      strip.position.y = STANDS_BASE - 0.05
      strip.rotation.x = -0.62 // tilt up to follow the steeper rake
      group.add(strip)
    }
  }
  // tall outer rim wall behind the top row — where cannons/flags/lights mount
  const rimInner = STANDS_INNER + ROWS * ROW_DEPTH + 0.3
  const rimTop = STANDS_BASE + ROWS * ROW_RISE + 1.6
  const rim = new THREE.Mesh(ringGeometry(rimInner, rimInner + 1.4, rimTop), makeToonMaterial(STADIUM.frame))
  rim.castShadow = true
  addInkOutline(rim, INK_WEIGHT.arena)
  group.add(rim)

  // --- waving team FLAGS ringing the rim crown --------------------------------
  const flagField = createFlags(rimInner + 0.9, rimTop)
  group.add(flagField.group)

  // --- 4 tall LIGHT TOWERS at the cardinal corners (beams + lamp banks) --------
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4 // corners, between the goals
    const tx = Math.cos(a) * (rimInner + 2.2)
    const tz = Math.sin(a) * (rimInner + 2.2)
    group.add(buildLightTower(tx, tz, rimTop))
  }

  // --- the crowd: GPU-animated fans on the rake, skipping the aisles ----------
  const seats: CrowdSeat[] = []
  for (let row = 0; row < ROWS; row++) {
    const rr = rowTops[row]!.r
    const y = rowTops[row]!.y + 0.05
    const perRow = Math.floor((Math.PI * 2 * rr) / 0.95)
    for (let i = 0; i < perRow; i++) {
      const a = ((i + Math.random() * 0.3) / perRow) * Math.PI * 2
      // skip fans sitting in an aisle
      let inAisle = false
      for (let k = 0; k < AISLES; k++) {
        const mid = (k / AISLES) * Math.PI * 2
        let d = Math.abs(((a - mid + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
        if (d < AISLE_HALF + 0.03) inAisle = true
      }
      if (inAisle) continue
      if (Math.random() > 0.9) continue // a few empty seats read organic
      const x = Math.cos(a) * (rr + (Math.random() - 0.5) * 0.5)
      const z = Math.sin(a) * (rr + (Math.random() - 0.5) * 0.5)
      seats.push({
        x,
        z,
        y,
        yaw: yawTowardCenter(x, z) + (Math.random() - 0.5) * 0.4,
        scale: 0.8 + Math.random() * 0.35,
        angle: (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2),
        pick: Math.random(),
      })
    }
  }
  const crowd = createCrowd(seats, FAN_COLORS)
  crowd.recolor(6, []) // pre-match: everyone in random team colors
  group.add(crowd.group)

  // floating dream island: tapered rock mass under the floor
  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(rimInner * 0.6, radius * 0.28, 11, 24),
    makeToonMaterial(PALETTE.greenGray),
  )
  island.position.y = -6.0
  addInkOutline(island, INK_WEIGHT.arena)
  group.add(island)

  // --- the morphing layer: just the cannons ------------------------------------

  const cannonsGroup = new THREE.Group()
  group.add(cannonsGroup)

  function buildCannon(angle: number, zoneColor: number): THREE.Group {
    // MOUNTED ON THE TOPMOST RIM (above the audience), aiming down-and-inward
    // over the stands into the pitch — never out over the crowd.
    const cannon = new THREE.Group()
    const px = Math.cos(angle) * (rimInner + 0.7)
    const pz = Math.sin(angle) * (rimInner + 0.7)
    cannon.position.set(px, rimTop, pz)
    cannon.rotation.y = yawTowardCenter(px, pz) // local +Z aims at the center

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.6), makeToonMaterial(PALETTE.ink))
    base.position.y = 0.5
    addInkOutline(base, INK_WEIGHT.prop)
    cannon.add(base)

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.68, 3.0, 12), makeToonMaterial(PALETTE.ink))
    barrel.geometry.translate(0, 1.1, 0) // pivot at the breech
    barrel.position.set(0, 0.95, 0.15)
    barrel.rotation.x = 1.35 // tip the muzzle down-and-inward toward the pitch
    barrel.castShadow = true
    addInkOutline(barrel, INK_WEIGHT.prop)
    cannon.add(barrel)

    // the seat's colors on a muzzle band
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.42, 12), makeToonMaterial(zoneColor))
    band.position.y = 2.05
    barrel.add(band)
    return cannon
  }

  let elapsed = 0
  let forceNight = false // debug override of the progress-driven arc

  return {
    group,

    setZones(arena: Arena, zoneColors: readonly number[]): void {
      grass.setZones(arena.seats, zoneColors)
      crowd.recolor(arena.seats, zoneColors)
      disposeHierarchy(cannonsGroup)
      cannonsGroup.clear()
      for (let zone = 0; zone < arena.seats; zone++) {
        cannonsGroup.add(buildCannon(arena.zoneAngles[zone] ?? 0, zoneColors[zone] ?? PALETTE.warmGray))
      }
    },

    setMatchProgress(survivors: number, seatsAtStart: number): void {
      if (!forceNight) dayNight?.setMatchProgress(survivors, seatsAtStart)
    },

    debugForceNight(on: boolean): void {
      forceNight = on
      dayNight?.setTarget(on ? 1 : 0)
    },

    onNightfall(cb: () => void): void {
      dayNight?.onNightfall(cb)
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
      crowd.update(dt) // GPU-animated fans: one uniform write, no CPU cost
      flagField.update(elapsed) // waving flags: one uniform write
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
      crowd.dispose()
      disposeHierarchy(group)
    },
  }
}
