import * as THREE from 'three'
import { createBean, type Bean } from './bean.ts'
import { PALETTE } from './palette.ts'
import type { KitColors } from '@shared/cosmetics/jerseys.ts'

/**
 * LIVELY UI CHARACTERS (menu/lobby remake). Instead of static portraits, every
 * character slot in the UI (jersey picker, joined players, bots) is a REAL 3D
 * bean — the same `createBean()` used in-world — blinking, idling, emoting.
 *
 * One shared mini-scene holds a pool of beans, each pinned to a DOM anchor
 * element. Every frame we render each active bean into a small scissor viewport
 * positioned over its anchor (the PIP-selfie technique), so the beans float in
 * their UI cards with true 3D shading + the built-in blink/fidget animation.
 * One renderer, N cheap viewport passes — no per-slot WebGL context.
 */

export interface UiBeanSlot {
  /** the DOM element this bean renders on top of (the manager reads its rect);
   *  writable so a slot can be re-anchored to a fresh card on a roster rebuild */
  anchor: HTMLElement
  setKit(kit: KitColors): void
  /** trigger a one-shot celebratory pop (header snap) — used on join/select */
  pop(): void
  /** hide/show without destroying */
  setActive(on: boolean): void
  dispose(): void
}

export interface UiBeanStage {
  /** claim a slot bound to a DOM anchor; give it a starting kit */
  slot(anchor: HTMLElement, kit: KitColors): UiBeanSlot
  /** advance all bean animations */
  update(dt: number): void
  /** render every active slot into its anchor's viewport (call after main render) */
  render(renderer: THREE.WebGLRenderer): void
  dispose(): void
}

interface Entry {
  bean: Bean
  anchor: HTMLElement
  kit: KitColors
  active: boolean
  spin: number // slow idle turn so they show off the jersey
  bob: number // per-slot phase offset so they don't sync
  emoteT: number
}

export function createUiBeanStage(): UiBeanStage {
  // a private scene lit warmly so the toon beans shade the same as in-world
  const scene = new THREE.Scene()
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  const key = new THREE.DirectionalLight(0xfff4e2, 1.3)
  key.position.set(2.5, 4, 3)
  scene.add(key)
  scene.add(new THREE.HemisphereLight(0xdcefe8, 0xcbbfa6, 0.85))

  const entries: Entry[] = []

  function rebuildBean(e: Entry): void {
    scene.remove(e.bean.group)
    e.bean.dispose()
    e.bean = createBean(e.kit)
    scene.add(e.bean.group)
  }

  return {
    slot(anchor, kit): UiBeanSlot {
      const bean = createBean(kit)
      scene.add(bean.group)
      const entry: Entry = {
        bean,
        anchor,
        kit,
        active: true,
        spin: Math.random() * Math.PI * 2,
        bob: Math.random() * Math.PI * 2,
        emoteT: 2 + Math.random() * 4,
      }
      entries.push(entry)
      return {
        get anchor() {
          return entry.anchor
        },
        set anchor(el: HTMLElement) {
          entry.anchor = el
        },
        setKit(k) {
          entry.kit = k
          rebuildBean(entry)
        },
        pop() {
          entry.bean.header()
        },
        setActive(on) {
          entry.active = on
          entry.bean.group.visible = on
        },
        dispose() {
          const i = entries.indexOf(entry)
          if (i >= 0) entries.splice(i, 1)
          scene.remove(entry.bean.group)
          entry.bean.dispose()
        },
      }
    },

    update(dt) {
      for (const e of entries) {
        if (!e.active) continue
        e.spin += dt * 0.5 // slow show-off turn
        e.bob += dt
        e.emoteT -= dt
        // occasional little celebratory pop so the roster feels alive
        if (e.emoteT <= 0) {
          e.emoteT = 3 + Math.random() * 5
          if (Math.random() < 0.5) e.bean.header()
        }
        // gentle idle bounce + look-around; the bean rig blinks/fidgets itself
        const bounce = Math.abs(Math.sin(e.bob * 2)) * 0.06
        e.bean.update(dt, {
          x: 0,
          y: bounce,
          z: 0,
          yaw: Math.sin(e.spin) * 0.6, // rock left/right showing the kit
          run: 0,
          grounded: true,
          diving: false,
          knocked: false,
          sprinting: false,
          lean: 0,
          lookX: Math.sin(e.bob * 0.7) * 0.5,
          lookY: 0.2,
        })
      }
    },

    render(renderer) {
      const canvas = renderer.domElement
      const cssH = canvas.clientHeight
      // the GL drawing buffer is in DEVICE pixels; getBoundingClientRect is in
      // CSS pixels — scale by the renderer's pixel ratio or the viewports land
      // in the wrong place on hi-dpi / devicePixelRatio != 1.
      // NOTE: three.js setViewport/setScissor multiply by the renderer's pixel
      // ratio INTERNALLY, so pass CSS pixels here — NOT device pixels (doing the
      // ×dpr ourselves double-applied it and threw the bean off its card).
      for (const e of entries) {
        if (!e.active || !e.anchor.isConnected) continue
        const r = e.anchor.getBoundingClientRect()
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > cssH) continue
        // gl viewport origin is bottom-left; DOM is top-left → flip Y
        const px = Math.round(r.left)
        const py = Math.round(cssH - r.bottom)
        const w = Math.round(r.width)
        const h = Math.round(r.height)
        // set viewport + scissor + enable the test PER PASS, right before the
        // render (three.js's render() manages viewport/scissor state, so setting
        // it once outside the loop gets clobbered — mirror the PIP-cam pattern).
        cam.aspect = w / h
        cam.position.set(0, 1.2, 2.4) // close in so the bean FILLS the card
        cam.lookAt(0, 1.0, 0)
        cam.updateProjectionMatrix()
        // isolate: only this entry's bean is visible during its pass
        for (const other of entries) other.bean.group.visible = other === e && e.active
        renderer.setViewport(px, py, w, h)
        renderer.setScissor(px, py, w, h)
        renderer.setScissorTest(true)
        renderer.render(scene, cam)
        renderer.setScissorTest(false)
      }
      for (const e of entries) e.bean.group.visible = e.active
      // restore full viewport for the next main render (CSS px — see note above)
      renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight)
    },

    dispose() {
      for (const e of entries.slice()) {
        scene.remove(e.bean.group)
        e.bean.dispose()
      }
      entries.length = 0
    },
  }
}

/** a neutral fallback kit for a UI bean when no real kit is known yet */
export const NEUTRAL_UI_KIT: KitColors = {
  primary: PALETTE.warmGray,
  secondary: PALETTE.offWhite,
  pattern: 'solid',
  shorts: PALETTE.ink,
}
