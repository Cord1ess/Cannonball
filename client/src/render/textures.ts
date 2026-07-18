import * as THREE from 'three'

/**
 * The canvas texture kit (art_direction.md §2): every texture in the game is
 * generated here at load. Hand-painted look, zero authored assets.
 * Seeded via Math.random — purely cosmetic, never simulation-relevant.
 */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  return [canvas, ctx]
}

function toTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
  }
  return tex
}

/**
 * Trait 2.1 — painted fills. Near-white tile multiplied over every albedo:
 * soft irregular blobs at low contrast so no color field is ever flat.
 */
export function gouacheTexture(size = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  const blob = (fill: string, alpha: number, radius: number): void => {
    const x = Math.random() * size
    const y = Math.random() * size
    const g = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius)
    g.addColorStop(0, fill.replace('A', alpha.toFixed(3)))
    g.addColorStop(1, fill.replace('A', '0'))
    ctx.fillStyle = g
    // draw wrapped so the tile repeats seamlessly-ish
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath()
        ctx.arc(x + ox, y + oy, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  for (let i = 0; i < 70; i++) blob('rgba(90, 80, 70, A)', 0.025 + Math.random() * 0.035, size * (0.06 + Math.random() * 0.2))
  for (let i = 0; i < 30; i++) blob('rgba(255, 255, 250, A)', 0.03 + Math.random() * 0.04, size * (0.05 + Math.random() * 0.15))

  const tex = toTexture(canvas, true)
  tex.repeat.set(2, 2)
  return tex
}

/**
 * Trait 2.2 — stroke-break mask for ink hulls. Mostly white (line present)
 * with wobbly dark slashes and speckle where the pen "lifts".
 */
export function strokeTexture(size = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#000000'
  ctx.lineCap = 'round'

  // thin gap-slashes
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const angle = Math.random() * Math.PI
    const len = 10 + Math.random() * 40
    ctx.lineWidth = 1 + Math.random() * 2.5
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.moveTo(x - Math.cos(angle) * len, y - Math.sin(angle) * len)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  // speckle
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000000'
  for (let i = 0; i < 130; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }

  const tex = toTexture(canvas, true)
  tex.colorSpace = THREE.NoColorSpace // it's a mask, not color
  return tex
}

/**
 * Trait 2.2 — hatch ticks, dashes, pebbles: the scatter marks. Transparent
 * tile used on small decal quads along bases, corners, and the pitch.
 */
export function tickDecalTexture(size = 128): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size)
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = '#4a443c'
  ctx.lineCap = 'round'

  for (let i = 0; i < 7; i++) {
    const x = 12 + Math.random() * (size - 24)
    const y = 12 + Math.random() * (size - 24)
    const angle = Math.random() * Math.PI
    const len = 5 + Math.random() * 11
    ctx.lineWidth = 1.5 + Math.random() * 1.5
    ctx.globalAlpha = 0.35 + Math.random() * 0.4
    ctx.beginPath()
    ctx.moveTo(x - Math.cos(angle) * len, y - Math.sin(angle) * len)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  // pebble dots
  ctx.fillStyle = '#4a443c'
  for (let i = 0; i < 5; i++) {
    ctx.globalAlpha = 0.25 + Math.random() * 0.3
    ctx.beginPath()
    ctx.arc(12 + Math.random() * (size - 24), 12 + Math.random() * (size - 24), 1 + Math.random() * 2, 0, Math.PI * 2)
    ctx.fill()
  }
  return toTexture(canvas)
}

/** The bean face plate: simple black rectangular eyes (reference image style). */
export function faceTexture(size = 96): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size)
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#1c1a18'
  const eyeW = size * 0.13
  const eyeH = size * 0.3
  const y = size * 0.34
  ctx.fillRect(size * 0.28 - eyeW / 2, y, eyeW, eyeH)
  ctx.fillRect(size * 0.72 - eyeW / 2, y, eyeW, eyeH)
  return toTexture(canvas)
}

