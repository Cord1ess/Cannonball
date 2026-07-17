import * as THREE from 'three'

/**
 * Wind streaks (M5): curved S-shaped ribbons that whiz LOW across the field
 * along the wind, so wind reads as a visible force. Each streak is a short
 * multi-segment strip that follows a travelling sine curve; they surge and
 * brighten on gusts. View-space billboarded so they never render edge-on.
 * Purely cosmetic — never touches the sim.
 */

const COUNT = 120
const SEGS = 10 // segments per streak ribbon (curve resolution)
const SPAN = 58 // streaks travel within a box this wide, centered on arena
const LEN = 7.0 // ribbon length in meters (along the wind)

export interface WindStreaks {
  readonly mesh: THREE.Object3D
  update(dt: number, windX: number, windZ: number, gust: number): void
  dispose(): void
}

export function createWindStreaks(): WindStreaks {
  // one ribbon = SEGS quads laid end to end along local X (0..1). Each vertex
  // carries its along-fraction in position.x and side in position.y (-0.5..0.5)
  const positions: number[] = []
  const along: number[] = []
  const side: number[] = []
  const indices: number[] = []
  for (let s = 0; s <= SEGS; s++) {
    const f = s / SEGS
    for (const sd of [-0.5, 0.5]) {
      positions.push(f, sd, 0)
      along.push(f)
      side.push(sd)
    }
    if (s < SEGS) {
      const b = s * 2
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
    }
  }
  const ribbon = new THREE.BufferGeometry()
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  ribbon.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
  ribbon.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1))
  ribbon.setIndex(indices)

  const geo = new THREE.InstancedBufferGeometry()
  geo.index = ribbon.index
  geo.setAttribute('position', ribbon.getAttribute('position'))
  geo.setAttribute('aAlong', ribbon.getAttribute('aAlong'))
  geo.setAttribute('aSide', ribbon.getAttribute('aSide'))
  geo.instanceCount = COUNT

  // per-streak: lateral offset, LOW height, along-phase, curve/jitter seed
  const seed = new Float32Array(COUNT * 4)
  for (let i = 0; i < COUNT; i++) {
    seed[i * 4] = (Math.random() - 0.5) * SPAN // lateral spread
    seed[i * 4 + 1] = 0.5 + Math.random() * 3.2 // LOW: within the field, near grass
    seed[i * 4 + 2] = Math.random() // along-travel phase
    seed[i * 4 + 3] = Math.random() // curve phase + length/alpha jitter
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uGust: { value: 0 },
      uSpan: { value: SPAN },
      uLen: { value: LEN },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      attribute float aAlong;
      attribute float aSide;
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uGust;
      uniform float uSpan;
      uniform float uLen;
      varying float vAlong;
      varying float vSide;
      varying float vAlpha;

      void main() {
        vAlong = aAlong;
        vSide = aSide;
        vec2 dir = normalize(uWind);
        vec2 perp = vec2(-dir.y, dir.x);

        // travel downwind, looping across the span; faster on gusts
        float speed = 8.0 + aSeed.w * 7.0 + uGust * 14.0;
        float head = mod(aSeed.z * uSpan + uTime * speed, uSpan) - uSpan * 0.5;

        // this vertex sits 'aAlong' back along the ribbon from the head
        float len = uLen * (0.7 + aSeed.w * 0.6 + uGust * 0.7);
        float alongDist = head - aAlong * len;

        // S-CURVE: the ribbon snakes side to side as it travels (a sine of the
        // along-position + time), amplitude swelling on gusts
        float curvePhase = alongDist * 0.55 + uTime * (2.0 + aSeed.w * 2.0) + aSeed.w * 6.2831;
        float amp = (0.9 + uGust * 1.6);
        float lateral = sin(curvePhase) * amp + sin(curvePhase * 0.5 + 1.3) * amp * 0.5;

        // ribbon width, tapering to points at both ends
        float taper = sin(aAlong * 3.14159);
        float wide = (0.18 + uGust * 0.14) * taper;

        // assemble in world XZ: forward along dir, snaking + width along perp
        vec2 xz = perp * aSeed.x + dir * alongDist + perp * (lateral + aSide * wide * 4.0);
        vec3 center = vec3(xz.x, aSeed.y + sin(curvePhase * 0.7) * 0.3, xz.y);

        // billboard the WIDTH toward the camera so the ribbon never vanishes
        vec4 centerView = modelViewMatrix * vec4(center, 1.0);
        gl_Position = projectionMatrix * centerView;

        float edge = 1.0 - smoothstep(0.4, 0.5, abs(alongDist) / uSpan);
        vAlpha = (0.4 + uGust * 0.5) * edge;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vAlong;
      varying float vSide;
      varying float vAlpha;
      void main() {
        // taper along the ribbon + soft across the width
        float body = sin(vAlong * 3.14159);
        float across = 1.0 - abs(vSide) * 2.0;
        float a = body * across * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(1.0, 1.0, 0.99, a);
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
      ribbon.dispose()
      material.dispose()
    },
  }
}
