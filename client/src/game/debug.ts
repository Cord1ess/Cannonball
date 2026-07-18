import * as THREE from 'three'
import { createDebugDraw, type DebugDraw } from '@vendor/debug/debug-draw.ts'

/**
 * Dev/debug suite. Backquote (`) toggles the panel, G toggles ghost overlays.
 * Panel buttons need the pointer unlocked (hit Esc first).
 *
 * Ghost overlays draw SERVER truth against local prediction using the
 * vendored immediate-mode line accumulator — magenta box = my server body,
 * cyan sphere = server ball, yellow line = local->server ball error.
 */

export interface DebugHooks {
  label: string
  /** debug commands: skipPhase | resetRound | resetLobby | winMe | elimMe |
   *  botPlus | botMinus | clearBots | freeze | addTime | subTime | resetScore |
   *  slowmo | ballToMe | resetBall | windToggle | nightCycle */
  send(cmd: string): void
  /** per-frame stats, rendered in the panel */
  info(): Record<string, string | number>
  /** draw server-truth ghosts (online mode only) */
  ghosts?(draw: DebugDraw): void
}

export interface DebugPanel {
  update(dt: number): void
}

/** a debug button: label, command, and whether it's a toggle (shows on/off) */
interface DbgBtn {
  label: string
  cmd: string
  toggle?: boolean
}
const GROUPS: ReadonlyArray<{ title: string; btns: DbgBtn[] }> = [
  {
    title: 'flow',
    btns: [
      { label: 'skip phase »', cmd: 'skipPhase' },
      { label: 'reset round', cmd: 'resetRound' },
      { label: 'reset lobby', cmd: 'resetLobby' },
      { label: 'win me', cmd: 'winMe' },
      { label: 'eliminate me', cmd: 'elimMe' },
    ],
  },
  {
    title: 'players',
    btns: [
      { label: '+ bot', cmd: 'botPlus' },
      { label: '− bot', cmd: 'botMinus' },
      { label: 'clear bots', cmd: 'clearBots' },
    ],
  },
  {
    title: 'clock & score',
    btns: [
      { label: 'freeze ticks', cmd: 'freeze', toggle: true },
      { label: '+15s', cmd: 'addTime' },
      { label: '−15s', cmd: 'subTime' },
      { label: 'reset score', cmd: 'resetScore' },
      { label: 'slow-mo', cmd: 'slowmo', toggle: true },
    ],
  },
  {
    title: 'ball & wind',
    btns: [
      { label: 'ball to me', cmd: 'ballToMe' },
      { label: 'reset ball', cmd: 'resetBall' },
      { label: 'toggle wind', cmd: 'windToggle', toggle: true },
    ],
  },
  {
    title: 'world',
    btns: [{ label: 'night ↔ day', cmd: 'nightCycle', toggle: true }],
  },
]

