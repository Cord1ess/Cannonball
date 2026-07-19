import * as THREE from 'three'
import { PALETTE } from './palette.ts'

/**
 * The VFX particle system (M6 juice, art_direction.md §8). Everything looks
 * DRAWN: ink starbursts + white puffs on headers, dust on knocks, a poof +
 * paper confetti on elimination, cloud-ring poofs on cannon launches.
 *
 * ONE pooled InstancedMesh of camera-facing quads with a custom shader. Each
 * particle carries per-instance attributes (spawn pos, velocity, birth, life,
 * kind, seed); ALL motion + fade lives in the VERTEX/FRAGMENT shader driven by
 * a single uTime uniform — so once spawned a burst costs ZERO per-frame CPU.
 * Spawning just writes into the ring buffer and flags the attribute update.
 *
 * The sprite ATLAS (one canvas, 4 cells) carries the style: a spiky ink
 * starburst, a soft white gouache puff, a paper confetti chip, a soft dust mote.
 * The `kind` attribute picks the atlas cell in the shader.
 */

export interface Particles {
  readonly group: THREE.Object3D
  /** ink starburst + white puff at a header connect, scaled by force (0..1) */
  header(x: number, y: number, z: number, force: number): void
  /** a small dust puff where a bean got knocked, scaled by speed (0..1) */
  knock(x: number, y: number, z: number, speed: number): void
  /** poof + confetti fountain on elimination, tinted to the team colour */
  eliminate(x: number, y: number, z: number, color: number): void
  /** a cloud-ring poof at a cannon launch */
  launchPuff(x: number, y: number, z: number): void
  /** advance the shader clock; call every frame with real seconds */
  update(dt: number): void
}

const MAX = 900 // pool size — plenty for the busiest moment, one draw call
const KIND = { star: 0, puff: 1, confetti: 2, dust: 3 } as const

