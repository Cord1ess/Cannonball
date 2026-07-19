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
const MAX_GUSTS = 6

/** a body that pushes grass: world xz + radius (players ~0.5, ball ~2) */
export interface GrassBody {
  x: number
  z: number
  radius: number
  /** springy wobble 0..1 — raise while the body moves, let it decay to settle */
  wobble: number
}

/** a travelling gust cell: world center + radius + strength + travel dir */
export interface GustCell {
  x: number
  z: number
  radius: number
  strength: number
  /** unit travel direction of this gust (curves around the stadium) */
  dirX: number
  dirZ: number
}

export interface GrassField {
  readonly mesh: THREE.Mesh
  setZones(zoneCount: number, zoneColors: readonly number[]): void
  setDanger(fracs: readonly number[]): void
  /** blink a zone red (ball in your own wedge); zone=-1 off, pulse 0..1 */
  setAlarm(zone: number, pulse: number): void
  /** day->night arc for the pitch (unlit): 0 = day .. 1 = night */
  setNight(frac: number): void
  /** feed the bodies that flatten grass this frame (players + ball) */
  setBodies(bodies: readonly GrassBody[]): void
  /** feed the active localized gust cells this frame */
  setGusts(gusts: readonly GustCell[]): void
  /** advance the grass; windDir sets the gust bend direction */
  update(time: number, windX: number, windZ: number): void
  dispose(): void
}

const VERT = /* glsl */ `
  #include <common>
  #include <shadowmap_pars_vertex>

  attribute vec4 aData;   // x, z, yaw, heightScale
  attribute vec2 aSeed;   // phase, colorVar

  uniform float uTime;
  uniform vec2 uWindDir;
  uniform vec4 uGusts[${MAX_GUSTS}]; // x,y = xz center · z = radius · w = strength
  uniform vec2 uGustDir[${MAX_GUSTS}]; // per-gust travel direction (curved path)
  uniform int uGustCount;
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

    // --- wind = BREATHING ambient sway + large feathered gust cells --------
    // 1) ambient sway — STRONGER so the idle field visibly breathes: a slow
    //    swell envelope + layered waves + per-blade jitter (never a clean sine)
    float breath = 0.5 + 0.5 * sin(uTime * 0.3 + root.x * 0.03); // 0..1 slow swell
    float amb = uTime * 1.15 + root.x * 0.14 + root.y * 0.1;
    float ambSway = sin(amb) * 0.6 + sin(amb * 0.41 + 1.7) * 0.45 + sin(amb * 1.9 + 0.6) * 0.22;
    float jitter = sin(uTime * 5.0 + aSeed.x * 25.13) * 0.55 + sin(uTime * 3.1 + aSeed.x * 11.7) * 0.4;
    float ambAmt = (0.2 + breath * 0.22) + ambSway * (0.26 + breath * 0.18) + jitter * 0.08;
    p.xz += uWindDir * ambAmt * t * t;

    // 2) GUST CELLS: large, FEATHERED fronts that roll along a curved arc. The
    //    falloff is a soft gaussian (no hard core → no "sharp object" look),
    //    with a per-blade noisy edge so the gust boundary is ragged/organic,
    //    and the push follows each gust's own travel direction (uGustDir).
    for (int gi = 0; gi < ${MAX_GUSTS}; gi++) {
      if (gi >= uGustCount) break;
      vec2 gc = uGusts[gi].xy;
      float grad = uGusts[gi].z;
      float gstr = uGusts[gi].w;
      vec2 gDir = uGustDir[gi];
      // delay: compare a bit upwind (of THIS gust) so the push trails its front
      vec2 delayed = root - gDir * grad * 0.3;
      float gd = distance(delayed, gc);
      // ragged edge: wander the effective distance per-blade so the front is
      // feathered/organic, not a clean circle
      float gf = float(gi);
      float edgeNoise = sin(root.x * 0.5 + gf * 2.1) * 0.14 + sin(root.y * 0.6 - gf * 1.3) * 0.12;
      float nd = gd / (grad * (1.0 + edgeNoise));
      // gaussian with a firmer body (feathered edge kept via the ragged nd):
      // tighter exponent so the gust has a defined core, not a flat wash
      float infl = exp(-nd * nd * 2.6) * gstr;
      if (infl > 0.003) {
        // per-blade TURBULENCE so blades thrash/ripple through the gust rather
        // than all lying down uniformly — a fast flutter + a travelling ripple
        float turb = sin(uTime * 11.0 + aSeed.x * 40.0) * 0.35
                   + sin(dot(delayed, gDir) * 0.9 - uTime * 5.0) * 0.4;
        float bend = infl * 1.5 * (0.75 + 0.45 * turb) * t * t;
        p.xz += gDir * bend;
        p.y *= 1.0 - infl * 0.18 * t;
      }
    }

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

    // shadow reception: shadowmap_vertex needs a world-space vec4 in scope.
    // our verts are ALREADY world-space (mesh has identity transform), so this
    // is world directly — it fills vDirectionalShadowCoord[] for the fragment.
    vec4 worldPosition = vec4(world, 1.0);
    #include <shadowmap_vertex>

    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`

