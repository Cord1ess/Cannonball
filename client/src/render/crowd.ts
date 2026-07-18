import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { toonRamp } from './materials.ts'

/**
 * The stadium CROWD (M5b revamp): a lively animated audience that costs ~nothing
 * per frame. ALL animation runs in the VERTEX SHADER from per-instance seeds —
 * one InstancedMesh, one draw call, thousands of fans, ZERO per-frame CPU work
 * (the only uniform written each frame is the global clock). Same technique as
 * the grass field.
 *
 * Each fan animates a mix of: idle bob, a two-arms-up JUMP/cheer, a one-arm
 * WAVE, a head LOOK left/right, and an eye BLINK — all phase-offset per seed so
 * the stand reads as chaotic and alive, never a synchronised Mexican wave.
 *
 * The art-style crayon BORDER is baked cheaply as a second instanced inverted-
 * hull pass that shares the exact same vertex animation (so the outline tracks
 * the moving arms/head) — no per-fan CPU cost, one extra draw.
 */

export interface Crowd {
  readonly group: THREE.Group
  /** recolor stands so each wedge fills with its owner-seat's supporters */
  recolor(zoneCount: number, zoneColors: readonly number[]): void
  /** advance the GPU animation clock (one uniform write) */
  update(dt: number): void
  dispose(): void
}

export interface CrowdSeat {
  x: number
  z: number
  y: number
  yaw: number
  scale: number
  angle: number // arena angle for wedge recolor
  pick: number // stable random for color choice
}

// PART ids baked into a vertex attribute so the shader animates each part:
const PART_BODY = 0
const PART_ARM_L = 1
const PART_ARM_R = 2
const PART_HEAD = 3

// EXACT player-bean proportions (see render/bean.ts) so fans ARE the players,
// just crowd-animated. Feet at y=0 → the fan stands on the seat surface.
const SHOULDER_Y = 1.0 // arm pivot, matches the player bean
const ARM_X = 0.52
const FACE_Y = 0.98
const FACE_Z = 0.34

function stack(rows: ReadonlyArray<readonly [number, number]>, y0: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  let y = y0
  for (const [w, h] of rows) {
    const box = new THREE.BoxGeometry(w, h, w * 0.8)
    box.translate(0, y + h / 2, 0)
    parts.push(box)
    y += h
  }
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged
}

/** a fan built from the PLAYER BEAN silhouette, parts tagged for GPU animation. */
function crowdGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const tag = (g: THREE.BufferGeometry, part: number): THREE.BufferGeometry => {
    const n = g.getAttribute('position').count
    const a = new Float32Array(n)
    a.fill(part)
    g.setAttribute('aPart', new THREE.BufferAttribute(a, 1))
    return g
  }

  // shorts + feet + body torso = the player bean's body stack (all PART_BODY,
  // they sway/bob together). Same rows/heights as createBean().
  const shorts = stack(
    [
      [0.72, 0.16],
      [0.82, 0.18],
    ],
    0.12,
  )
  parts.push(tag(shorts, PART_BODY))
  for (const side of [-1, 1]) {
    const foot = new THREE.BoxGeometry(0.24, 0.12, 0.32)
    foot.translate(side * 0.2, 0.06, 0.02)
    parts.push(tag(foot, PART_BODY))
  }
  const body = stack(
    [
      [0.88, 0.22],
      [0.86, 0.26],
      [0.76, 0.26],
      [0.58, 0.2],
    ],
    0.46,
  )
  // the top body box (y≈1.2..1.4) reads as the head — tag it PART_HEAD so it
  // can turn to look around (the face plate rides it). The rest is PART_BODY.
  parts.push(tag(body, PART_BODY))
  const head = new THREE.BoxGeometry(0.5, 0.42, 0.5) // a defined head cube on top
  head.translate(0, 1.2, 0)
  parts.push(tag(head, PART_HEAD))

  // arms — pivot at the SHOULDER (y = SHOULDER_Y), matching the player bean, so
  // the shader swings them up around that joint.
  for (const [side, part] of [
    [-1, PART_ARM_L],
    [1, PART_ARM_R],
  ] as const) {
    const arm = new THREE.BoxGeometry(0.16, 0.44, 0.2)
    // box spans down from the shoulder: shift so y=0 is the shoulder joint
    arm.translate(side * ARM_X, SHOULDER_Y - 0.22, 0)
    parts.push(tag(arm, part))
  }

  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged
}

/** cream face plate with two ink eyes, baked into a small texture (blink in shader) */
function faceTexture(): THREE.CanvasTexture {
  const s = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = s
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, s, s)
  ctx.fillStyle = '#1c1a18'
  ctx.fillRect(s * 0.32 - 3, s * 0.4, 6, 12)
  ctx.fillRect(s * 0.68 - 3, s * 0.4, 6, 12)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- the animated vertex program, shared by the fill + the outline hull -------
