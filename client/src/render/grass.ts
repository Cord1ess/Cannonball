import * as THREE from 'three'
import { PALETTE } from './palette.ts'

/**
 * The pitch (M5): GPU-instanced stadium grass, technique learned from
 * achrefelouafi/GrassSystemThreeJS (single draw call, every blade placed,
 * curled and wind-animated in the vertex shader) but rebuilt for OUR flat
 * toon style and for gameplay:
 *
 * - one InstancedBufferGeometry, ~60k blades, 5 verts each — one draw call
 * - coherent gust flow + per-blade flutter, sway scaled by tipness²
 * - the ZONES live in the shader: chalk division lines, the neutral-circle
 *   ring, per-zone danger tint and concentric mow bands are all computed
 *   per blade from uniforms — a morph is a uniform write, nothing rebuilds
 */

const MAX_ZONES = 6

export interface GrassField {
  readonly mesh: THREE.Mesh
  setZones(zoneCount: number, zoneColors: readonly number[]): void
  setDanger(fracs: readonly number[]): void
  update(time: number): void
  dispose(): void
}

const VERT = /* glsl */ `
  attribute vec4 aData;   // x, z, yaw, heightScale
  attribute vec2 aSeed;   // phase, colorVar

  uniform float uTime;
  uniform vec2 uWindDir;

  varying float vT;         // 0 root .. 1 tip
  varying float vColorVar;
  varying vec2 vWorldXZ;

  void main() {
    float t = position.y;   // blade template stores height-fraction in Y
    vT = t;
    vColorVar = aSeed.y;

    float yaw = aData.z;
    float c = cos(yaw);
    float s = sin(yaw);

    // template X is the blade's width axis — rotate into place
    vec3 p = vec3(position.x * c, t * aData.w, position.x * -s);

    // curl: lean the blade along its facing, quadratic with height
    float curl = (aSeed.y - 0.5) * 0.9;
    p.x += s * curl * t * t;
    p.z += c * curl * t * t;

    // wind: coherent world-space gust flow + per-blade flutter (tipness²)
    float gph = dot(aData.xy, uWindDir) * 0.14 + uTime * 1.35;
    float gust = sin(gph) * 0.6 + sin(gph * 0.47 + 1.7) * 0.4;
    float flutter = sin(uTime * 7.0 + aSeed.x * 6.2831) * 0.16;
    float sway = (gust * 0.16 + flutter * 0.05) * t * t;
    p.xz += uWindDir * sway;

    vec3 world = vec3(aData.x + p.x, p.y, aData.y + p.z);
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

  void main() {
    float r = length(vWorldXZ);

    // flat toon gradient root->tip + per-blade brightness scatter + base AO
    vec3 col = mix(uBase, uTip, vT);
    col *= mix(0.92, 1.08, vColorVar);
    col *= mix(0.62, 1.0, smoothstep(0.0, 0.45, vT));

    // concentric mow bands, like a real groundskeeper drives
    float band = step(2.4, mod(r, 4.8));
    col *= mix(0.94, 1.045, band);

    // which painted zone sector is this blade in?
    float tau = 6.2831853;
    float span = tau / uZoneCount;
    float angle = mod(atan(vWorldXZ.y, vWorldXZ.x) + tau, tau);
    int zone = int(mod(floor(angle / span + 0.5), uZoneCount));

    // danger heat: the wedge blushes with its seat's color
    for (int i = 0; i < ${MAX_ZONES}; i++) {
      if (i == zone) col = mix(col, uZoneColors[i], 0.06 + uDanger[i] * 0.34);
    }

    // chalk: zone division lines (constant world width) + neutral ring
    float toBoundary = abs(mod(angle + span * 0.5, span) - span * 0.5) * r;
    float chalk = 1.0 - smoothstep(0.14, 0.3, toBoundary);
    chalk *= step(uNeutralR, r); // lines start at the neutral circle
    chalk = max(chalk, 1.0 - smoothstep(0.16, 0.34, abs(r - uNeutralR)));
    col = mix(col, uChalk, chalk * 0.9);

    // the neutral disc counts for nobody: pale, worn turf
    col = mix(col, vec3(0.91, 0.89, 0.8), (1.0 - step(uNeutralR, r)) * 0.42);

    gl_FragColor = vec4(col, 1.0);
  }
`

export function createGrassField(radius: number, neutralRadius: number, blades = 60000): GrassField {
  // blade template: two side pairs + a pointed tip; Y carries height-fraction
  const template = new THREE.BufferGeometry()
  const w = 0.085
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
    data[i * 4 + 3] = 0.42 + Math.random() * 0.34 // blade height in meters
    seed[i * 2] = Math.random()
    seed[i * 2 + 1] = Math.random()
  }
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4))
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2))

  const zoneColors = Array.from({ length: MAX_ZONES }, () => new THREE.Color(PALETTE.grassBase))
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
      uBase: { value: new THREE.Color(PALETTE.grassBase) },
      uTip: { value: new THREE.Color(PALETTE.grassTip) },
      uChalk: { value: new THREE.Color(PALETTE.chalk) },
      uZoneCount: { value: 6 },
      uNeutralR: { value: neutralRadius },
      uRadius: { value: radius },
      uZoneColors: { value: zoneColors },
      uDanger: { value: new Array(MAX_ZONES).fill(0) },
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
    update(time: number): void {
      material.uniforms.uTime!.value = time
    },
    dispose(): void {
      geo.dispose()
      template.dispose()
      material.dispose()
    },
  }
}
