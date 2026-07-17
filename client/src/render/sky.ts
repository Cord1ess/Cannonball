import * as THREE from 'three'
import { skyTexture } from './textures.ts'

/**
 * The painted sky dome (art_direction.md §2.5). The cloud mask is baked into
 * the canvas texture; the light-arc palette lerp (M5) will re-tint via a
 * second texture blend rather than repainting.
 */
export function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(300, 32, 16)
  const mat = new THREE.MeshBasicMaterial({
    map: skyTexture(),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  })
  const sky = new THREE.Mesh(geo, mat)
  sky.name = 'sky-dome'
  sky.renderOrder = -1
  sky.matrixAutoUpdate = false
  return sky
}