// aSeed: x = phase, y = which behaviours this fan favours, z = wave/jump speed,
//        w = look bias.  uTime is the only per-frame uniform.
const ANIM_GLSL = /* glsl */ `
  attribute float aPart;
  attribute vec4 aSeed;      // phase, behaviour, speed, lookBias
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vPart;
  varying float vShade;      // for the toon-ish rim + face fade
  uniform float uTime;

  // rotate a point around the origin on the given axis-plane
  vec3 rotX(vec3 p, float a){ float c=cos(a),s=sin(a); return vec3(p.x, c*p.y - s*p.z, s*p.y + c*p.z); }
  vec3 rotY(vec3 p, float a){ float c=cos(a),s=sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }

  vec3 animate(vec3 pos, float part, vec4 seed, out float shade){
    float t = uTime * (0.7 + seed.z * 0.9) + seed.x * 6.2831;
    // behaviour weights from seed.y: some fans mostly cheer, some mostly wave
    float cheer = smoothstep(0.55, 1.0, sin(t * 0.7 + seed.y * 5.0) * 0.5 + 0.5); // bursts of both-arms-up
    float wave  = 0.5 + 0.5 * sin(t * 2.2 + seed.y * 3.0);                         // continuous 1-arm wave
    float bob   = sin(t * 1.6) * 0.03 + cheer * 0.14;                              // stand up on the cheer
    float look  = sin(t * 0.5 + seed.w * 6.2831) * 0.5;                            // head turn L/R
    shade = 0.86 + 0.14 * (0.5 + 0.5 * sin(t*1.6));

    vec3 p = pos;
    if (part < 0.5) {
      // BODY: bob up on cheers, a tiny sway
      p.y += bob;
      p.x += sin(t * 1.3) * 0.02;
    } else if (part < 1.5) {
      // LEFT ARM: raise on cheer (both arms), pivoting at the SHOULDER joint
      float raise = cheer * 2.4;                       // radians up around shoulder
      vec3 pivL = vec3(-0.52, 1.0, 0.0);
      p = rotX(p - pivL, -raise) + pivL;
      p.y += bob;
    } else if (part < 2.5) {
      // RIGHT ARM: raise on cheer AND does the solo wave when not cheering
      float raise = max(cheer * 2.4, wave * 1.9 * (1.0 - cheer));
      float wag = (1.0 - cheer) * wave * sin(t * 9.0) * 0.5; // hand waggle at the top
      vec3 pivR = vec3(0.52, 1.0, 0.0);
      p = rotX(p - pivR, -raise) + pivR;
      p = rotY(p - pivR, wag) + pivR;
      p.y += bob;
    } else {
      // HEAD: bob + turn to look around
      p.y += bob;
      p = rotY(p, look);
    }
    return p;
  }
`

