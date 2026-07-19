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
 * The MATCH BALL skin (art_direction.md §5, §3): a CLEAN classic football — the
 * Telstar look, cream-white with black-pentagon patches — painted in OUR style.
 * The "black" patches are warm ink `#4A443C` (never pure black, §2.2), drawn as
 * wobbly hand-inked pentagons with broken seam strokes radiating out to the
 * neighbouring patches, over a gouache-mottled cream base so no surface is flat
 * (§2.1). No accent colours: saturation is rationed to teams (§2.4). The 3D mesh
 * carries the heaviest ink OUTLINE separately. Equirectangular, wraps on the UV.
 *
 * Pentagon placement is the icosahedral soccer-ball layout flattened to equirect:
 * one patch at each pole and two staggered rings of five around the belly — the
 * distribution the eye reads instantly as "football".
 */
export function ballTexture(w = 512, h = 256): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(w, h)
  const cream = '#f5f0e2'
  const ink = '#4a443c' // warm dark gray-brown — the palette ink, NOT black

  ctx.fillStyle = cream
  ctx.fillRect(0, 0, w, h)

  // deterministic wobble so the ball looks the same every load (it's iconic, not
  // random like the world dressing) — a cheap hash keyed on a running seed.
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }

  // the 12 pentagon centres in (u,v) 0..1. u wraps; v is 0=top pole .. 1=bottom.
  // poles sit ON the seam-free caps; the two belly rings are offset by half a
  // step so they interlock like the real ball.
  const R = h * 0.13 // patch radius in px (belly); poles drawn a touch smaller
  const centres: Array<{ u: number; v: number; r: number }> = [
    { u: 0.25, v: 0.12, r: 0.82 }, // top cap (near pole, not on it)
    { u: 0.75, v: 0.12, r: 0.82 },
    { u: 0.25, v: 0.88, r: 0.82 }, // bottom cap
    { u: 0.75, v: 0.88, r: 0.82 },
  ]
  for (let i = 0; i < 5; i++) {
    centres.push({ u: i / 5, v: 0.36, r: 1 }) // upper belly ring
    centres.push({ u: i / 5 + 0.1, v: 0.64, r: 1 }) // lower belly ring, offset
  }

  // one hand-inked pentagon: a wobbly filled 5-gon with a slightly darker broken
  // rim so the edge reads as a drawn stroke, plus short seam ticks poking out
  // toward its neighbours (the classic radiating soccer seams).
  const pentagon = (cx: number, cy: number, r: number): void => {
    const rot = rnd() * Math.PI * 2
    const pts: Array<[number, number]> = []
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2
      const wob = 1 + (rnd() - 0.5) * 0.16
      pts.push([cx + Math.cos(a) * r * wob, cy + Math.sin(a) * r * 0.9 * wob])
    }
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < 5; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    ctx.closePath()
    ctx.fillStyle = ink
    ctx.fill()
    // broken rim stroke, warm ink a touch lighter, so the edge looks drawn
    ctx.strokeStyle = '#5a5348'
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.stroke()
    // seam ticks radiating from each vertex (the white-hexagon boundaries)
    ctx.strokeStyle = ink
    ctx.lineWidth = 2.2
    for (const [px, py] of pts) {
      const ang = Math.atan2(py - cy, px - cx)
      const len = r * (0.5 + rnd() * 0.35)
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // draw every patch wrapped across the u-seam (−w, 0, +w) so it's continuous
  for (const c of centres) {
    const cx = c.u * w
    const cy = c.v * h
    for (const ox of [-w, 0, w]) pentagon(cx + ox, cy, R * c.r)
  }

  // gouache mottle over the whole ball so the cream is never a flat fill (§2.1)
  ctx.globalAlpha = 0.04
  ctx.fillStyle = '#8a8072'
  for (let i = 0; i < 46; i++) {
    ctx.beginPath()
    ctx.arc(rnd() * w, rnd() * h, 5 + rnd() * 20, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  const tex = toTexture(canvas)
  tex.anisotropy = 4
  return tex
}
