import * as THREE from 'three'
import { PALETTE } from './palette.ts'

/**
 * Wind streaks (M5): PHYSICAL 3D curved tubes that whiz across the field along
 * the wind. Each is a real round tube bent into an S, so it reads from ANY
 * camera angle — no flat billboards that vanish edge-on. Simple toon-flat
 * shading (2-step ramp against a fixed light) so it sits in our art style.
 * Deliberately few, up off the grass. Animated entirely on the GPU. Cosmetic.
 */

const COUNT = 22 // few, legible
const RINGS = 26 // segments along each tube
const RADIAL = 5 // sides of the tube cross-section
const TUBE_R = 0.11 // tube thickness in meters
const LEN = 9.0 // tube length along the wind
const SPAN = 54 // travel box, centered on the arena

export interface WindStreaks {
  readonly mesh: THREE.Object3D
  update(dt: number, windX: number, windZ: number, gust: number): void
  dispose(): void
}

export function createWindStreaks(): WindStreaks {
  // canonical tube: runs along +X in [0..1], unit-circle cross-section in YZ.
  const posArr: number[] = []
  const ringArr: number[] = []
  const angArr: number[] = []
  const idx: number[] = []
  for (let s = 0; s <= RINGS; s++) {
    const f = s / RINGS
    for (let r = 0; r < RADIAL; r++) {
      const a = (r / RADIAL) * Math.PI * 2
      posArr.push(f, Math.cos(a), Math.sin(a))
      ringArr.push(f)
      angArr.push(a)
    }
  }
  for (let s = 0; s < RINGS; s++) {
    for (let r = 0; r < RADIAL; r++) {
      const a = s * RADIAL + r
      const b = s * RADIAL + ((r + 1) % RADIAL)
      const c = (s + 1) * RADIAL + r
      const d = (s + 1) * RADIAL + ((r + 1) % RADIAL)
      idx.push(a, c, b, b, c, d)
    }
  }
  const tube = new THREE.BufferGeometry()
  tube.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3))
  tube.setAttribute('aRing', new THREE.Float32BufferAttribute(ringArr, 1))
  tube.setAttribute('aAng', new THREE.Float32BufferAttribute(angArr, 1))
  tube.setIndex(idx)

  const geo = new THREE.InstancedBufferGeometry()
  geo.index = tube.index
  geo.setAttribute('position', tube.getAttribute('position'))
  geo.setAttribute('aRing', tube.getAttribute('aRing'))
  geo.setAttribute('aAng', tube.getAttribute('aAng'))
  geo.instanceCount = COUNT

  const seed = new Float32Array(COUNT * 4)
  for (let i = 0; i < COUNT; i++) {
    seed[i * 4] = (Math.random() - 0.5) * SPAN
    seed[i * 4 + 1] = 3.5 + Math.random() * 5.0 // higher up off the grass
    seed[i * 4 + 2] = Math.random()
    seed[i * 4 + 3] = Math.random()
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uGust: { value: 0 },
      uSpan: { value: SPAN },
      uLen: { value: LEN },
      uTubeR: { value: TUBE_R },
      uColor: { value: new THREE.Color(0xffffff) },
      uShade: { value: new THREE.Color(PALETTE.skyTeal) },
      uLight: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    } as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      attribute float aRing;
      attribute float aAng;
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uGust;
      uniform float uSpan;
      uniform float uLen;
      uniform float uTubeR;
      varying float vFade;
      varying vec3 vNormal;

      void main() {
        vec2 dir = normalize(uWind);
        vec2 perp = vec2(-dir.y, dir.x);

        float speed = 6.0 + aSeed.w * 4.0 + uGust * 9.0;
        float head = mod(aSeed.z * uSpan + uTime * speed, uSpan) - uSpan * 0.5;
        float len = uLen * (0.8 + uGust * 0.5);

        // TWO spine samples (this ring + a step ahead) to get a real tangent —
        // avoids the degenerate frame that made tubes explode into black smears
        float d0 = head - aRing * len;
        float d1 = head - (aRing + 0.02) * len;
        float amp = 1.2 + uGust * 1.8;
        vec2 s0 = perp * aSeed.x + dir * d0 + perp * (sin(d0*0.5 + uTime*(1.6+aSeed.w*1.4) + aSeed.w*6.28)*amp);
        vec2 s1 = perp * aSeed.x + dir * d1 + perp * (sin(d1*0.5 + uTime*(1.6+aSeed.w*1.4) + aSeed.w*6.28)*amp);
        float y0 = aSeed.y + sin(d0*0.7)*0.6;
        float y1 = aSeed.y + sin(d1*0.7)*0.6;
        vec3 p0 = vec3(s0.x, y0, s0.y);
        vec3 p1 = vec3(s1.x, y1, s1.y);

        vec3 tangent = normalize(p1 - p0);
        // robust frame: pick an up that's never parallel to tangent
        vec3 ref = abs(tangent.y) > 0.9 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0);
        vec3 nrm = normalize(cross(tangent, ref));
        vec3 bin = normalize(cross(tangent, nrm));

        float rr = uTubeR * (1.0 + uGust * 0.4);
        vec3 ringN = nrm * cos(aAng) + bin * sin(aAng);
        vec3 world = p0 + ringN * rr;
        vNormal = ringN;

        float endFade = 1.0 - smoothstep(0.4, 0.5, abs(d0) / uSpan);
        float tip = sin(aRing * 3.14159);
        vFade = endFade * tip;

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform vec3 uShade;
      uniform vec3 uLight;
      varying float vFade;
      varying vec3 vNormal;
      void main() {
        // 2-step toon shade between lit color and cool shadow
        float nl = dot(normalize(vNormal), normalize(uLight)) * 0.5 + 0.5;
        float step2 = nl > 0.55 ? 1.0 : 0.72;
        vec3 col = mix(uShade, uColor, step2);
        float a = clamp(vFade, 0.0, 1.0) * 0.92;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  })

  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 5

  let elapsed = 0
  return {
    mesh,
    update(dt, windX, windZ, gust): void {
      elapsed += dt
      material.uniforms.uTime!.value = elapsed
      ;(material.uniforms.uWind!.value as THREE.Vector2).set(windX, windZ)
      material.uniforms.uGust!.value = gust
    },
    dispose(): void {
      geo.dispose()
      tube.dispose()
      material.dispose()
    },
  }
}
