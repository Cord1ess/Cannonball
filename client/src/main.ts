import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Time } from '@vendor/scheduler/time.ts'
import { createGrainOverlay } from './render/grain.ts'
import { addInkOutline, INK_WEIGHT, makeToonMaterial } from './render/materials.ts'
import { PALETTE } from './render/palette.ts'
import { makeSky } from './render/sky.ts'
import { tickDecalTexture } from './render/textures.ts'

/**
 * M0 graybox: a gray box-stack on a gray disc under the painted sky.
 * Acceptance test (implementation_plan.md): "reads as a drawing".
 * No gameplay here — M1 replaces this scene with the arena sandbox.
 */

// --- renderer -------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.autoClear = false
document.body.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- scene ----------------------------------------------------------------------

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(PALETTE.horizonCream, 60, 240)

// trait 2.3 — high-key flat light: hemisphere carries it, directional only picks the shade step
scene.add(new THREE.HemisphereLight(0xdcefe8, 0xcbbfa6, 0.95))
const sun = new THREE.DirectionalLight(0xfff3e0, 0.85)
sun.position.set(6, 10, 4)
scene.add(sun)

scene.add(makeSky())

// the disc "pitch"
const disc = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.5, 48), makeToonMaterial(PALETTE.warmGray))
disc.position.y = -0.25
addInkOutline(disc, INK_WEIGHT.arena)
scene.add(disc)

// art-directed shadow shape under the stack (trait 2.3)
const shadowShape = new THREE.Shape()
const shadowPoints = 7
for (let i = 0; i <= shadowPoints; i++) {
  const a = (i / shadowPoints) * Math.PI * 2
  const r = 1.5 + Math.sin(a * 3.1) * 0.35 + Math.cos(a * 1.7) * 0.25
  const x = Math.cos(a) * r + 0.5
  const y = Math.sin(a) * r * 0.75 + 0.3
  if (i === 0) shadowShape.moveTo(x, y)
  else shadowShape.lineTo(x, y)
}
const shadow = new THREE.Mesh(
  new THREE.ShapeGeometry(shadowShape),
  new THREE.MeshBasicMaterial({ color: PALETTE.shadowShape, transparent: true, opacity: 0.5, depthWrite: false }),
)
shadow.rotation.x = -Math.PI / 2
shadow.position.y = 0.012
scene.add(shadow)

// scatter tick/hatch decals on the pitch (trait 2.2)
const tickTex = tickDecalTexture()
for (let i = 0; i < 6; i++) {
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshBasicMaterial({ map: tickTex, transparent: true, depthWrite: false }),
  )
  const a = Math.random() * Math.PI * 2
  const r = 2.5 + Math.random() * 4.5
  decal.position.set(Math.cos(a) * r, 0.011, Math.sin(a) * r)
  decal.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2)
  scene.add(decal)
}

/** A merged box-stack — previews the bean build approach (one geometry, one hull). */
function makeBoxStack(rows: ReadonlyArray<readonly [number, number]>, color: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = []
  let y = 0
  for (const [width, height] of rows) {
    const box = new THREE.BoxGeometry(width, height, width * 0.85)
    box.translate(0, y + height / 2, 0)
    parts.push(box)
    y += height
  }
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  const mesh = new THREE.Mesh(merged, makeToonMaterial(color))
  addInkOutline(mesh, INK_WEIGHT.character)
  return mesh
}

// proto-bean stack, center stage
const stack = makeBoxStack(
  [
    [1.0, 0.32],
    [1.3, 0.36],
    [1.45, 0.38],
    [1.3, 0.36],
    [0.95, 0.3],
  ],
  PALETTE.offWhite,
)
stack.position.set(0.4, 0, 0.2)
scene.add(stack)

// companion stack + a post, to judge outlines on varied shapes
const small = makeBoxStack(
  [
    [0.7, 0.26],
    [0.9, 0.3],
    [0.75, 0.24],
  ],
  PALETTE.greenGray,
)
small.position.set(3.1, 0, -1.6)
scene.add(small)

const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 2.2, 12), makeToonMaterial(PALETTE.groundCream))
post.position.set(-2.9, 1.1, 1.2)
addInkOutline(post, INK_WEIGHT.prop)
scene.add(post)

// --- loop -----------------------------------------------------------------------

const grain = createGrainOverlay()
const time = new Time()

function frame(nowMs: number): void {
  requestAnimationFrame(frame)
  time.advance(nowMs)
  const steps = time.consumeFixedSteps()
  for (let i = 0; i < steps; i++) {
    time.beginFixedStep()
    // fixed-step simulation lands here in M1
  }

  const t = time.unscaledElapsed
  camera.position.set(Math.cos(t * 0.1) * 13, 6.2, Math.sin(t * 0.1) * 13)
  camera.lookAt(0, 1.1, 0)

  renderer.clear()
  renderer.render(scene, camera)
  grain.render(renderer)
}

requestAnimationFrame(frame)

console.log('[cannonball] M0 graybox running — style kit: gouache fills, sketch hulls, painted sky, grain')
