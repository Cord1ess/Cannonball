import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
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
  /** fill each wedge's stand with its owner-seat's team colour (+ neutrals) */
  recolor(zoneCount: number, zoneColors: readonly number[]): void
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
    float look  = sin(t * 0.6 + seed.w * 6.2831) * 0.5;     // head turn L/R
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
      attribute vec3 aColor;
      uniform float uTime;
      uniform vec3 uLight;
      varying vec3 vColor;
      varying float vLit;
      ${ANIM}
      void main() {
        vec3 pos = emote(position, aPart, aSeed);
        vec3 nrm = normalize(mat3(instanceMatrix) * normal);
        ${outline
          ? '// push out along the normal for the crayon outline hull\n        pos += normal * 0.04;'
          : ''}
        vColor = aColor;
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
        varying float vLit;
        void main() {
          float lit = texture2D(uRamp, vec2(clamp(0.35 + vLit * 0.6, 0.02, 0.98), 0.5)).r;
          gl_FragColor = vec4(vColor * mix(0.8, 1.0, lit), 1.0);
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
  // face plate: a thin cream box on the front of the upper body (matches bean)
  const plate = new THREE.BoxGeometry(0.5, 0.42, 0.05)
  plate.translate(0, 0.98, 0.33)
  parts.push(tag(plate, 0))
  for (const side of [-1, 1]) {
    const eye = new THREE.BoxGeometry(0.08, 0.16, 0.03)
    eye.translate(side * 0.11, 0.98, 0.362)
    parts.push(tag(eye, 1))
  }
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged
}

function faceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
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

export function createCrowd(seats: readonly CrowdSeat[], fanColors: readonly number[]): Crowd {
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

  // per-instance transforms + seed + colour
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
    seed[i * 4 + 1] = (s.pick * 41.3) % 1
    seed[i * 4 + 2] = (s.pick * 7.7) % 1
    seed[i * 4 + 3] = (s.pick * 3.1) % 1
    col.setHex(fanColors[Math.floor(s.pick * 997) % fanColors.length]!)
    colorArr[i * 3] = col.r
    colorArr[i * 3 + 1] = col.g
    colorArr[i * 3 + 2] = col.b
    angles.push(s.angle)
    picks.push(s.pick)
  }
  const seedAttr = new THREE.InstancedBufferAttribute(seed, 4)
  const colorAttr = new THREE.InstancedBufferAttribute(colorArr, 3)
  bodyGeo.setAttribute('aSeed', seedAttr)
  bodyGeo.setAttribute('aColor', colorAttr)
  faceGeo.setAttribute('aSeed', seedAttr) // faces share the seed (ride the head)
  fill.instanceMatrix.needsUpdate = true
  outline.instanceMatrix.needsUpdate = true
  faces.instanceMatrix.needsUpdate = true
  group.add(outline, fill, faces)

  return {
    group,
    recolor(zoneCount: number, zoneColors: readonly number[]): void {
      const span = (Math.PI * 2) / Math.max(2, zoneCount)
      for (let i = 0; i < count; i++) {
        const zone = Math.floor(((angles[i]! + span / 2) % (Math.PI * 2)) / span) % Math.max(2, zoneCount)
        const home = zoneColors[zone]
        // home fans wear their team's jersey colour; a scatter stays neutral
        if (home !== undefined && picks[i]! < 0.68) col.setHex(home)
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
      fMat.uniforms.uTime!.value = t
    },
    dispose(): void {
      bodyGeo.dispose()
      faceGeo.dispose()
      fillMat.dispose()
      outlineMat.dispose()
      fMat.dispose()
    },
  }
}
