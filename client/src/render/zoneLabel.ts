import * as THREE from 'three'

/**
 * A ground-plane zone label (M5b): the owner's name painted FLAT on the grass
 * in their wedge, so it reads as "this territory is theirs" — distinct from the
 * floating head name-tags. Lies on the ground, oriented to face outward from
 * the arena center. One per zone; texture rebuilt only when name/color changes.
 */

export interface ZoneLabel {
  readonly mesh: THREE.Mesh
  set(name: string, colorHex: string): void
  /** place flat at world (x, z), rotated so text reads facing arena center */
  place(x: number, z: number): void
  setVisible(v: boolean): void
  dispose(): void
}

const PAD = 16
const FONT = 42

export function createZoneLabel(): ZoneLabel {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  const geo = new THREE.PlaneGeometry(1, 1)
  const mesh = new THREE.Mesh(geo, material)
  mesh.rotation.x = -Math.PI / 2 // lie flat on the ground
  mesh.position.y = 0.08
  mesh.renderOrder = 4

  let lastKey = ''
  let aspect = 3

  function redraw(name: string, colorHex: string): void {
    ctx.font = `800 ${FONT}px system-ui, sans-serif`
    const textW = ctx.measureText(name).width
    const w = Math.ceil(textW + PAD * 2)
    const h = FONT + PAD * 2
    canvas.width = w
    canvas.height = h
    ctx.font = `800 ${FONT}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // soft dark plate for legibility over grass, with the owner-color underline
    ctx.fillStyle = 'rgba(24,22,20,0.5)'
    ctx.beginPath()
    ctx.roundRect(0, 0, w, h, 14)
    ctx.fill()
    ctx.fillStyle = colorHex
    ctx.beginPath()
    ctx.roundRect(PAD, h - 12, w - PAD * 2, 5, 2)
    ctx.fill()

    ctx.fillStyle = '#fbf6e8'
    ctx.fillText(name, w / 2, h / 2 - 2)
    tex.needsUpdate = true
    aspect = w / h
  }

  return {
    mesh,
    set(name: string, colorHex: string): void {
      const key = `${name}|${colorHex}`
      if (key === lastKey) return
      lastKey = key
      redraw(name || '…', colorHex)
    },
    place(x: number, z: number): void {
      mesh.position.set(x, 0.08, z)
      // orient so the text faces the arena center (readable running inward)
      const worldH = 2.4
      mesh.scale.set(worldH * aspect, worldH, 1)
      mesh.rotation.z = Math.atan2(x, z) // spin flat plane around its up axis
    },
    setVisible(v: boolean): void {
      mesh.visible = v
      // when hidden, BLANK the texture too so a stale name can never linger on
      // the ground for a frame if the mesh is ever momentarily shown again
      if (!v && lastKey !== '') {
        lastKey = ''
        canvas.width = 1
        canvas.height = 1
        ctx.clearRect(0, 0, 1, 1)
        tex.needsUpdate = true
      }
    },
    dispose(): void {
      geo.dispose()
      tex.dispose()
      material.dispose()
    },
  }
}
