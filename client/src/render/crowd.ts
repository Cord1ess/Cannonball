import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { KitColors } from '@shared/cosmetics/jerseys.ts'
import { createBean } from './bean.ts'
import { toonRamp } from './materials.ts'

/**
 * The stadium CROWD: supporters that ARE the playable bean — same geometry, the
 * team jersey colour, sitting in the stands cheering with emotes (idle bob,
 * both-arms-up cheer, one-arm wave, look left/right, jump). ALL animation runs
 * in the vertex shader from a per-instance seed, so one InstancedMesh animates
 * the whole stand with ~zero per-frame CPU (only the clock uniform is written).
 *
 * The fan geometry is EXTRACTED from a real createBean() (not rebuilt), with its
 * mesh parts tagged so the shader can swing the arms / turn the head. A second
 * instanced inverted-hull pass gives the crayon outline, riding the same anim.
 */

export interface Crowd {
  readonly group: THREE.Group
  /** assign each fixed stand SECTION its team jersey + whether that team is
   *  still in the match (eliminated teams' fans leave the stadium) */
  setSections(
    sectionKits: readonly (KitColors | undefined)[],
    sectionAlive: readonly boolean[],
  ): void
  /** advance the GPU animation clock (one uniform write, no CPU animation) */
  update(dt: number): void
  dispose(): void
}

export interface CrowdSeat {
  x: number
  z: number
  y: number
  yaw: number
  scale: number
  angle: number // arena angle, for the wedge recolor
  pick: number // stable per-fan random (colour choice + seed)
}

// per-vertex animation part id, baked into the geometry:
const PART_BODY = 0.0
const PART_ARM_L = 1.0
const PART_ARM_R = 2.0
const PART_HEAD = 3.0

// the bean's shoulder joint (arms hang here) — read off createBean's rig.
const SHOULDER = 1.0
const ARM_X = 0.52
// verts above this height belong to the "head" region (upper body + face) that
// turns to look around. The bean is headless-style; its face sits on the torso.
const HEAD_Y = 1.05

/**
 * Extract the fan geometry straight from a real player bean. Walk its solid
 * meshes, bake each mesh transform into world-local vertices, KEEP normals
 * (the shader needs them — missing normals = NaN = exploded mesh), and tag each
 * vertex with its animation part. All parts share {position, normal, aPart},
 * non-indexed, so the merge is always clean.
 */
function beanGeometry(): THREE.BufferGeometry {
  const bean = createBean(0xffffff)
  const parts: THREE.BufferGeometry[] = []
  const v = new THREE.Vector3()

  bean.group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || obj.name === 'ink-hull') return
    const src = obj.geometry as THREE.BufferGeometry
    if (!src.getAttribute('position')) return

    const flat = src.index ? src.toNonIndexed() : src.clone()
    const pos = flat.getAttribute('position') as THREE.BufferAttribute
    obj.updateMatrix()
    const nMat = new THREE.Matrix3().getNormalMatrix(obj.matrix)
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(obj.matrix)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    let nrm = flat.getAttribute('normal') as THREE.BufferAttribute | undefined
    if (!nrm) {
      flat.computeVertexNormals()
      nrm = flat.getAttribute('normal') as THREE.BufferAttribute
    } else {
      for (let i = 0; i < nrm.count; i++) {
        v.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyMatrix3(nMat).normalize()
        nrm.setXYZ(i, v.x, v.y, v.z)
      }
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', pos)
    g.setAttribute('normal', nrm)
    // classify this mesh's part: arms are the shoulder-height side meshes; the
    // rest is body, except verts high enough to be the "head" region.
    const isArm = Math.abs(obj.position.x) > 0.35 && obj.position.y > 0.6
    const part = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      if (isArm) part[i] = obj.position.x < 0 ? PART_ARM_L : PART_ARM_R
      else part[i] = pos.getY(i) > HEAD_Y ? PART_HEAD : PART_BODY
    }
    g.setAttribute('aPart', new THREE.BufferAttribute(part, 1))
    parts.push(g)
  })

  bean.dispose()
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged
}

