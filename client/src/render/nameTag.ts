import * as THREE from 'three'

/**
 * A floating name tag over a bean's head (M5b). A canvas sprite that always
 * faces the camera, so every player can tell who's who in-match. Cheap: one
 * sprite per bean, texture rebuilt only when the name/color changes.
 */

export interface NameTag {
  readonly sprite: THREE.Sprite
  /** set the label text + accent color (rebuilds the texture only on change) */
  set(name: string, colorHex: string): void
  /** place it above a bean at world (x, y, z); y is the bean's feet */
  place(x: number, y: number, z: number): void
  setVisible(v: boolean): void
  dispose(): void
}

const PAD = 12
const FONT = 34

export function createNameTag(): NameTag {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.renderOrder = 20

  let lastKey = ''

  function redraw(name: string, colorHex: string): void {
    ctx.font = `700 ${FONT}px system-ui, sans-serif`
    const textW = ctx.measureText(name).width
    const w = Math.ceil(textW + PAD * 2)
    const h = FONT + PAD * 2
    canvas.width = w
    canvas.height = h
    // re-set font after resize (resizing clears the context state)
    ctx.font = `700 ${FONT}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // rounded pill background: dark ink, with the player's color as a top bar
    const r = h / 2
    ctx.fillStyle = 'rgba(28,26,24,0.82)'
    ctx.beginPath()
    ctx.roundRect(0, 0, w, h, r)
    ctx.fill()
    // color accent stripe under the text
    ctx.fillStyle = colorHex
    ctx.beginPath()
    ctx.roundRect(PAD, h - 9, w - PAD * 2, 4, 2)
    ctx.fill()

    ctx.fillStyle = '#fbf6e8'
    ctx.fillText(name, w / 2, h / 2 - 2)

    tex.needsUpdate = true
    // world size: keep text a readable height, scale width by aspect
    const worldH = 0.85
    sprite.scale.set(worldH * (w / h), worldH, 1)
  }

  return {
    sprite,
    set(name: string, colorHex: string): void {
      const key = `${name}|${colorHex}`
      if (key === lastKey) return
      lastKey = key
      redraw(name || '…', colorHex)
    },
    place(x: number, y: number, z: number): void {
      sprite.position.set(x, y + 2.55, z) // above the bean's head
    },
    setVisible(v: boolean): void {
      sprite.visible = v
    },
    dispose(): void {
      tex.dispose()
      material.dispose()
    },
  }
}
