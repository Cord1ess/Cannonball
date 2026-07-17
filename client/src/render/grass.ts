import * as THREE from 'three'
import { PALETTE } from './palette.ts'

/**
 * The pitch (M5): GPU-instanced stadium grass, technique learned from
 * achrefelouafi/GrassSystemThreeJS (single draw call, every blade placed,
 * curled and wind-animated in the vertex shader) but rebuilt for OUR flat
 * toon style and for gameplay:
 *
 * - one InstancedBufferGeometry, ~160k thin blades, 5 verts each — one draw
 * - LAYERED non-uniform wind: a slow base sway + big rolling gust fronts that
 *   sweep across the field + per-blade flutter, all scaled by tipness²
 * - INTERACTIVE: up to N bodies (players + ball) push blades radially away
 *   and flatten them — grass parts around anyone standing in it
 * - the ZONES live in the shader: chalk division lines, the neutral-circle
 *   ring, per-zone danger tint and concentric mow bands are all computed
 *   per blade from uniforms — a morph is a uniform write, nothing rebuilds
 * - crayon discipline: chalk lines wobble and grain like hand-drawn strokes,
 *   and every blade darkens toward its side edges — a drawn border, not a
 *   vector fill
 */

const MAX_ZONES = 6
const MAX_BODIES = 8

/** a body that pushes grass: world xz + radius (players ~0.5, ball ~2) */
export interface GrassBody {
  x: number
  z: number
  radius: number
  /** springy wobble 0..1 — raise while the body moves, let it decay to settle */
  wobble: number
}

export interface GrassField {
  readonly mesh: THREE.Mesh
  setZones(zoneCount: number, zoneColors: readonly number[]): void
  setDanger(fracs: readonly number[]): void
  /** feed the bodies that flatten grass this frame (players + ball) */
  setBodies(bodies: readonly GrassBody[]): void
  /** advance wind time + expose the current wind direction (for streaks) */
  update(time: number): { windX: number; windZ: number; gust: number }
  dispose(): void
}