// The shared emote animation — pure function of the per-instance seed + clock.
// seed: x=phase, y=behaviour mix, z=speed, w=look bias.
const ANIM = /* glsl */ `
  vec3 rotX(vec3 p, float a){ float c=cos(a),s=sin(a); return vec3(p.x, c*p.y - s*p.z, s*p.y + c*p.z); }
  vec3 rotY(vec3 p, float a){ float c=cos(a),s=sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }

  vec3 emote(vec3 pos, float part, vec4 seed){
    float t = uTime * (1.8 + seed.z * 1.4) + seed.x * 6.2831;
    // a fan cycles slowly between emotes; which one depends on the seed
    float phase = sin(t * 0.5 + seed.y * 6.2831);
    float cheer = smoothstep(0.4, 0.9, phase);              // BOTH ARMS UP
    float wave  = smoothstep(0.4, 0.9, -phase) * (0.5 + 0.5*sin(t*3.0)); // ONE-ARM WAVE
    float jump  = max(0.0, sin(t * 1.7 + seed.y * 3.0));    // little JUMPS
    jump = jump * jump * jump * 0.35 * step(0.6, seed.w);   // only some fans jump
    float look  = sin(t * 0.6 + seed.w * 6.2831) * 0.28;     // head turn L/R
    float bob   = sin(t * 2.0) * 0.03 + cheer * 0.1;

    vec3 p = pos;
    if (part < 0.5) {
      // BODY: bob + jump lift + a tiny sway
      p.y += bob + jump;
      p.x += sin(t * 1.3) * 0.02;
    } else if (part < 1.5) {
      // LEFT ARM: up on cheer, pivot at the shoulder
      vec3 piv = vec3(-${ARM_X.toFixed(2)}, ${SHOULDER.toFixed(2)}, 0.0);
      p = rotX(p - piv, -cheer * 2.5) + piv;
      p.y += bob + jump;
    } else if (part < 2.5) {
      // RIGHT ARM: up on cheer, OR the solo wave when not cheering
      vec3 piv = vec3(${ARM_X.toFixed(2)}, ${SHOULDER.toFixed(2)}, 0.0);
      float raise = max(cheer * 2.5, wave * 2.0);
      p = rotX(p - piv, -raise) + piv;
      float wag = wave * sin(t * 10.0) * 0.4;
      p = rotY(p - piv, wag) + piv;
      p.y += bob + jump;
    } else {
      // HEAD region: bob/jump + turn to look around (pivot at the neck)
      vec3 neck = vec3(0.0, ${HEAD_Y.toFixed(2)}, 0.0);
      p = rotY(p - neck, look) + neck;
      p.y += bob + jump;
    }
    return p;
  }
`

