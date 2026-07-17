import * as THREE from 'three'

/**
 * Wind streaks (M5): white dashes streaking through the air along the wind
 * direction so wind reads as a visible force, not invisible air. One instanced
 * draw of billboarded dash-quads that loop across the pitch; they surge and
 * brighten on gust fronts. Purely cosmetic — never touches the sim.
 */

const COUNT = 140
const SPAN = 60 // streaks live in a box this wide, centered on the arena
const LEN = 4.0 // dash length in meters

export interface WindStreaks {
  readonly mesh: THREE.Object3D
  /** dir = wind unit vector, gust 0..1 from the grass field */
  update(dt: number, windX: number, windZ: number, gust: number): void
  dispose(): void
}

export function createWindStreaks(): WindStreaks {
  // unit quad spanning x:0..1 (length axis), y:-0.5..0.5 (thin width)
  const quad = new THREE.PlaneGeometry(1, 1)
  quad.translate(0.5, 0, 0) // origin at the dash tail; grows down +X
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.setAttribute('uv', quad.getAttribute('uv'))
  geo.instanceCount = COUNT

  // per-streak: lateral offset, height, along-phase, jitter
  const seed = new Float32Array(COUNT * 4)
  for (let i = 0; i < COUNT; i++) {
    seed[i * 4] = (Math.random() - 0.5) * SPAN // lateral spread across wind
    seed[i * 4 + 1] = 0.8 + Math.random() * 9 // height above the pitch
    seed[i * 4 + 2] = Math.random() // along-travel phase 0..1
    seed[i * 4 + 3] = Math.random() // length/alpha jitter
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
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uGust;
      uniform float uSpan;
      uniform float uLen;
      varying vec2 vUv;
      varying float vAlpha;

      void main() {
        vUv = uv;
        vec2 dir = normalize(uWind);
        vec2 perp = vec2(-dir.y, dir.x);

        // travel downwind, looping across the span; faster on gusts
        float speed = 7.0 + aSeed.w * 6.0 + uGust * 12.0;
        float along = mod(aSeed.z * uSpan + uTime * speed, uSpan) - uSpan * 0.5;
        // dash center in world: lateral offset along perp, advanced downwind
        vec2 base = perp * aSeed.x + dir * along;
        vec3 center = vec3(base.x, aSeed.y, base.y);

        float len = uLen * (0.7 + aSeed.w * 0.6 + uGust * 0.8);
        float wide = 0.10 + uGust * 0.08;

        // BILLBOARD: build the quad in VIEW space so a flat dash always faces
        // the camera (the old world-flat quads were seen edge-on and vanished).
        // Length axis = the wind direction projected into view; width = screen up.
        vec4 centerView = modelViewMatrix * vec4(center, 1.0);
        vec3 dirView = normalize((modelViewMatrix * vec4(dir.x, 0.0, dir.y, 0.0)).xyz);
        vec3 upView = normalize(cross(dirView, vec3(0.0, 0.0, 1.0)));
        vec3 offset = dirView * (position.x * len) + upView * (position.y * wide * 4.0);
        vec4 viewPos = centerView + vec4(offset, 0.0);

        float edge = 1.0 - smoothstep(0.42, 0.5, abs(along) / uSpan);
        vAlpha = (0.45 + uGust * 0.5) * edge;

        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        // taper to points at both ends of the dash, soft across the width
        float head = smoothstep(0.0, 0.3, vUv.x) * (1.0 - smoothstep(0.65, 1.0, vUv.x));
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float a = head * across * across * vAlpha;
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
      quad.dispose()
      material.dispose()
    },
  }
}