/** Fine paper grain for the fullscreen overlay quad. */
export function grainTexture(size = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size)
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const light = Math.random() > 0.5
    d[i] = d[i + 1] = d[i + 2] = light ? 255 : 20
    d[i + 3] = Math.random() * 13
  }
  ctx.putImageData(img, 0, 0)
  const tex = toTexture(canvas, true)
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

/**
 * Trait 2.5 — the painted sky: flat teal with a soft cream horizon band. NOT a
 * gradient, NOT geometry. Clouds are NO LONGER painted here — they're real 3D
 * bubbly toon clouds now (render/clouds.ts), so the dome is just the backdrop.
 */
export function skyTexture(w = 1024, h = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(w, h)
  ctx.fillStyle = '#7dcdc2'
  ctx.fillRect(0, 0, w, h)

  // soft cream glow around the horizon (sphere equator ≈ middle of texture)
  const horizon = ctx.createLinearGradient(0, h * 0.38, 0, h * 0.62)
  horizon.addColorStop(0, 'rgba(238, 244, 226, 0)')
  horizon.addColorStop(1, 'rgba(238, 244, 226, 0.85)')
  ctx.fillStyle = horizon
  ctx.fillRect(0, h * 0.38, w, h * 0.62)

  return toTexture(canvas)
}

/**
 * The MATCH BALL skin: a colourful world-cup-style football. A cream base with
 * curved panel seams and bright accent panels (teal / coral / gold) so it reads
 * as a real, lively football — not a flat solid ball. Painted in our style
 * (wobbly seams, gouache mottle). Equirectangular, wraps on the sphere UV.
 */
export function ballTexture(w = 512, h = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(w, h)
  // cream base
  ctx.fillStyle = '#f5f0e2'
  ctx.fillRect(0, 0, w, h)

  const accents = ['#e0705a', '#3fb0a6', '#f0b93c', '#4a8fd0'] // coral/teal/gold/blue
  const ink = '#3a342c'

  // a lattice of rounded panels: staggered rows of hex-ish blobs. Some panels
  // get an accent colour, most stay cream, a few carry a dark pentagon.
  const cols = 8
  const rows = 4
  const cw = w / cols
  const rh = h / rows
  const rnd = (n: number): number => (Math.sin(n * 12.9898) * 43758.5453) % 1
  let seed = 1
  const panel = (cx: number, cy: number, r: number, fill: string): void => {
    ctx.fillStyle = fill
    ctx.beginPath()
    const sides = 6
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + 0.3
      const wob = 1 + (rnd(seed++) - 0.5) * 0.22
      const px = cx + Math.cos(a) * r * wob
      const py = cy + Math.sin(a) * r * 0.86 * wob
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    // dark seam outline (wobbly)
    ctx.strokeStyle = ink
    ctx.lineWidth = 3.2
    ctx.stroke()
  }

  for (let ry = 0; ry < rows; ry++) {
    for (let cx0 = 0; cx0 < cols; cx0++) {
      const stagger = ry % 2 === 0 ? 0 : cw / 2
      const px = cx0 * cw + cw / 2 + stagger
      const py = ry * rh + rh / 2
      const pick = rnd(cx0 * 7 + ry * 13 + 3)
      let fill = '#f5f0e2'
      if (pick > 0.82) fill = ink // dark pentagon panel
      else if (pick > 0.5) fill = accents[Math.floor(rnd(cx0 * 3 + ry * 5) * accents.length + accents.length) % accents.length]!
      // draw wrapped so the equirect seam is continuous
      for (const ox of [-w, 0, w]) panel(px + ox, py, cw * 0.52, fill)
    }
  }

  // baked gouache mottle so it sits in the paint style
  ctx.globalAlpha = 0.05
  ctx.fillStyle = '#5a504a'
  for (let i = 0; i < 40; i++) {
    ctx.beginPath()
    ctx.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 22, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  const tex = toTexture(canvas)
  tex.anisotropy = 4
  return tex
}
