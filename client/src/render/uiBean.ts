import * as THREE from 'three'
import { createBean, type Bean } from './bean.ts'
import { PALETTE } from './palette.ts'
import type { KitColors } from '@shared/cosmetics/jerseys.ts'

/**
 * LIVELY UI CHARACTERS (menu/lobby remake). Instead of static portraits, every
 * character slot in the UI (jersey picker, joined players, bots) is a REAL 3D
 * bean — the same `createBean()` used in-world — blinking, idling, emoting.
 *
 * RENDERING: each slot owns its OWN <canvas> element inserted into its DOM box
 * (so it sits ON TOP of the opaque paper panel — z-order correct). One shared
 * offscreen WebGLRenderer draws the bean into a small buffer, then we blit that
 * buffer into every slot's 2D canvas each frame. This replaces the old
 * scissor-viewport-into-the-main-canvas trick, which rendered BEHIND the opaque
 * menu panel and only ever peeked out where a bean spilled past the panel edge
 * (the "half a model on top, half on the bottom" + "no model at all" bugs).
 * One offscreen GL context, N cheap canvas blits — no per-slot WebGL context.
 */

const BUF = 256 // offscreen render buffer size (square, DPR-independent)

export interface UiBeanSlot {
  /** the DOM element this bean renders inside (its own <canvas> is appended);
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
  /** render every active slot into its own canvas (call after the main render) */
  render(mainRenderer: THREE.WebGLRenderer): void
  dispose(): void
}

interface Entry {
  bean: Bean
  anchor: HTMLElement
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
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

  // one shared OFFSCREEN renderer — transparent bg so beans blit cleanly onto
  // the paper card behind them. Kept small (square) and DPR 1: it's a source
  // buffer we scale into each slot canvas, so device pixels don't matter here.
  const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false })
  gl.setPixelRatio(1)
  gl.setSize(BUF, BUF, false)
  gl.setClearColor(0x000000, 0)

  const entries: Entry[] = []

  function hostCanvas(anchor: HTMLElement, canvas: HTMLCanvasElement): void {
    // the anchor box defines the visible size + framing; the canvas fills it and
    // is clipped to it. Force the box to be a positioning context + clip so the
    // absolutely-positioned canvas can NEVER escape it (a detached element can
    // report position:'' not 'static', so set it unconditionally — otherwise the
    // canvas anchors to the viewport and renders full-screen).
    anchor.style.position = 'relative'
    anchor.style.overflow = 'hidden'
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;pointer-events:none;'
    anchor.appendChild(canvas)
  }
  function makeCanvas(anchor: HTMLElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
    const canvas = document.createElement('canvas')
    hostCanvas(anchor, canvas)
    return { canvas, ctx: canvas.getContext('2d') }
  }

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
      const { canvas, ctx } = makeCanvas(anchor)
      const entry: Entry = {
        bean,
        anchor,
        canvas,
        ctx,
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
          // re-home the slot's own canvas into the new card element
          entry.anchor = el
          hostCanvas(el, entry.canvas)
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
          entry.canvas.style.display = on ? 'block' : 'none'
        },
        dispose() {
          const i = entries.indexOf(entry)
          if (i >= 0) entries.splice(i, 1)
          scene.remove(entry.bean.group)
          entry.bean.dispose()
          entry.canvas.remove()
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    render(_mainRenderer) {
      // frame the WHOLE bean (~1.7 tall, centred ~y=0.95) squarely in the buffer
      cam.aspect = 1
      cam.position.set(0, 1.0, 3.0)
      cam.lookAt(0, 0.95, 0)
      cam.updateProjectionMatrix()
      for (const e of entries) {
        if (!e.active || !e.ctx || !e.anchor.isConnected) continue
        // skip totally off-screen cards (menu can scroll) — cheap guard
        const r = e.anchor.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        // isolate: only this bean is visible during its pass
        for (const other of entries) other.bean.group.visible = other === e
        gl.render(scene, cam)
        // blit the offscreen buffer into this slot's own canvas (clear first so
        // the transparent bg shows the paper card through it)
        if (e.canvas.width !== BUF) {
          e.canvas.width = BUF
          e.canvas.height = BUF
        }
        e.ctx.clearRect(0, 0, BUF, BUF)
        e.ctx.drawImage(gl.domElement, 0, 0, BUF, BUF)
      }
      for (const e of entries) e.bean.group.visible = e.active
    },

    dispose() {
      for (const e of entries.slice()) {
        scene.remove(e.bean.group)
        e.bean.dispose()
        e.canvas.remove()
      }
      entries.length = 0
      gl.dispose()
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