const FRAG = /* glsl */ `
  #include <common>
  #include <packing>
  #include <lights_pars_begin>        // declares 'uniform bool receiveShadow'
  #include <shadowmap_pars_fragment>  // directionalShadowMap + getShadow
  #include <shadowmask_pars_fragment> // getShadowMask()

  uniform vec3 uBase;
  uniform vec3 uTip;
  uniform vec3 uChalk;
  uniform float uZoneCount;
  uniform float uNeutralR;
  uniform float uRadius;
  uniform vec3 uZoneColors[${MAX_ZONES}];
  uniform float uDanger[${MAX_ZONES}];
  uniform float uAlarmZone; // -1 = none, else the zone index that blinks
  uniform float uAlarmPulse; // 0..1 blink phase
  uniform float uNight; // 0 = day .. 1 = night (grass is unlit → tint here)

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

    // OWNERSHIP: each wedge takes a clear tint of its owner's team color so
    // you always know whose zone you're standing in. On top, DANGER scorches
    // it toward red as that wedge's meter fills. (This intentional tint is
    // NOT the old bug — that was a stray team-color floor on the danger mix;
    // this is a deliberate, readable ownership signal.)
    vec3 ownerCol = uBase;
    float danger = 0.0;
    for (int i = 0; i < ${MAX_ZONES}; i++) {
      if (i == zone) { ownerCol = uZoneColors[i]; danger = uDanger[i]; }
    }
    // stronger toward the wall, fading to plain grass near the neutral disc,
    // so the center stays clean and the tint reads as "this side is theirs"
    float ownEdge = smoothstep(uNeutralR, uRadius * 0.9, r);
    // ownership tint kept SUBTLE — big wedges (few players left) would otherwise
    // read as a fully-coloured half from the spectate overview
    col = mix(col, ownerCol, 0.1 * ownEdge);
    col = mix(col, vec3(0.82, 0.20, 0.16), danger * 0.4);

    // ALARM: when the ball is in the LOCAL player's own zone, that whole wedge
    // BLINKS bright red so it's impossible to miss "get the ball out of here".
    if (uAlarmZone >= 0.0 && float(zone) == uAlarmZone) {
      col = mix(col, vec3(0.95, 0.15, 0.12), uAlarmPulse * 0.6 * (0.3 + ownEdge * 0.7));
    }

    // chalk: zone division lines + neutral ring — wobbly width, grainy fill.
    // The BOUNDARY between zone i and i+1 is at (i+0.5)*span (zones are
    // CENTERED on k*span, matching footprintZone's round(angle/span)). So the
    // line sits where mod(angle, span) is near span*0.5 — NOT k*span, which
    // would draw straight through each zone's middle (the old bug).
    float toBoundary = abs(mod(angle, span) - span * 0.5) * r + wob * 0.1;
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

    // CAST SHADOWS: one shadow-map read per fragment (no per-blade cost, grass
    // never self-casts). Beans/ball/props darken the turf they stand on. The
    // sun's arc rotates + lengthens these across the match. Softened so the
    // stylised pitch never goes muddy — a gentle contact darkening, not black.
    float shadowMask = getShadowMask();
    col *= mix(1.0, shadowMask, 0.45);

    // NIGHT: the pitch is FLOODLIT by the tower spotlights at night. The grass is
    // unlit (its own shader), so it keeps a warm floodlit tone here — a touch
    // cooler + slightly deeper than day, but clearly LIT (not dark). The real
    // spotlights do the directional lighting + shadows on the beans and ball.
    // The pitch goes DARK as night falls (dusk), then when the floodlights snap
    // on (uNight past the switch point) it becomes bright floodlit turf — one
    // definitive change, matching the tower lights turning on.
    if (uNight > 0.001) {
      vec3 dusk = col * vec3(0.34, 0.42, 0.56); // dim dark turf before the lights
      col = mix(col, dusk, uNight);
      float lights = smoothstep(0.86, 0.94, uNight); // floodlights switch on here
      vec3 flood = mix(uBase, uTip, vT) * vec3(0.95, 1.02, 0.9) * (0.72 + 0.28 * vT);
      col = mix(col, flood, lights);
    }

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
  const gusts = Array.from({ length: MAX_GUSTS }, () => new THREE.Vector4(0, 0, 0, 0))
  const gustDirs = Array.from({ length: MAX_GUSTS }, () => new THREE.Vector2(1, 0))
  const zoneColors = Array.from({ length: MAX_ZONES }, () => new THREE.Color(PALETTE.grassBase))
  // Merge three's light/shadow uniforms so the renderer has slots to populate
  // the directional shadow map into (with lights:true below). UniformsUtils.merge
  // DEEP-CLONES, so we merge only the lights lib + scalar placeholders here, then
  // RE-ASSIGN our live object uniforms afterwards — the setters mutate those same
  // objects each frame, so they must be the identical references the shader reads.
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    lights: true, // routes this material through the shadow-uniform upload path
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      {
        uTime: { value: 0 },
        uNeutralR: { value: neutralRadius },
        uRadius: { value: radius },
        uZoneCount: { value: 6 },
        uDanger: { value: new Array(MAX_ZONES).fill(0) },
        uAlarmZone: { value: -1 },
        uAlarmPulse: { value: 0 },
        uNight: { value: 0 },
        uBodyCount: { value: 0 },
        uGustCount: { value: 0 },
      },
    ]),
  })
  // live object uniforms (kept OUT of the merge so we hold the real references)
  material.uniforms.uWindDir = { value: windDir }
  material.uniforms.uBase = { value: new THREE.Color(PALETTE.grassBase) }
  material.uniforms.uTip = { value: new THREE.Color(PALETTE.grassTip) }
  material.uniforms.uChalk = { value: new THREE.Color(PALETTE.chalk) }
  material.uniforms.uZoneColors = { value: zoneColors }
  material.uniforms.uBodies = { value: bodies }
  material.uniforms.uGusts = { value: gusts }
  material.uniforms.uGustDir = { value: gustDirs }

  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false // one field, always on screen
  mesh.receiveShadow = true // r0.185: drives the `receiveShadow` uniform getShadowMask reads

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
    setAlarm(zone: number, pulse: number): void {
      material.uniforms.uAlarmZone!.value = zone
      material.uniforms.uAlarmPulse!.value = pulse
    },
    setNight(frac: number): void {
      material.uniforms.uNight!.value = frac
    },
    setBodies(list: readonly GrassBody[]): void {
      const n = Math.min(MAX_BODIES, list.length)
      for (let i = 0; i < n; i++) {
        const b = list[i]!
        bodies[i]!.set(b.x, b.z, b.radius, b.wobble)
      }
      material.uniforms.uBodyCount!.value = n
    },
    setGusts(list: readonly GustCell[]): void {
      const n = Math.min(MAX_GUSTS, list.length)
      for (let i = 0; i < n; i++) {
        const g = list[i]!
        gusts[i]!.set(g.x, g.z, g.radius, g.strength)
        gustDirs[i]!.set(g.dirX, g.dirZ)
      }
      material.uniforms.uGustCount!.value = n
    },
    update(time: number, windX: number, windZ: number): void {
      material.uniforms.uTime!.value = time
      windDir.set(windX, windZ)
    },
    dispose(): void {
      geo.dispose()
      template.dispose()
      material.dispose()
    },
  }
}
