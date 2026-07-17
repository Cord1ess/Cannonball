import * as THREE from 'three'
import type { KitColors } from '@shared/cosmetics/jerseys.ts'

/**
 * Jersey canvas painter (M4b): turns a kit's colorway into a hand-painted
 * body texture for the bean. Same philosophy as textures.ts — generated at
 * runtime, wobbly edges, gouache mottling baked in so the kit sits inside
 * the Messenger paint style instead of on top of it.
 *
 * Textures are cached per colorway and shared between beans; bean disposal
 * frees materials but never these (see disposeHierarchy's contract).
 */

const cache = new Map<string, THREE.CanvasTexture>()

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

export function jerseyTexture(kit: KitColors): THREE.CanvasTexture {
  const key = `${kit.primary}:${kit.secondary}:${kit.pattern}`
  const cached = cache.get(key)
  if (cached) return cached

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')

  ctx.fillStyle = hex(kit.primary)
  ctx.fillRect(0, 0, size, size)

  // pattern bands with jittered edges — painted, not printed
  ctx.fillStyle = hex(kit.secondary)
  if (kit.pattern === 'stripes') {
    // 4 vertical bars; each drawn as short slices with sideways wobble
    const bar = size / 8
    for (let i = 0; i < 4; i++) {
      const x0 = bar * (2 * i + 0.5)
      for (let y = 0; y < size; y += 4) {
        const wobble = (Math.random() - 0.5) * 3
        ctx.fillRect(x0 + wobble, y, bar, 4.5)
      }
    }
  } else if (kit.pattern === 'hoops') {
    // 3 horizontal bands with vertical wobble
    const band = size / 7
    for (let i = 0; i < 3; i++) {
      const y0 = band * (2 * i + 1)
      for (let x = 0; x < size; x += 4) {
        const wobble = (Math.random() - 0.5) * 3
        ctx.fillRect(x, y0 + wobble, 4.5, band)
      }
    }
  }

  // baked gouache mottling (the shared gouache map can't stack on this map)
  const blob = (fill: string, alpha: number, radius: number): void => {
    const x = Math.random() * size
    const y = Math.random() * size
    const g = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius)
    g.addColorStop(0, fill.replace('A', alpha.toFixed(3)))
    g.addColorStop(1, fill.replace('A', '0'))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 26; i++) blob('rgba(70, 60, 50, A)', 0.03 + Math.random() * 0.04, size * (0.08 + Math.random() * 0.18))
  for (let i = 0; i < 14; i++) blob('rgba(255, 255, 250, A)', 0.04 + Math.random() * 0.05, size * (0.06 + Math.random() * 0.14))

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(key, tex)
  return tex
}
