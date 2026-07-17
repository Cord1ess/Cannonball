import * as THREE from 'three'

/**
 * Wind streaks (M5): thin, faint 3D curved tubes that appear CLUSTERED at an
 * active gust cell, streak along the wind, and fade out with the cell — so a
 * few lines show up in one spot, whiz past, and vanish, then another cluster
 * appears elsewhere. Real round tubes (visible any angle), toon-flat shaded,
 * quite transparent. Driven by the wind field's gust cells. Cosmetic.
 */

const CELLS = 6 // must match the wind field
const PER_CELL = 3 // 2-4 streaks clustered per gust
const COUNT = CELLS * PER_CELL
const RINGS = 22
const RADIAL = 4
const TUBE_R = 0.06 // THIN
const LEN = 7.0

export interface StreakCell {
  x: number
  z: number
  strength: number // 0..1 (fades the cluster in/out)
  dirX: number // this gust's travel direction (curved arc)
  dirZ: number
}

export interface WindStreaks {
  readonly mesh: THREE.Object3D
  /** feed the active gust cells + wind dir; time advances the curve */
  update(dt: number, cells: readonly StreakCell[], windX: number, windZ: number): void
  dispose(): void
}

export function createWindStreaks(): WindStreaks {
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

  // per-streak: within-cluster offset + curve seed (stable per instance)
  const seed = new Float32Array(COUNT * 4)
  for (let i = 0; i < COUNT; i++) {
    seed[i * 4] = (Math.random() - 0.5) * 6 // lateral spread within the cluster
    seed[i * 4 + 1] = (Math.random() - 0.5) * 4 // along spread
    seed[i * 4 + 2] = 2.5 + Math.random() * 4 // height off the grass
    seed[i * 4 + 3] = Math.random() // curve phase
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))

  // per-instance CELL state, updated each frame: xz center + strength + dir
  const iCell = new Float32Array(COUNT * 3)
  geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(iCell, 3))
  const iDir = new Float32Array(COUNT * 2)
  geo.setAttribute('iDir', new THREE.InstancedBufferAttribute(iDir, 2))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uTubeR: { value: TUBE_R },
      uLen: { value: LEN },
      uColor: { value: new THREE.Color(0xffffff) },
      uShade: { value: new THREE.Color(0xbfe6f0) },
      uLight: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    } as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      attribute vec3 iCell;   // x,z = cluster center · z-comp = strength
      attribute vec2 iDir;    // this gust's travel direction (curved arc)
      attribute float aRing;
      attribute float aAng;
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uTubeR;
      uniform float uLen;
      varying float vFade;
      varying vec3 vNormal;

      void main() {
        float strength = iCell.z;
        if (strength <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; return; }
        vec2 dir = normalize(iDir);
        vec2 perp = vec2(-dir.y, dir.x);

        // cluster origin = cell center + this streak's stable offset
        vec2 origin = vec2(iCell.x, iCell.y) + perp * aSeed.x + dir * aSeed.y;
        float len = uLen;

        // two spine samples for a real tangent (avoids degenerate tube frame)
        float d0 = -aRing * len;
        float d1 = -(aRing + 0.02) * len;
        float amp = 1.4;
        vec2 s0 = origin + dir * d0 + perp * (sin(d0*0.6 + uTime*3.0 + aSeed.w*6.28)*amp);
        vec2 s1 = origin + dir * d1 + perp * (sin(d1*0.6 + uTime*3.0 + aSeed.w*6.28)*amp);
        float y0 = aSeed.z + sin(d0*0.8)*0.5;
        float y1 = aSeed.z + sin(d1*0.8)*0.5;
        vec3 p0 = vec3(s0.x, y0, s0.y);
        vec3 p1 = vec3(s1.x, y1, s1.y);

        vec3 tangent = normalize(p1 - p0);
        vec3 ref = abs(tangent.y) > 0.9 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0);
        vec3 nrm = normalize(cross(tangent, ref));
        vec3 bin = normalize(cross(tangent, nrm));
        vec3 ringN = nrm * cos(aAng) + bin * sin(aAng);
        vec3 world = p0 + ringN * uTubeR;
        vNormal = ringN;

        float tip = sin(aRing * 3.14159); // taper ends
        vFade = tip * strength;

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
        float nl = dot(normalize(vNormal), normalize(uLight)) * 0.5 + 0.5;
        vec3 col = mix(uShade, uColor, nl > 0.55 ? 1.0 : 0.78);
        float a = clamp(vFade, 0.0, 1.0) * 0.42; // FAINT
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  })

  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 5

  const cellAttr = geo.getAttribute('iCell') as THREE.InstancedBufferAttribute
  const dirAttr = geo.getAttribute('iDir') as THREE.InstancedBufferAttribute
  let elapsed = 0
  return {
    mesh,
    update(dt, cells, _windX, _windZ): void {
      elapsed += dt
      material.uniforms.uTime!.value = elapsed
      for (let c = 0; c < CELLS; c++) {
        const cell = cells[c]
        for (let k = 0; k < PER_CELL; k++) {
          const idxI = c * PER_CELL + k
          if (cell) {
            cellAttr.setXYZ(idxI, cell.x, cell.z, cell.strength)
            dirAttr.setXY(idxI, cell.dirX, cell.dirZ)
          } else {
            cellAttr.setXYZ(idxI, 0, 0, 0)
          }
        }
      }
      cellAttr.needsUpdate = true
      dirAttr.needsUpdate = true
    },
    dispose(): void {
      geo.dispose()
      tube.dispose()
      material.dispose()
    },
  }
}