export function createDebugPanel(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  hooks: DebugHooks,
): DebugPanel {
  let panelOn = false
  let ghostsOn = false

  // --- DOM panel: ACCORDION (one group open at a time, no vertical scroll) --------
  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:10px;left:10px;width:250px;background:#1c1a18f0;color:#f2eddc;' +
    'font:11px/1.4 ui-monospace,monospace;padding:8px;border-radius:8px;display:none;' +
    'pointer-events:auto;z-index:50;user-select:none;'
  document.body.appendChild(panel)

  const title = document.createElement('div')
  title.textContent = `DEBUG — ${hooks.label}`
  title.style.cssText = 'font-weight:700;margin-bottom:6px;color:#f2c078;font-size:10px;'
  panel.appendChild(title)

  const toggleState = new Map<string, boolean>()
  const paintToggle = (btn: HTMLButtonElement, on: boolean): void => {
    btn.style.background = on ? '#4fa3d8' : '#4a443c'
    btn.style.color = on ? '#08121a' : '#f2eddc'
  }
  const makeBtn = (label: string, cmd: string, toggle: boolean): HTMLButtonElement => {
    const button = document.createElement('button')
    button.textContent = label
    button.style.cssText =
      'font:10px ui-monospace,monospace;background:#4a443c;color:#f2eddc;border:0;' +
      'border-radius:4px;padding:4px 7px;cursor:pointer;transition:background 90ms;'
    if (toggle) toggleState.set(cmd, false)
    button.addEventListener('click', (e) => {
      e.stopPropagation()
      hooks.send(cmd)
      if (toggle) {
        const next = !toggleState.get(cmd)
        toggleState.set(cmd, next)
        paintToggle(button, next)
      } else {
        button.style.background = '#f2c078'
        button.style.color = '#1c1a18'
        setTimeout(() => {
          button.style.background = '#4a443c'
          button.style.color = '#f2eddc'
        }, 130)
      }
    })
    return button
  }

  // build one accordion section per group + a room section
  const bodies: HTMLDivElement[] = []
  const carets: HTMLSpanElement[] = []
  const openSection = (idx: number): void => {
    bodies.forEach((b, i) => {
      const open = i === idx
      b.style.display = open ? 'flex' : 'none'
      carets[i]!.textContent = open ? '▾' : '▸'
    })
  }
  const sections: Array<{ title: string; build: (row: HTMLDivElement) => void }> = GROUPS.map((g) => ({
    title: g.title,
    build: (row) => {
      for (const b of g.btns) row.appendChild(makeBtn(b.label, b.cmd, b.toggle ?? false))
    },
  }))
  sections.push({
    title: 'room',
    build: (row) => {
      const fresh = makeBtn('new room', '__fresh', false)
      fresh.style.background = '#d96c6c'
      fresh.style.color = '#fff'
      fresh.addEventListener('click', () => {
        sessionStorage.removeItem('cannonball:reconnection')
        location.href = `${location.pathname}?fresh`
      })
      row.appendChild(fresh)
    },
  })
  sections.forEach((sec, idx) => {
    const header = document.createElement('div')
    header.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;cursor:pointer;' +
      'padding:4px 6px;margin-top:3px;background:#00000030;border-radius:4px;color:#d8cdb8;' +
      'font-size:9px;letter-spacing:1px;text-transform:uppercase;'
    const caret = document.createElement('span')
    caret.textContent = '▸'
    header.append(sec.title, caret)
    const body = document.createElement('div')
    body.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;padding:5px 2px;'
    sec.build(body)
    bodies.push(body)
    carets.push(caret)
    header.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none'
      openSection(isOpen ? -1 : idx)
    })
    panel.append(header, body)
  })
  openSection(0) // start with the first group open

  const stats = document.createElement('pre')
  stats.style.cssText = 'margin:6px 0 0;white-space:pre-wrap;font-size:10px;'
  panel.appendChild(stats)

  const help = document.createElement('div')
  help.textContent = '` panel · G ghosts · ?dev · ?fast · ?fresh'
  help.style.cssText = 'margin-top:6px;color:#9b948a;font-size:9px;'
  panel.appendChild(help)

  // --- ghost overlay (vendored debug-draw over one LineSegments) ---------------------
  const lineGeo = new THREE.BufferGeometry()
  let capacity = 0
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true })
  const lines = new THREE.LineSegments(lineGeo, lineMat)
  lines.frustumCulled = false
  lines.renderOrder = 999
  lines.visible = false
  scene.add(lines)

  const sink = {
    drawDebugLines(batch: { count: number; positions: Float32Array; colors: Float32Array }): void {
      const needed = batch.count * 2
      if (needed > capacity) {
        capacity = Math.max(needed, capacity * 2, 256)
        lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))
        lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))
        ;(lineGeo.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage)
        ;(lineGeo.getAttribute('color') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage)
      }
      const pos = lineGeo.getAttribute('position') as THREE.BufferAttribute
      const col = lineGeo.getAttribute('color') as THREE.BufferAttribute
      ;(pos.array as Float32Array).set(batch.positions.subarray(0, batch.count * 6))
      ;(col.array as Float32Array).set(batch.colors.subarray(0, batch.count * 6))
      pos.needsUpdate = true
      col.needsUpdate = true
      lineGeo.setDrawRange(0, needed)
    },
  }
  const draw = createDebugDraw(sink)

  // --- key handling (raw listeners: works regardless of pointer lock) ----------------
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Backquote') {
      panelOn = !panelOn
      panel.style.display = panelOn ? 'block' : 'none'
    }
    if (event.code === 'KeyG') {
      ghostsOn = !ghostsOn
      lines.visible = ghostsOn
    }
  })

  let fps = 60
  let statsTimer = 0

  return {
    update(dt: number): void {
      if (dt > 0) fps += (1 / dt - fps) * 0.05

      if (ghostsOn && hooks.ghosts) {
        hooks.ghosts(draw)
        draw.flush()
      } else if (lineGeo.drawRange.count !== 0 && !ghostsOn) {
        lineGeo.setDrawRange(0, 0)
      }

      if (!panelOn) return
      statsTimer -= dt
      if (statsTimer > 0) return
      statsTimer = 0.15

      const info = hooks.info()
      const rendererInfo = renderer.info.render
      let text =
        `fps        ${fps.toFixed(0)}\n` +
        `draw calls ${rendererInfo.calls}   tris ${rendererInfo.triangles}\n`
      for (const [key, value] of Object.entries(info)) {
        text += `${key.padEnd(10)} ${value}\n`
      }
      stats.textContent = text
    },
  }
}
