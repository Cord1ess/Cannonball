import * as THREE from 'three'

/**
 * Wind streaks (M5): faint white dashes drifting through the air along the
 * wind direction, so the wind reads as a visible force, not invisible air.
 * One instanced draw of short line-quads; they loop across the pitch and
 * brighten on gust fronts. Purely cosmetic — never touches the sim.
 */

const COUNT = 90
const SPAN = 62 // streaks live in a box this wide, centered on the arena
const LEN = 3.2 // dash length in meters

export interface WindStreaks {
  readonly mesh: THREE.Object3D
  /** dir = wind unit vector, gust 0..1 from the grass field */
  update(dt: number, windX: number, windZ: number, gust: number): void
  dispose(): void
}

export function createWindStreaks(): WindStreaks {
  // a thin horizontal quad, pivot at its trailing end, pointing down +X
  const quad = new THREE.PlaneGeometry(1, 0.05)
  quad.translate(0.5, 0, 0) // pivot at the tail
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.setAttribute('uv', quad.getAttribute('uv'))
  geo.instanceCount = COUNT

  // per-streak: base position (xz), height y, phase along travel, alpha jitter
  const seed = new Float32Array(COUNT * 4)
  for (let i = 0; i < COUNT; i++) {
    seed[i * 4] = (Math.random() - 0.5) * SPAN
    seed[i * 4 + 1] = 1.5 + Math.random() * 7 // hover above the pitch
    seed[i * 4 + 2] = (Math.random() - 0.5) * SPAN
    seed[i * 4 + 3] = Math.random() // per-streak phase + length/alpha jitter
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uGust: { value: 0 },
      uSpan: { value: SPAN },
      uLen: { value: LEN },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uGust;
      uniform float uSpan;
      uniform float uLen;
      varying vec2 vUv;
      varying float vAlpha;

      void main() {
        vUv = uv;
        // travel along the wind, looping across the span
        float speed = 6.0 + aSeed.w * 5.0 + uGust * 9.0;
        float travel = uTime * speed + aSeed.w * uSpan;
        float along = mod(travel, uSpan) - uSpan * 0.5;
        vec2 base = aSeed.xz;
        // move the whole start point downwind, plus the looping offset
        vec2 pos2 = base + uWind * along;
        // wrap within the box so streaks don't fly off forever
        pos2 = mod(pos2 + uSpan * 0.5, uSpan) - uSpan * 0.5;

        // orient the dash along the wind; length pulses with gust
        vec2 dir = normalize(uWind);
        vec2 perp = vec2(-dir.y, dir.x);
        float len = uLen * (0.6 + aSeed.w * 0.5 + uGust * 0.7);
        vec3 local = vec3(pos2.x, aSeed.y, pos2.y)
          + dir.x * position.x * len * vec3(1.0, 0.0, 0.0)
          + dir.y * position.x * len * vec3(0.0, 0.0, 1.0)
          + perp.x * position.y * vec3(1.0, 0.0, 0.0)
          + perp.y * position.y * vec3(0.0, 0.0, 1.0);

        vAlpha = 0.10 + uGust * 0.28;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        // taper the dash to points at both ends, soft across its width
        float head = smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.7, 1.0, vUv.x));
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float a = head * across * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(1.0, 1.0, 0.98, a);
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
      quad.dispose()
      material.dispose()
    },
  }
}