const VERT = /* glsl */ `
  attribute vec4 aData;   // x, z, yaw, heightScale
  attribute vec2 aSeed;   // phase, colorVar

  uniform float uTime;
  uniform vec2 uWindDir;
  uniform vec4 uBodies[${MAX_BODIES}]; // x,y = xz pos · z = radius · w = wobble 0..1
  uniform int uBodyCount;

  varying float vT;         // 0 root .. 1 tip
  varying float vColorVar;
  varying vec2 vWorldXZ;
  varying float vEdge;      // 0 blade center .. 1 side edge (crayon border)
  varying float vFlat;      // 0 upright .. 1 flattened by a body

  void main() {
    float t = position.y;   // blade template stores height-fraction in Y
    vT = t;
    vColorVar = aSeed.y;
    vEdge = abs(position.x) / 0.05; // template half-width

    float yaw = aData.z;
    float c = cos(yaw);
    float s = sin(yaw);

    vec2 root = aData.xy;

    // template X is the blade's width axis — rotate into place
    vec3 p = vec3(position.x * c, t * aData.w, position.x * -s);

    // curl: lean the blade along its facing, quadratic with height
    float curl = (aSeed.y - 0.5) * 0.9;
    p.x += s * curl * t * t;
    p.z += c * curl * t * t;

    // --- LAYERED non-uniform wind ------------------------------------------
    // 1) slow base sway, coherent across the field
    float base = dot(root, uWindDir) * 0.05 + uTime * 0.7;
    float baseSway = sin(base) * 0.5 + sin(base * 0.37 + 1.1) * 0.3;
    // 2) big rolling GUST FRONTS: a low-frequency wave sweeping along the wind,
    //    so patches of the field surge together then calm — never uniform
    float gp = dot(root, uWindDir) * 0.09 - uTime * 1.1;
    float gustFront = smoothstep(0.2, 1.0, sin(gp) * 0.5 + 0.5); // 0..1 pulses
    float gustSway = sin(gp * 2.3 + root.x * 0.3) * gustFront;
    // 3) per-blade flutter (high freq, individual)
    float flutter = sin(uTime * 7.0 + aSeed.x * 6.2831) * 0.16;

    float sway = (baseSway * 0.13 + gustSway * 0.22 + flutter * 0.05) * t * t;
    p.xz += uWindDir * sway;

    // --- INTERACTIVE displacement (walking THROUGH grass) ------------------
    // Blades PART sideways around a body — a tight ring right at the contact,
    // not a flattened region. Only a whisker of height loss. As a body leaves,
    // disturbed blades SPRING back with a decaying wobble (uWobble drives it).
    // (note: 'flat' is a reserved GLSL keyword — never name a local that)
    float press = 0.0;
    float wobbleAmt = 0.0;
    for (int i = 0; i < ${MAX_BODIES}; i++) {
      if (i >= uBodyCount) break;
      vec2 d = root - uBodies[i].xy;
      float dist = length(d);
      float rad = uBodies[i].z;
      // tight falloff: full only within ~0.55*rad, gone by rad
      float infl = 1.0 - smoothstep(rad * 0.55, rad, dist);
      if (infl > 0.0) {
        vec2 push = (dist > 0.001 ? d / dist : vec2(1.0, 0.0));
        // part sideways, stronger toward the tip; barely any height loss
        p.xz += push * infl * 0.5 * t;
        p.y *= 1.0 - infl * 0.12 * t; // just a slight bow, not a mash
        press = max(press, infl);
        wobbleAmt = max(wobbleAmt, infl * uBodies[i].w);
      }
    }
    // springy recovery: while wobble>0 (a body is/was near and moving) the
    // blade bobs on a fast axis; wobble decays on the CPU so it settles
    float spring = sin(uTime * 15.0 + aSeed.x * 6.2831 + root.x * 0.7) * wobbleAmt;
    p.xz += uWindDir * spring * 0.18 * t;
    p.y += abs(spring) * 0.08 * t;
    vFlat = press;

    vec3 world = vec3(root.x + p.x, p.y, root.y + p.z);
    vWorldXZ = world.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uBase;
  uniform vec3 uTip;
  uniform vec3 uChalk;
  uniform float uZoneCount;
  uniform float uNeutralR;
  uniform float uRadius;
  uniform vec3 uZoneColors[${MAX_ZONES}];
  uniform float uDanger[${MAX_ZONES}];

  varying float vT;
  varying float vColorVar;
  varying vec2 vWorldXZ;
  varying float vEdge;
  varying float vFlat;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float r = length(vWorldXZ);

    // flat pastel gradient root->tip + per-blade scatter + soft base shade
    // (0.78 root: the value the user approved — do not "improve" this)
    vec3 col = mix(uBase, uTip, vT);
    col *= mix(0.78, 1.0, smoothstep(0.0, 0.45, vT));
    col *= mix(0.93, 1.07, vColorVar);

    // crayon border: each blade darkens toward its drawn side edges
    col *= 1.0 - smoothstep(0.45, 1.0, vEdge) * 0.2;

    float tau = 6.2831853;
    float span = tau / uZoneCount;
    float angle = mod(atan(vWorldXZ.y, vWorldXZ.x) + tau, tau);

    // hand wobble: every painted border drifts like a crayon stroke
    float wob = sin(angle * 21.0 + r * 2.3) * 0.6 + sin(angle * 8.0 - r * 4.1) * 0.4;
    float grain = hash(floor(vWorldXZ * 6.5)); // crayon grain speckle

    // concentric mow bands, edges wobbling too
    float band = step(2.4, mod(r + wob * 0.35, 4.8));
    col *= mix(0.95, 1.04, band);

    // which painted zone sector is this blade in?
    int zone = int(mod(floor(angle / span + 0.5), uZoneCount));

    // danger heat: the wedge blushes with its seat's color
    for (int i = 0; i < ${MAX_ZONES}; i++) {
      if (i == zone) col = mix(col, uZoneColors[i], 0.06 + uDanger[i] * 0.32);
    }

    // chalk: zone division lines + neutral ring — wobbly width, grainy fill
    float toBoundary = abs(mod(angle + span * 0.5, span) - span * 0.5) * r + wob * 0.1;
    float chalk = 1.0 - smoothstep(0.1, 0.28 + wob * 0.06, toBoundary);
    chalk *= step(uNeutralR, r); // lines start at the neutral circle
    chalk = max(chalk, 1.0 - smoothstep(0.12, 0.32, abs(r - uNeutralR + wob * 0.12)));
    chalk *= 0.62 + 0.38 * grain; // the stroke breathes, never a vector fill
    col = mix(col, uChalk, chalk * 0.92);

    // the neutral disc counts for nobody: pale, worn turf (wobbly rim)
    float neutral = 1.0 - smoothstep(uNeutralR - 0.2 + wob * 0.12, uNeutralR + 0.1 + wob * 0.12, r);
    col = mix(col, vec3(0.92, 0.9, 0.81), neutral * 0.4);

    // trodden blades read a touch darker (pressed, in shadow)
    col *= 1.0 - vFlat * 0.22;

    gl_FragColor = vec4(col, 1.0);
  }
`

