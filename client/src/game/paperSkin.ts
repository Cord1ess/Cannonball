/**
 * The paper-and-ink UI skin (art_direction.md §9). Shared pieces every HUD
 * surface (leaderboard, hud, matchUi) draws from so the overlay reads as
 * hand-drawn paper cards, not flat debug boxes:
 *   - self-hosted fonts: Baloo 2 (headers/numbers), Patrick Hand (hand text)
 *   - a canvas paper-grain tile (warm cream, faint fibre speckle) as panel bg
 *   - wobbly ink card FRAMES drawn as SVG data-URI borders (broken, uneven —
 *     never the uniform 2px border the §10 "no borders" rule forbids)
 *   - brush-stroke meter fills (a painted bar with a rough leading edge)
 *
 * Everything is canvas/SVG generated at load — zero authored image assets,
 * consistent with the rest of the texture kit. Import once (side effect) to
 * register the fonts + the shared stylesheet.
 */

// self-hosted webfonts (bundled by vite, no CDN) — §9. Latin subset only:
// the game text is English, so we skip the Devanagari/other-script weights.
// Abeto-style pairing (messenger.abeto.co): a BOLD BOXY signage face for titles
// + headers (Bungee) and a THIN crayon/pen handwriting for labels + notes
// (Caveat). Replaces the earlier Baloo/Patrick-Hand which read too comic-sans.
import '@fontsource/bungee/latin-400.css'
import '@fontsource/caveat/latin-500.css'
import '@fontsource/caveat/latin-700.css'

import { PALETTE } from '../render/palette.ts'

export const INK = '#4a443c' // the palette ink — warm dark gray-brown, never black
export const PAPER = '#f6f1e2' // warm cream paper
export const FONT_HEAD = "'Bungee', system-ui, sans-serif" // boxy signage headers
export const FONT_HAND = "'Caveat', 'Bungee', cursive" // thin crayon handwriting

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

// --- paper-grain tile ---------------------------------------------------------
// a warm cream field with soft gouache blotches + a faint dark/light fibre
// speckle. Tiles seamlessly-ish; used as the panel background so no UI surface
// is a flat fill (§2.1 carried into the UI).
let paperUrl: string | null = null
export function paperTexture(): string {
  if (paperUrl) return paperUrl
  const size = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, size, size)
  // soft gouache value wobble
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 10 + Math.random() * 34
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const dark = Math.random() > 0.5
    g.addColorStop(0, dark ? 'rgba(120,108,92,0.05)' : 'rgba(255,252,244,0.10)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.beginPath()
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // fine fibre speckle
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let p = 0; p < d.length; p += 4) {
    if (Math.random() < 0.06) {
      const v = Math.random() > 0.5 ? 14 : -14
      d[p] = Math.max(0, Math.min(255, d[p]! + v))
      d[p + 1] = Math.max(0, Math.min(255, d[p + 1]! + v))
      d[p + 2] = Math.max(0, Math.min(255, d[p + 2]! + v))
    }
  }
  ctx.putImageData(img, 0, 0)
  paperUrl = cv.toDataURL()
  return paperUrl
}

// --- wobbly ink frame ---------------------------------------------------------
// a rounded-rect stroke with per-point jitter so the border looks hand-inked,
// as an SVG data URI sized to fill via border-image (stretches gracefully). A
// second, offset faint stroke gives the double-line sketch feel. Cached by a
// coarse key so we don't rebuild identical frames.
const frameCache = new Map<string, string>()
// `fill` (optional) fills the wobbly SHAPE itself so a coloured button never
// pokes a hard rectangle past its sketched outline — the fill IS the outline.
export function inkFrameUrl(w = 220, h = 60, color = INK, weight = 2.4, fill?: string): string {
  const key = `${w}x${h}:${color}:${weight}:${fill ?? '-'}`
  const hit = frameCache.get(key)
  if (hit) return hit
  const pad = 5
  const seed = (w * 31 + h * 17) % 997
  let s = seed
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  // walk a rounded rect as a polyline with jitter on each sample point
  const rad = Math.min(14, h / 3)
  const pts: Array<[number, number]> = []
  const push = (x: number, y: number): void => {
    pts.push([x + (rnd() - 0.5) * 2.2, y + (rnd() - 0.5) * 2.2])
  }
  const x0 = pad, y0 = pad, x1 = w - pad, y1 = h - pad
  const step = 16
  for (let x = x0 + rad; x < x1 - rad; x += step) push(x, y0)
  push(x1 - rad, y0); push(x1, y0 + rad)
  for (let y = y0 + rad; y < y1 - rad; y += step) push(x1, y)
  push(x1, y1 - rad); push(x1 - rad, y1)
  for (let x = x1 - rad; x > x0 + rad; x -= step) push(x, y1)
  push(x0 + rad, y1); push(x0, y1 - rad)
  for (let y = y1 - rad; y > y0 + rad; y -= step) push(x0, y)
  push(x0, y0 + rad); push(x0 + rad, y0)
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z'
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
    `<path d='${path}' fill='${fill ?? 'none'}' stroke='${color}' stroke-width='${weight}' ` +
    `stroke-linejoin='round' stroke-linecap='round' opacity='0.95'/>` +
    `</svg>`
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  frameCache.set(key, url)
  return url
}