function makeAnimatedMaterial(outline: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: outline ? THREE.BackSide : THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uInk: { value: new THREE.Color(0x2c2824) },
      uOutline: { value: outline ? 1 : 0 },
      uRamp: { value: toonRamp() },
      uLight: { value: new THREE.Vector3(0.4, 0.9, 0.3).normalize() },
    },
    vertexShader: /* glsl */ `
      ${ANIM_GLSL}
      uniform float uOutline;
      uniform vec3 uLight;
      void main() {
        float shade;
        vec3 animated = animate(position, aPart, aSeed, shade);
        // OUTLINE pass: push the animated vertex out along its normal for the
        // inverted-hull crayon border, riding the SAME animation as the fill
        vec3 nrm = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(animated, 1.0);
        if (uOutline > 0.5) {
          vec4 nv = modelViewMatrix * instanceMatrix * vec4(animated + normal * 0.001, 1.0);
          vec3 mvN = normalize(nv.xyz - mv.xyz);
          mv.xyz += mvN * 0.035;
        }
        vColor = aColor;
        vPart = aPart;
        vShade = shade * (0.5 + 0.5 * clamp(dot(nrm, uLight), 0.0, 1.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      uniform float uOutline;
      uniform sampler2D uRamp;
      varying vec3 vColor;
      varying float vPart;
      varying float vShade;
      void main() {
        if (uOutline > 0.5) { gl_FragColor = vec4(uInk, 1.0); return; }
        // 2-step toon shade like the rest of the world
        float lit = texture2D(uRamp, vec2(clamp(vShade, 0.02, 0.98), 0.5)).r;
        vec3 col = vColor * mix(0.82, 1.0, lit);
        // the head reads a touch paler (a face/skin hint) so heads pop
        if (vPart > 2.5) col = mix(col, vec3(0.98, 0.95, 0.88), 0.55);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

export function createCrowd(seats: readonly CrowdSeat[], fanColors: readonly number[]): Crowd {
  const group = new THREE.Group()
  group.name = 'crowd'
  const count = seats.length

  const geo = crowdGeometry()
  const fillMat = makeAnimatedMaterial(false)
  const outlineMat = makeAnimatedMaterial(true)

  const fill = new THREE.InstancedMesh(geo, fillMat, count)
  const outline = new THREE.InstancedMesh(geo, outlineMat, count)
  fill.frustumCulled = false
  outline.frustumCulled = false
  fill.castShadow = false
  fill.receiveShadow = false

  // face plates: one instanced quad, blinks handled by a tiny y-squash in a
  // second cheap animated material would be overkill — bake open eyes, they
  // read fine at stand distance and the head already turns/bobs.
  const faceGeo = new THREE.PlaneGeometry(0.34, 0.28)
  faceGeo.translate(0, 1.22, 0.26) // on the front of the head cube (centre ~y1.2)
  const faceMat = makeFaceMaterial()
  const faces = new THREE.InstancedMesh(faceGeo, faceMat, count)
  faces.frustumCulled = false

  // per-instance transforms + seeds + colors
  const seed = new Float32Array(count * 4)
  const colorArr = new Float32Array(count * 3)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const col = new THREE.Color()
  const angles: number[] = []
  const picks: number[] = []
  for (let i = 0; i < count; i++) {
    const s = seats[i]!
    q.setFromAxisAngle(up, s.yaw)
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale))
    fill.setMatrixAt(i, m)
    outline.setMatrixAt(i, m)
    faces.setMatrixAt(i, m)
    seed[i * 4] = s.pick
    seed[i * 4 + 1] = ((s.pick * 41.3) % 1)
    seed[i * 4 + 2] = ((s.pick * 7.7) % 1)
    seed[i * 4 + 3] = ((s.pick * 3.1) % 1)
    col.setHex(fanColors[Math.floor(s.pick * 997) % fanColors.length]!)
    colorArr[i * 3] = col.r
    colorArr[i * 3 + 1] = col.g
    colorArr[i * 3 + 2] = col.b
    angles.push(s.angle)
    picks.push(s.pick)
  }
  const seedAttr = new THREE.InstancedBufferAttribute(seed, 4)
  const colorAttr = new THREE.InstancedBufferAttribute(colorArr, 3)
  geo.setAttribute('aSeed', seedAttr)
  geo.setAttribute('aColor', colorAttr)
  // the face quad shares the same per-instance seed (for the head bob/turn)
  faceGeo.setAttribute('aSeed', seedAttr)

  fill.instanceMatrix.needsUpdate = true
  outline.instanceMatrix.needsUpdate = true
  faces.instanceMatrix.needsUpdate = true
  // outline draws first (behind), then fill, then faces on top
  outline.renderOrder = 0
  fill.renderOrder = 1
  faces.renderOrder = 2
  group.add(outline, fill, faces)

  return {
    group,
    recolor(zoneCount: number, zoneColors: readonly number[]): void {
      const span = (Math.PI * 2) / Math.max(2, zoneCount)
      for (let i = 0; i < count; i++) {
        const zone = Math.floor(((angles[i]! + span / 2) % (Math.PI * 2)) / span) % Math.max(2, zoneCount)
        const home = zoneColors[zone]
        if (home !== undefined && picks[i]! < 0.62) col.setHex(home)
        else col.setHex(fanColors[Math.floor(picks[i]! * 997) % fanColors.length]!)
        colorArr[i * 3] = col.r
        colorArr[i * 3 + 1] = col.g
        colorArr[i * 3 + 2] = col.b
      }
      colorAttr.needsUpdate = true
    },
    update(dt: number): void {
      const t = (fillMat.uniforms.uTime!.value as number) + dt
      fillMat.uniforms.uTime!.value = t
      outlineMat.uniforms.uTime!.value = t
      faceMat.uniforms.uTime!.value = t
    },
    dispose(): void {
      geo.dispose()
      faceGeo.dispose()
      fillMat.dispose()
      outlineMat.dispose()
      faceMat.dispose()
    },
  }
}

/** face material: the eye plate, riding the head's bob/turn via the shared seed */
function makeFaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: faceTexture() },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      varying vec2 vUv;
      varying float vBlink;
      vec3 rotY(vec3 p, float a){ float c=cos(a),s=sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
      void main() {
        float t = uTime * (0.7 + fract(aSeed.z) * 0.9) + aSeed.x * 6.2831;
        float cheer = smoothstep(0.55, 1.0, sin(t * 0.7 + aSeed.y * 5.0) * 0.5 + 0.5);
        float bob = sin(t * 1.6) * 0.03 + cheer * 0.14;
        float look = sin(t * 0.5 + aSeed.w * 6.2831) * 0.5;
        // blink: a quick eye close a few times a minute, per-fan phase
        float bl = sin(t * 3.3 + aSeed.x * 20.0);
        vBlink = step(0.985, bl);
        vec3 p = rotY(position, look);
        p.y += bob;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying float vBlink;
      void main() {
        vec4 tx = texture2D(uMap, vUv);
        if (tx.a < 0.5) discard;
        // BLINK: during the brief blink window keep only a thin mid-line of the
        // eye (a closed-eye dash) and hide the rest — reads as an eye shutting.
        if (vBlink > 0.5 && abs(vUv.y - 0.5) > 0.06) discard;
        gl_FragColor = vec4(0.11, 0.10, 0.09, 1.0);
      }
    `,
  })
}