export function createGrassField(radius: number, neutralRadius: number, blades = 160000): GrassField {
  // blade template: two side pairs + a pointed tip; Y carries height-fraction.
  // half-width must match the vertex shader's vEdge normalization (0.05)
  const template = new THREE.BufferGeometry()
  const w = 0.05
  template.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-w, 0, 0, w, 0, 0, -w * 0.62, 0.55, 0, w * 0.62, 0.55, 0, 0, 1, 0],
      3,
    ),
  )
  template.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4])

  const geo = new THREE.InstancedBufferGeometry()
  geo.index = template.index
  geo.setAttribute('position', template.getAttribute('position'))
  geo.instanceCount = blades

  const data = new Float32Array(blades * 4)
  const seed = new Float32Array(blades * 2)
  for (let i = 0; i < blades; i++) {
    // uniform disc distribution: r = R * sqrt(u)
    const a = Math.random() * Math.PI * 2
    const r = radius * Math.sqrt(Math.random()) * 0.995
    data[i * 4] = Math.cos(a) * r
    data[i * 4 + 1] = Math.sin(a) * r
    data[i * 4 + 2] = Math.random() * Math.PI * 2
    data[i * 4 + 3] = 0.36 + Math.random() * 0.3 // blade height in meters
    seed[i * 2] = Math.random()
    seed[i * 2 + 1] = Math.random()
  }
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4))
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2))

  const windDir = new THREE.Vector2(0.8, 0.6).normalize()
  const bodies = Array.from({ length: MAX_BODIES }, () => new THREE.Vector4(0, 0, 0, 0))
  const zoneColors = Array.from({ length: MAX_ZONES }, () => new THREE.Color(PALETTE.grassBase))
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uWindDir: { value: windDir },
      uBase: { value: new THREE.Color(PALETTE.grassBase) },
      uTip: { value: new THREE.Color(PALETTE.grassTip) },
      uChalk: { value: new THREE.Color(PALETTE.chalk) },
      uZoneCount: { value: 6 },
      uNeutralR: { value: neutralRadius },
      uRadius: { value: radius },
      uZoneColors: { value: zoneColors },
      uDanger: { value: new Array(MAX_ZONES).fill(0) },
      uBodies: { value: bodies },
      uBodyCount: { value: 0 },
    },
  })

  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false // one field, always on screen

  return {
    mesh,
    setZones(zoneCount: number, colors: readonly number[]): void {
      material.uniforms.uZoneCount!.value = Math.max(2, zoneCount)
      for (let i = 0; i < MAX_ZONES; i++) {
        zoneColors[i]!.setHex(colors[i] ?? PALETTE.grassBase)
      }
    },
    setDanger(fracs: readonly number[]): void {
      const danger = material.uniforms.uDanger!.value as number[]
      for (let i = 0; i < MAX_ZONES; i++) danger[i] = Math.min(1, fracs[i] ?? 0)
    },
    setBodies(list: readonly GrassBody[]): void {
      const n = Math.min(MAX_BODIES, list.length)
      for (let i = 0; i < n; i++) {
        const b = list[i]!
        bodies[i]!.set(b.x, b.z, b.radius, b.wobble)
      }
      material.uniforms.uBodyCount!.value = n
    },
    update(time: number): { windX: number; windZ: number; gust: number } {
      material.uniforms.uTime!.value = time
      // report the gust envelope at the field center so streaks pulse with it
      const gp = -time * 1.1
      const gust = Math.max(0, Math.sin(gp) * 0.5 + 0.5)
      return { windX: windDir.x, windZ: windDir.y, gust }
    },
    dispose(): void {
      geo.dispose()
      template.dispose()
      material.dispose()
    },
  }
}