function bodyMaterial(outline: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: outline ? THREE.BackSide : THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uInk: { value: new THREE.Color(0x2c2824) },
      uRamp: { value: toonRamp() },
      uLight: { value: new THREE.Vector3(0.4, 0.9, 0.3).normalize() },
    },
    vertexShader: /* glsl */ `
      attribute float aPart;
      attribute vec4 aSeed;
      attribute vec3 aColor;   // jersey PRIMARY
      attribute vec3 aColor2;  // jersey SECONDARY
      attribute float aPattern; // 0 solid · 1 stripes · 2 hoops
      uniform float uTime;
      uniform vec3 uLight;
      varying vec3 vColor;
      varying vec3 vColor2;
      varying float vPattern;
      varying float vPart;
      varying vec3 vLocal;   // pre-animation body position → drives the bands
      varying float vLit;
      ${ANIM}
      void main() {
        vec3 pos = emote(position, aPart, aSeed);
        vec3 nrm = normalize(mat3(instanceMatrix) * normal);
        ${outline
          ? '// push out along the normal for the crayon outline hull\n        pos += normal * 0.04;'
          : ''}
        vColor = aColor;
        vColor2 = aColor2;
        vPattern = aPattern;
        vPart = aPart;
        vLocal = position;
        vLit = clamp(dot(nrm, uLight), 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: outline
      ? /* glsl */ `
        uniform vec3 uInk;
        void main() { gl_FragColor = vec4(uInk, 1.0); }
      `
      : /* glsl */ `
        uniform sampler2D uRamp;
        varying vec3 vColor;
        varying vec3 vColor2;
        varying float vPattern;
        varying float vPart;
        varying vec3 vLocal;
        varying float vLit;
        void main() {
          vec3 base = vColor;
          // JERSEY pattern on the TORSO only (part 0, upper body region). Stripes
          // = vertical bands from local X; hoops = horizontal bands from local Y.
          if (vPart < 0.5 && vLocal.y > 0.44 && vLocal.y < 1.42) {
            if (vPattern > 1.5) {
              // hoops: 3 horizontal bands
              float b = step(0.5, fract(vLocal.y * 3.2));
              base = mix(base, vColor2, b);
            } else if (vPattern > 0.5) {
              // stripes: vertical bands
              float b = step(0.5, fract(vLocal.x * 3.5));
              base = mix(base, vColor2, b);
            }
          }
          float lit = texture2D(uRamp, vec2(clamp(0.35 + vLit * 0.6, 0.02, 0.98), 0.5)).r;
          gl_FragColor = vec4(base * mix(0.8, 1.0, lit), 1.0);
        }
      `,
  })
}

// a small face plate (cream box front) + two ink eyes, instanced onto the head,
// riding the same emote so eyes track the head turn/bob.
function faceGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const tag = (g: THREE.BufferGeometry, isEye: number): THREE.BufferGeometry => {
    const n = g.getAttribute('position').count
    const a = new Float32Array(n).fill(isEye)
    g.setAttribute('aEye', new THREE.BufferAttribute(a, 1))
    return g
  }
  // face plate: a thin cream box, pushed a touch PROUD of the body front so it
  // never z-fights / clips into the torso colour when the head turns.
  const plate = new THREE.BoxGeometry(0.5, 0.42, 0.05)
  plate.translate(0, 0.98, 0.4)
  parts.push(tag(plate, 0))
  for (const side of [-1, 1]) {
    const eye = new THREE.BoxGeometry(0.08, 0.16, 0.03)
    eye.translate(side * 0.11, 0.98, 0.43)
    parts.push(tag(eye, 1))
  }
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged
}

function faceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // bias the face toward the camera so it always wins over the body it sits on
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aEye;
      attribute vec4 aSeed;
      uniform float uTime;
      varying float vEye;
      varying float vBlink;
      ${ANIM}
      void main() {
        float t = uTime * (1.8 + aSeed.z * 1.4) + aSeed.x * 6.2831;
        vBlink = step(0.96, sin(t * 3.1 + aSeed.x * 18.0));
        vEye = aEye;
        vec3 pos = emote(position, ${PART_HEAD.toFixed(1)}, aSeed); // rides the head
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vEye;
      varying float vBlink;
      void main() {
        if (vEye > 0.5) {
          if (vBlink > 0.5) discard;          // eyes shut on a blink
          gl_FragColor = vec4(0.11, 0.10, 0.09, 1.0);
        } else {
          gl_FragColor = vec4(0.98, 0.96, 0.90, 1.0); // cream face plate
        }
      }
    `,
  })
}

const PATTERN_ID: Record<string, number> = { solid: 0, stripes: 1, hoops: 2 }

