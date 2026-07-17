import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { PALETTE } from './palette.ts'
import { gouacheTexture, strokeTexture } from './textures.ts'

/**
 * The two shared material families of the whole game (architecture.md §1):
 * gouache-modulated toon fills + sketch ink hulls. Everything visible goes
 * through here so the style stays one system.
 */

// --- shared singletons -------------------------------------------------------

let ramp: THREE.DataTexture | null = null
/** Trait 2.3 — subtle 2-step ramp: banding that whispers. */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp
  const data = new Uint8Array([205, 205, 205, 255, 255, 255, 255, 255]) // shade ~0.8, lit 1.0
  ramp = new THREE.DataTexture(data, 2, 1)
  ramp.magFilter = THREE.NearestFilter
  ramp.minFilter = THREE.NearestFilter
  ramp.generateMipmaps = false
  ramp.needsUpdate = true
  return ramp
}

let gouache: THREE.Texture | null = null
const gouacheVariants = new Map<number, THREE.Texture>()
function sharedGouache(repeat = 2): THREE.Texture {
  gouache ??= gouacheTexture()
  if (repeat === 2) return gouache
  let variant = gouacheVariants.get(repeat)
  if (!variant) {
    variant = gouache.clone() // shares the image, independent repeat
    variant.repeat.set(repeat, repeat)
    variant.needsUpdate = true
    gouacheVariants.set(repeat, variant)
  }
  return variant
}

let stroke: THREE.Texture | null = null
function sharedStroke(): THREE.Texture {
  stroke ??= strokeTexture()
  return stroke
}

// --- toon fills ----------------------------------------------------------------

/** Gouache-modulated toon fill — the only surface material in the game.
 *  `gouacheRepeat` scales the paint tile for big surfaces (arena floor). */
export function makeToonMaterial(color: number, gouacheRepeat = 2): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonRamp(),
    map: sharedGouache(gouacheRepeat),
  })
}

// --- sketch ink hulls ------------------------------------------------------------

const INK_VERTEX = /* glsl */ `
  uniform float uThickness;
  varying vec3 vPos;
  void main() {
    vPos = position;
    // per-vertex width jitter: the line breathes like a pen stroke
    float jitter = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 expanded = position + normal * uThickness * (0.7 + 0.6 * jitter);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
  }
`

const INK_FRAGMENT = /* glsl */ `
  uniform vec3 uInk;
  uniform sampler2D uStroke;
  varying vec3 vPos;
  void main() {
    // object-space sample -> stable gaps and speckle along the stroke
    vec2 samplePos = vPos.xy * 0.35 + vec2(vPos.z * 0.23, vPos.z * 0.17);
    float mask = texture2D(uStroke, samplePos).r;
    if (mask < 0.35) discard;
    gl_FragColor = vec4(uInk, 1.0);
  }
`

export function makeInkMaterial(thickness: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uThickness: { value: thickness },
      uInk: { value: new THREE.Color(PALETTE.ink) },
      uStroke: { value: sharedStroke() },
    },
    vertexShader: INK_VERTEX,
    fragmentShader: INK_FRAGMENT,
  })
}

/**
 * Hull geometry: positions only, coincident vertices merged, normals
 * recomputed SMOOTH — so backface expansion stays watertight at hard
 * box corners (raw box normals would split the hull open at every edge).
 */
export function makeHullGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  let hull = new THREE.BufferGeometry()
  hull.setAttribute('position', source.getAttribute('position').clone())
  if (source.index) hull.setIndex(source.index.clone())
  hull = mergeVertices(hull, 1e-4)
  hull.computeVertexNormals()
  return hull
}

/**
 * Line-weight hierarchy (art_direction.md §2.2): characters/ball > props > arena.
 */
export const INK_WEIGHT = {
  character: 0.05,
  prop: 0.035,
  arena: 0.022,
} as const

/** Attach a sketch outline hull as a child of the mesh. Built once, never per frame. */
export function addInkOutline(mesh: THREE.Mesh, thickness: number = INK_WEIGHT.prop): THREE.Mesh {
  const hull = new THREE.Mesh(makeHullGeometry(mesh.geometry), makeInkMaterial(thickness))
  hull.name = 'ink-hull'
  hull.matrixAutoUpdate = false // rides its parent's transform
  mesh.add(hull)
  return hull
}

/**
 * Dispose every geometry + material under a root (hulls included).
 * Shared textures survive — only per-object GPU resources are freed.
 * This is what makes arena morphs leak-free (architecture.md not-to-do #4).
 */
export function disposeHierarchy(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of materials) material.dispose()
    }
  })
}
