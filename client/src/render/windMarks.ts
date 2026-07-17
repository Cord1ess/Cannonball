import * as THREE from 'three'

/**
 * Wind marks (M5): short direction-driven streaklets that appear NEXT TO a
 * body (an airborne bean, or the ball in a gust) to signal "the wind is
 * pushing this". Up to N marks, positioned + oriented each frame along the
 * wind. Billboarded, additive-soft. Cosmetic only.
 */

const MAX_MARKS = 12
const DASHES = 3 // little dashes per mark, trailing along the wind

export interface WindMark {
  x: number
  y: number
  z: number
  /** 0..1 intensity (how hard the wind is catching this body) */
  strength: number
}

export interface WindMarks {
  readonly mesh: THREE.Object3D
  set(marks: readonly WindMark[], windX: number, windZ: number, time: number): void
  dispose(): void
}

export function createWindMarks(): WindMarks {
  // each instance = one dash; DASHES per mark. per-instance: dash index
  const total = MAX_MARKS * DASHES
  const quad = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.setAttribute('uv', quad.getAttribute('uv'))
  geo.instanceCount = total

  const iPos = new Float32Array(total * 3) // world center per dash
  const iDir = new Float32Array(total * 2) // wind dir per dash
  const iInfo = new Float32Array(total * 2) // dashIndex, strength
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3))
  geo.setAttribute('iDir', new THREE.InstancedBufferAttribute(iDir, 2))
  geo.setAttribute('iInfo', new THREE.InstancedBufferAttribute(iInfo, 2))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 iPos;
      attribute vec2 iDir;
      attribute vec2 iInfo; // x = dash index, y = strength
      uniform float uTime;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = uv;
        float strength = iInfo.y;
        if (strength <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec2 dir = normalize(iDir);
        // dashes trail downwind, animated so they stream off the body
        float phase = fract(uTime * 2.2 + iInfo.x * 0.34);
        float trail = 0.4 + phase * 1.6; // meters downwind
        vec3 center = iPos + vec3(dir.x, 0.0, dir.y) * trail;

        float len = 0.55 * strength;
        float wide = 0.08;
        // billboard in view space; length along the wind's view projection
        vec4 cv = modelViewMatrix * vec4(center, 1.0);
        vec3 dirV = normalize((modelViewMatrix * vec4(dir.x, 0.0, dir.y, 0.0)).xyz);
        vec3 upV = normalize(cross(dirV, vec3(0.0, 0.0, 1.0)));
        vec3 off = dirV * (position.x * len) + upV * (position.y * wide * 4.0);
        gl_Position = projectionMatrix * (cv + vec4(off, 0.0));
        vAlpha = strength * (1.0 - phase) * 0.85;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float head = smoothstep(0.0, 0.3, vUv.x) * (1.0 - smoothstep(0.6, 1.0, vUv.x));
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float a = head * across * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, a);
      }
    `,
  })

  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 6

  const posAttr = geo.getAttribute('iPos') as THREE.InstancedBufferAttribute
  const dirAttr = geo.getAttribute('iDir') as THREE.InstancedBufferAttribute
  const infoAttr = geo.getAttribute('iInfo') as THREE.InstancedBufferAttribute

  return {
    mesh,
    set(marks, windX, windZ, time): void {
      material.uniforms.uTime!.value = time
      for (let m = 0; m < MAX_MARKS; m++) {
        const mark = marks[m]
        for (let dphase = 0; dphase < DASHES; dphase++) {
          const idx = m * DASHES + dphase
          if (mark) {
            // offset each mark's dashes slightly to the side of the body
            const side = dphase - (DASHES - 1) / 2
            posAttr.setXYZ(idx, mark.x - windZ * side * 0.35, mark.y + 0.6, mark.z + windX * side * 0.35)
            dirAttr.setXY(idx, windX, windZ)
            infoAttr.setXY(idx, dphase, mark.strength)
          } else {
            infoAttr.setXY(idx, dphase, 0)
          }
        }
      }
      posAttr.needsUpdate = true
      dirAttr.needsUpdate = true
      infoAttr.needsUpdate = true
    },
    dispose(): void {
      geo.dispose()
      quad.dispose()
      material.dispose()
    },
  }
}