/** a large held BANNER (fabric quad + a pale stripe) waving gently in the crowd */
function bannerGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(2.6, 1.1, 6, 3)
  g.translate(0, 1.9, 0.15) // held up above the fans' heads
  return g
}
function bannerMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute vec3 aColor2;
      attribute vec4 aSeed;
      uniform float uTime;
      varying vec3 vColor;
      varying vec3 vColor2;
      varying vec2 vUv;
      void main() {
        float t = uTime * 1.2 + aSeed.x * 6.2831;
        vec3 p = position;
        // cloth ripple across the banner
        p.z += sin(position.x * 2.0 + t * 3.0) * 0.12 + sin(position.y * 3.0 + t * 2.0) * 0.05;
        p.y += sin(position.x * 1.5 + t * 2.5) * 0.06;
        vColor = aColor; vColor2 = aColor2; vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vColor2;
      varying vec2 vUv;
      void main() {
        // team banner: a bold colour field with a pale central stripe + border
        vec3 c = vColor;
        if (abs(vUv.y - 0.5) < 0.22) c = mix(c, vColor2, 0.85); // central band
        float border = step(0.04, vUv.x) * step(vUv.x, 0.96) * step(0.06, vUv.y) * step(vUv.y, 0.94);
        c = mix(vec3(0.14,0.12,0.11), c, border); // dark ink border
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
}

export function createCrowd(seats: readonly CrowdSeat[], fanKits: readonly KitColors[]): Crowd {
  const group = new THREE.Group()
  group.name = 'crowd'
  const count = seats.length

  const bodyGeo = beanGeometry()
  const faceGeo = faceGeometry()
  const fillMat = bodyMaterial(false)
  const outlineMat = bodyMaterial(true)
  const fMat = faceMaterial()

  const fill = new THREE.InstancedMesh(bodyGeo, fillMat, count)
  const outline = new THREE.InstancedMesh(bodyGeo, outlineMat, count)
  const faces = new THREE.InstancedMesh(faceGeo, fMat, count)
  for (const im of [fill, outline, faces]) im.frustumCulled = false
  outline.renderOrder = 0
  fill.renderOrder = 1
  faces.renderOrder = 2

  // BANNERS: a sparse set of fans hold up a large team banner. We pick roughly
  // 1 in 26 fans (deterministic by pick) to be a banner holder.
  const bannerIdx: number[] = [] // which fan holds each banner
  for (let i = 0; i < count; i++) if (((seats[i]!.pick * 331) % 1) < 0.015) bannerIdx.push(i)
  const bannerCount = Math.max(1, bannerIdx.length)
  const bannerGeo = bannerGeometry()
  const bannerMat = bannerMaterial()
  const banners = new THREE.InstancedMesh(bannerGeo, bannerMat, bannerCount)
  banners.frustumCulled = false
  banners.renderOrder = 2
  const bannerColor = new Float32Array(bannerCount * 3)
  const bannerColor2 = new Float32Array(bannerCount * 3)
  const bannerSeed = new Float32Array(bannerCount * 4)
  const bannerBase: THREE.Matrix4[] = []

  // per-instance transforms + seed + JERSEY (primary, secondary, pattern)
  const seed = new Float32Array(count * 4)
  const colorArr = new Float32Array(count * 3)
  const color2Arr = new Float32Array(count * 3)
  const patternArr = new Float32Array(count)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const c1 = new THREE.Color()
  const c2 = new THREE.Color()
  const picks: number[] = []
  const sections: number[] = [] // FIXED section 0..5 (6-way) each fan belongs to
  const baseMat: THREE.Matrix4[] = [] // each fan's full-size transform (for hide/show)
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
  const SECTIONS = 6

  const applyKit = (i: number, kit: KitColors): void => {
    c1.setHex(kit.primary)
    c2.setHex(kit.secondary)
    colorArr[i * 3] = c1.r
    colorArr[i * 3 + 1] = c1.g
    colorArr[i * 3 + 2] = c1.b
    color2Arr[i * 3] = c2.r
    color2Arr[i * 3 + 1] = c2.g
    color2Arr[i * 3 + 2] = c2.b
    patternArr[i] = PATTERN_ID[kit.pattern] ?? 0
  }

  const span0 = (Math.PI * 2) / SECTIONS
  for (let i = 0; i < count; i++) {
    const s = seats[i]!
    q.setFromAxisAngle(up, s.yaw)
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale))
    baseMat.push(m.clone())
    fill.setMatrixAt(i, m)
    outline.setMatrixAt(i, m)
    faces.setMatrixAt(i, m)
    seed[i * 4] = s.pick
    seed[i * 4 + 1] = (s.pick * 41.3) % 1
    seed[i * 4 + 2] = (s.pick * 7.7) % 1
    seed[i * 4 + 3] = (s.pick * 3.1) % 1
    applyKit(i, fanKits[Math.floor(s.pick * 997) % fanKits.length]!)
    picks.push(s.pick)
    // fixed section from the fan's angle (6-way, matching the max team count)
    sections.push(Math.floor(((s.angle + span0 / 2) % (Math.PI * 2)) / span0) % SECTIONS)
  }

  // place a banner above each holder fan (a bit bigger than the fan)
  for (let b = 0; b < bannerCount; b++) {
    const fi = bannerIdx[b] ?? 0
    const s = seats[fi]!
    q.setFromAxisAngle(up, s.yaw)
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(1.1, 1.1, 1.1))
    bannerBase.push(m.clone())
    banners.setMatrixAt(b, m)
    bannerSeed[b * 4] = s.pick
  }
  bannerGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(bannerSeed, 4))
  const bColorAttr = new THREE.InstancedBufferAttribute(bannerColor, 3)
  const bColor2Attr = new THREE.InstancedBufferAttribute(bannerColor2, 3)
  bannerGeo.setAttribute('aColor', bColorAttr)
  bannerGeo.setAttribute('aColor2', bColor2Attr)

  // set a fan visible (its base transform) or hidden (scaled to 0)
  const setShown = (i: number, shown: boolean): void => {
    const mm = shown ? baseMat[i]! : hidden
    fill.setMatrixAt(i, mm)
    outline.setMatrixAt(i, mm)
    faces.setMatrixAt(i, mm)
  }
  // a banner shows only if its holder's section team is present
  const setBanner = (b: number, kit: KitColors | undefined, shown: boolean): void => {
    banners.setMatrixAt(b, shown ? bannerBase[b]! : hidden)
    if (kit && shown) {
      const p = new THREE.Color(kit.primary)
      const s2 = new THREE.Color(kit.secondary)
      bannerColor.set([p.r, p.g, p.b], b * 3)
      bannerColor2.set([s2.r, s2.g, s2.b], b * 3)
    }
  }
  const seedAttr = new THREE.InstancedBufferAttribute(seed, 4)
  const colorAttr = new THREE.InstancedBufferAttribute(colorArr, 3)
  const color2Attr = new THREE.InstancedBufferAttribute(color2Arr, 3)
  const patternAttr = new THREE.InstancedBufferAttribute(patternArr, 1)
  bodyGeo.setAttribute('aSeed', seedAttr)
  bodyGeo.setAttribute('aColor', colorAttr)
  bodyGeo.setAttribute('aColor2', color2Attr)
  bodyGeo.setAttribute('aPattern', patternAttr)
  faceGeo.setAttribute('aSeed', seedAttr) // faces share the seed (ride the head)
  fill.instanceMatrix.needsUpdate = true
  outline.instanceMatrix.needsUpdate = true
  faces.instanceMatrix.needsUpdate = true
  group.add(outline, fill, faces, banners)

  return {
    group,
    // sectionKits[k] = the team wearing section k's stand (undefined = neutral).
    // sectionAlive[k] = is that team still IN the match? When a team is
    // eliminated, MOST of its fans LEAVE (seats empty); a few stay behind.
    setSections(
      sectionKits: readonly (KitColors | undefined)[],
      sectionAlive: readonly boolean[],
    ): void {
      for (let i = 0; i < count; i++) {
        const sec = sections[i]!
        const kit = sectionKits[sec]
        const alive = sectionAlive[sec] ?? true
        if (kit && alive && picks[i]! < 0.72) {
          applyKit(i, kit) // home supporter in the team's real jersey
          setShown(i, true)
        } else if (kit && !alive) {
          // team eliminated → this fan leaves, unless it's a stubborn ~15% that
          // stay on in a neutral kit to watch the rest of the match
          const stays = picks[i]! < 0.15
          setShown(i, stays)
          if (stays) applyKit(i, fanKits[Math.floor(picks[i]! * 997) % fanKits.length]!)
        } else {
          // neutral fan (no team here, or the scattered non-supporters)
          applyKit(i, fanKits[Math.floor(picks[i]! * 997) % fanKits.length]!)
          setShown(i, true)
        }
      }
      // banners: show only for present teams, coloured by that section's kit
      for (let b = 0; b < bannerCount; b++) {
        const sec = sections[bannerIdx[b] ?? 0] ?? 0
        const kit = sectionKits[sec]
        const alive = sectionAlive[sec] ?? true
        setBanner(b, kit ?? fanKits[b % fanKits.length]!, !kit || alive)
      }
      fill.instanceMatrix.needsUpdate = true
      outline.instanceMatrix.needsUpdate = true
      faces.instanceMatrix.needsUpdate = true
      banners.instanceMatrix.needsUpdate = true
      bColorAttr.needsUpdate = true
      bColor2Attr.needsUpdate = true
      colorAttr.needsUpdate = true
      color2Attr.needsUpdate = true
      patternAttr.needsUpdate = true
    },
    update(dt: number): void {
      const t = (fillMat.uniforms.uTime!.value as number) + dt
      fillMat.uniforms.uTime!.value = t
      outlineMat.uniforms.uTime!.value = t
      fMat.uniforms.uTime!.value = t
      bannerMat.uniforms.uTime!.value = t
    },
    dispose(): void {
      bodyGeo.dispose()
      faceGeo.dispose()
      fillMat.dispose()
      outlineMat.dispose()
      fMat.dispose()
      bannerGeo.dispose()
      bannerMat.dispose()
    },
  }
}
