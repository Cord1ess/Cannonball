import * as THREE from 'three'
import { grainTexture } from './textures.ts'

/**
 * Fullscreen paper-grain quad — rendered as a second pass over the scene.
 * No render targets, no post pipeline: one screen-space quad, felt not seen.
 */
export interface GrainOverlay {
  render(renderer: THREE.WebGLRenderer): void
}

export function createGrainOverlay(): GrainOverlay {
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uGrain: { value: grainTexture() },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uGrain;
      void main() {
        gl_FragColor = texture2D(uGrain, gl_FragCoord.xy / 256.0);
      }
    `,
  })

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))

  return {
    render(renderer: THREE.WebGLRenderer): void {
      renderer.clearDepth()
      renderer.render(scene, camera)
    },
  }
}