// --- the sprite atlas: 2x2 cells, each a drawn shape -------------------------
function atlasTexture(): THREE.CanvasTexture {
  const cell = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = cell * 2
  const ctx = cv.getContext('2d')!
  const ink = `#${PALETTE.ink.toString(16).padStart(6, '0')}`

  // cell 0 (top-left): INK STARBURST — spiky radiating strokes, hand-drawn
  ctx.save()
  ctx.translate(cell * 0.5, cell * 0.5)
  ctx.strokeStyle = ink
  ctx.lineCap = 'round'
  const spikes = 11
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + (i % 2) * 0.12
    const len = cell * (0.28 + (i % 3) * 0.06)
    ctx.lineWidth = 5 - (i % 2) * 1.5
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * cell * 0.08, Math.sin(a) * cell * 0.08)
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len)
    ctx.stroke()
  }
  ctx.restore()

  // cell 1 (top-right): SOFT WHITE PUFF — a fluffy gouache blob
  ctx.save()
  ctx.translate(cell * 1.5, cell * 0.5)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    const r = cell * 0.16
    const px = Math.cos(a) * cell * 0.16
    const py = Math.sin(a) * cell * 0.16
    const g = ctx.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, 'rgba(255,253,246,0.95)')
    g.addColorStop(1, 'rgba(255,253,246,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // cell 2 (bottom-left): CONFETTI CHIP — a small rounded paper rectangle, white
  // (tinted per-instance in the shader by the team colour attr)
  ctx.save()
  ctx.translate(cell * 0.5, cell * 1.5)
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = 'rgba(58,52,45,0.55)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(-cell * 0.22, -cell * 0.13, cell * 0.44, cell * 0.26, 5)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // cell 3 (bottom-right): DUST MOTE — a soft warm-gray smudge
  ctx.save()
  ctx.translate(cell * 1.5, cell * 1.5)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.34)
  g.addColorStop(0, 'rgba(198,190,180,0.75)')
  g.addColorStop(1, 'rgba(198,190,180,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, cell * 0.34, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function createParticles(): Particles {
  const geo = new THREE.InstancedBufferGeometry()
  // base quad (two triangles)
  const quad = new THREE.PlaneGeometry(1, 1)
  if (quad.index) geo.setIndex(quad.index)
  geo.setAttribute('position', quad.attributes.position!)
  geo.setAttribute('uv', quad.attributes.uv!)

  // per-instance buffers
  const aSpawn = new Float32Array(MAX * 3)
  const aVel = new Float32Array(MAX * 3)
  const aBirth = new Float32Array(MAX)
  const aLife = new Float32Array(MAX)
  const aSize = new Float32Array(MAX)
  const aKind = new Float32Array(MAX)
  const aSeed = new Float32Array(MAX)
  const aColor = new Float32Array(MAX * 3)
  // start all particles long-dead
  aBirth.fill(-1000)
  aLife.fill(1)

  const spawnAttr = new THREE.InstancedBufferAttribute(aSpawn, 3)
  const velAttr = new THREE.InstancedBufferAttribute(aVel, 3)
  const birthAttr = new THREE.InstancedBufferAttribute(aBirth, 1)
  const lifeAttr = new THREE.InstancedBufferAttribute(aLife, 1)
  const sizeAttr = new THREE.InstancedBufferAttribute(aSize, 1)
  const kindAttr = new THREE.InstancedBufferAttribute(aKind, 1)
  const seedAttr = new THREE.InstancedBufferAttribute(aSeed, 1)
  const colorAttr = new THREE.InstancedBufferAttribute(aColor, 3)
  geo.setAttribute('aSpawn', spawnAttr)
  geo.setAttribute('aVel', velAttr)
  geo.setAttribute('aBirth', birthAttr)
  geo.setAttribute('aLife', lifeAttr)
  geo.setAttribute('aSize', sizeAttr)
  geo.setAttribute('aKind', kindAttr)
  geo.setAttribute('aSeed', seedAttr)
  geo.setAttribute('aColor', colorAttr)
  geo.instanceCount = MAX

  const uniforms = {
    uTime: { value: 0 },
    uAtlas: { value: atlasTexture() },
    uGravity: { value: 14 },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uGravity;
      attribute vec3 aSpawn;
      attribute vec3 aVel;
      attribute float aBirth;
      attribute float aLife;
      attribute float aSize;
      attribute float aKind;
      attribute float aSeed;
      attribute vec3 aColor;
      varying vec2 vUv;
      varying float vAge;   // 0..1 over life
      varying float vKind;
      varying vec3 vColor;
      void main() {
        float age = (uTime - aBirth) / aLife;
        vAge = age;
        vKind = aKind;
        vColor = aColor;
        // dead / not-yet-born particles collapse to a point (culled)
        if (age < 0.0 || age > 1.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float t = age * aLife;
        // ballistic position: spawn + vel*t - gravity (confetti/dust fall, ink/puff drift up-ish)
        vec3 world = aSpawn + aVel * t;
        world.y -= 0.5 * uGravity * t * t * step(0.5, aKind); // only confetti(2)/dust(3) fall hard
        world.y -= 0.5 * (uGravity * 0.12) * t * t * (1.0 - step(0.5, aKind)); // star/puff gentle
        // confetti flutter: sideways wobble
        if (aKind > 1.5 && aKind < 2.5) {
          world.x += sin(uTime * 6.0 + aSeed * 30.0) * 0.25 * age;
          world.z += cos(uTime * 5.0 + aSeed * 30.0) * 0.25 * age;
        }
        // size curve: puff/star pop out fast then fade; confetti/dust steady-ish
        float grow = (aKind < 1.5) ? (0.4 + 1.2 * smoothstep(0.0, 0.25, age)) : 1.0;
        float shrink = (aKind < 1.5) ? (1.0 - smoothstep(0.55, 1.0, age)) : 1.0;
        float size = aSize * grow * shrink;
        // camera-facing billboard
        vec4 mv = modelViewMatrix * vec4(world, 1.0);
        // confetti spins; others just face camera
        float rot = (aKind > 1.5 && aKind < 2.5) ? (uTime * 4.0 + aSeed * 25.0) : 0.0;
        float c = cos(rot), s = sin(rot);
        vec2 p = position.xy;
        vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        mv.xy += rp * size;
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying float vAge;
      varying float vKind;
      varying vec3 vColor;
      void main() {
        // pick atlas cell from kind (0..3 -> 2x2 grid)
        float k = floor(vKind + 0.5);
        vec2 cell = vec2(mod(k, 2.0), floor(k / 2.0));
        vec2 uv = (vUv + cell) * 0.5;
        vec4 tex = texture2D(uAtlas, uv);
        // confetti gets the team tint; others keep their drawn colour
        vec3 col = (k > 1.5 && k < 2.5) ? mix(vColor, tex.rgb, 0.25) : tex.rgb;
        float fade = 1.0 - smoothstep(0.6, 1.0, vAge); // tail fade-out
        float a = tex.a * fade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  })

  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false // instances are placed in the shader
  mesh.renderOrder = 10 // over the world, under UI

  let time = 0
  let head = 0 // ring-buffer write cursor
  let dirty = false

  function emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    kind: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const i = head
    head = (head + 1) % MAX
    aSpawn[i * 3] = x
    aSpawn[i * 3 + 1] = y
    aSpawn[i * 3 + 2] = z
    aVel[i * 3] = vx
    aVel[i * 3 + 1] = vy
    aVel[i * 3 + 2] = vz
    aBirth[i] = time
    aLife[i] = life
    aSize[i] = size
    aKind[i] = kind
    aSeed[i] = Math.random()
    aColor[i * 3] = r
    aColor[i * 3 + 1] = g
    aColor[i * 3 + 2] = b
    dirty = true
  }

  const flush = (): void => {
    if (!dirty) return
    spawnAttr.needsUpdate = true
    velAttr.needsUpdate = true
    birthAttr.needsUpdate = true
    lifeAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    kindAttr.needsUpdate = true
    seedAttr.needsUpdate = true
    colorAttr.needsUpdate = true
    dirty = false
  }

  const rgb = (hex: number): [number, number, number] => [
    ((hex >> 16) & 255) / 255,
    ((hex >> 8) & 255) / 255,
    (hex & 255) / 255,
  ]

  return {
    group: mesh,
    header(x, y, z, force) {
      const f = Math.max(0.25, Math.min(1, force))
      // a spiky ink starburst at the contact point
      emit(x, y, z, 0, 0.4 * f, 0, 0.42 + 0.2 * f, (1.4 + 1.6 * f), KIND.star, 0, 0, 0)
      // a ring of white puffs blown outward, scaled by force
      const n = 5 + Math.round(f * 5)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
        const sp = (2.2 + Math.random() * 2.5) * (0.6 + f)
        emit(x, y, z, Math.cos(a) * sp, 1.2 + Math.random() * 1.5, Math.sin(a) * sp, 0.5 + Math.random() * 0.25, 0.7 + Math.random() * 0.5, KIND.puff, 0, 0, 0)
      }
    },
    knock(x, y, z, speed) {
      const s = Math.max(0.2, Math.min(1, speed))
      const n = 3 + Math.round(s * 4)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5
        const sp = (1.5 + Math.random() * 2) * (0.5 + s)
        emit(x, 0.15, z, Math.cos(a) * sp, 0.6 + Math.random() * 0.9, Math.sin(a) * sp, 0.45 + Math.random() * 0.2, 0.6 + Math.random() * 0.4, KIND.dust, 0, 0, 0)
      }
    },
    eliminate(x, y, z, color) {
      const [r, g, b] = rgb(color)
      // a big white poof
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 1.5 + Math.random() * 3
        emit(x, y + 0.6, z, Math.cos(a) * sp, 1.5 + Math.random() * 2.5, Math.sin(a) * sp, 0.6 + Math.random() * 0.3, 0.9 + Math.random() * 0.6, KIND.puff, 0, 0, 0)
      }
      // a paper-confetti fountain in the team colour
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 1 + Math.random() * 3.5
        emit(x, y + 1.0, z, Math.cos(a) * sp, 5 + Math.random() * 4, Math.sin(a) * sp, 1.1 + Math.random() * 0.8, 0.4 + Math.random() * 0.3, KIND.confetti, r, g, b)
      }
    },
    launchPuff(x, y, z) {
      // a cloud-ring poof under the cannon
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const sp = 2 + Math.random() * 1.5
        emit(x, y, z, Math.cos(a) * sp, 0.4 + Math.random() * 0.8, Math.sin(a) * sp, 0.55 + Math.random() * 0.25, 1.0 + Math.random() * 0.5, KIND.puff, 0, 0, 0)
      }
    },
    update(dt) {
      time += dt
      uniforms.uTime.value = time
      flush()
    },
  }
}