/** apply the paper card look to a DOM element: paper bg + wobbly ink frame. */
export function paperPanel(el: HTMLElement, opts: { w?: number; h?: number; color?: string; weight?: number } = {}): void {
  // the wobbly frame is FILLED with cream so the panel edge is exactly the drawn
  // line (no rectangle past it); a faint paper texture sits under, inset so it
  // never reaches the corners past the wobble.
  el.style.backgroundImage = `${inkFrameUrl(opts.w, opts.h, opts.color ?? INK, opts.weight, PAPER)}, url("${paperTexture()}")`
  el.style.backgroundSize = '100% 100%, 128px 128px'
  el.style.backgroundPosition = 'center, center'
  el.style.backgroundRepeat = 'no-repeat, no-repeat'
  el.style.backgroundClip = 'padding-box, content-box'
  el.style.border = 'none'
  el.style.borderRadius = '10px'
}

// --- brush-stroke meter bar ---------------------------------------------------
// returns a background string for a fill element: a painted stroke with a
// slightly rough top edge (drawn into a tall gradient) + inner value wobble.
export function brushFill(color: string): string {
  // a soft vertical shade so the paint reads as a stroke, not a flat block
  return `linear-gradient(180deg, ${color} 0%, ${color} 62%, rgba(0,0,0,0.14) 100%)`
}

/** danger-rose / gold / green from the palette for meter states. */
export const METER = {
  safe: hex(PALETTE.teamGreen),
  warn: hex(PALETTE.uiGold),
  danger: hex(PALETTE.dangerRose),
  hot: '#e8402e',
} as const

// --- paper button -------------------------------------------------------------
// a chunky ink-framed button that reads as a paper card you press: paper bg,
// wobbly ink frame, Baloo label, a soft drop so it looks liftable. `tint` fills
// the paper with a colour wash (for the coloured action buttons); omit for a
// plain cream button. Applies inline styles so callers keep their layout.
export function paperButton(
  btn: HTMLButtonElement,
  opts: { tint?: string; w?: number; h?: number; big?: boolean } = {},
): void {
  const w = opts.w ?? 140
  const h = opts.h ?? 40
  // The FILL is the wobbly shape itself (the SVG path is filled), so the colour
  // never pokes a hard rectangle past the sketched outline. Tinted buttons fill
  // the shape with the tint; plain buttons fill with cream paper. The faint
  // paper texture sits UNDER, clipped to the same shape by an inset border-radius.
  const fill = opts.tint ?? PAPER
  // ONE filled-shape SVG is the whole button surface — no separate rectangular
  // layer to overflow the outline. Transparent elsewhere so corners stay clean.
  btn.style.backgroundImage = inkFrameUrl(w, h, INK, opts.big ? 3.2 : 2.6, fill)
  btn.style.backgroundSize = '100% 100%'
  btn.style.backgroundRepeat = 'no-repeat'
  btn.style.backgroundColor = 'transparent'
  btn.style.border = 'none'
  btn.style.color = opts.tint ? '#fdfaf0' : INK
  btn.style.fontFamily = FONT_HEAD
  btn.style.fontWeight = '800'
  btn.style.cursor = 'pointer'
  btn.style.textShadow = opts.tint ? '0 1px 1px rgba(40,34,26,0.55)' : 'none'
  // drop shadow OFFSET so it doesn't leak past the wobble either
  btn.style.boxShadow = 'none'
  btn.style.filter = 'drop-shadow(0 2px 0 rgba(74,68,60,0.18))'
}
