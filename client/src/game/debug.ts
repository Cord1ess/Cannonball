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
   *  slowmo | ballToMe | resetBall | windToggle */
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
]

export function createDebugPanel(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  hooks: DebugHooks,
): DebugPanel {
  let panelOn = false
  let ghostsOn = false

  // --- DOM panel -------------------------------------------------------------------
  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:10px;left:10px;width:270px;max-height:94vh;overflow-y:auto;' +
    'background:#1c1a18f0;color:#f2eddc;font:11px/1.5 ui-monospace,monospace;padding:10px;' +
    'border-radius:8px;display:none;pointer-events:auto;z-index:50;user-select:none;'
  document.body.appendChild(panel)

  const title = document.createElement('div')
  title.textContent = `DEBUG — ${hooks.label} (Esc to unlock mouse)`
  title.style.cssText = 'font-weight:700;margin-bottom:6px;color:#f2c078;'
  panel.appendChild(title)

  // grouped buttons; toggles keep an on/off state + a click flash for feedback
  const toggleState = new Map<string, boolean>()
  const toggleButtons = new Map<string, HTMLButtonElement>()
  const paintToggle = (btn: HTMLButtonElement, on: boolean): void => {
    btn.style.background = on ? '#4fa3d8' : '#4a443c'
    btn.style.color = on ? '#08121a' : '#f2eddc'
  }
  for (const group of GROUPS) {
    const gLabel = document.createElement('div')
    gLabel.textContent = group.title
    gLabel.style.cssText = 'color:#9b948a;margin:6px 0 2px;font-size:9px;letter-spacing:1px;text-transform:uppercase;'
    panel.appendChild(gLabel)
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;'
    panel.appendChild(row)
    for (const b of group.btns) {
      const button = document.createElement('button')
      button.textContent = b.label
      button.style.cssText =
        'font:10px ui-monospace,monospace;background:#4a443c;color:#f2eddc;border:0;' +
        'border-radius:4px;padding:4px 8px;cursor:pointer;transition:background 90ms;'
      if (b.toggle) {
        toggleState.set(b.cmd, false)
        toggleButtons.set(b.cmd, button)
      }
      button.addEventListener('click', () => {
        hooks.send(b.cmd)
        if (b.toggle) {
          const next = !toggleState.get(b.cmd)
          toggleState.set(b.cmd, next)
          paintToggle(button, next)
        } else {
          // click flash so momentary actions give feedback
          button.style.background = '#f2c078'
          button.style.color = '#1c1a18'
          setTimeout(() => {
            button.style.background = '#4a443c'
            button.style.color = '#f2eddc'
          }, 130)
        }
      })
      row.appendChild(button)
    }
  }
  const roomLabel = document.createElement('div')
  roomLabel.textContent = 'room'
  roomLabel.style.cssText = 'color:#9b948a;margin:6px 0 2px;font-size:9px;letter-spacing:1px;text-transform:uppercase;'
  panel.appendChild(roomLabel)
  const freshButton = document.createElement('button')
  freshButton.textContent = 'new room'
  freshButton.style.cssText =
    'font:10px ui-monospace,monospace;background:#d96c6c;color:#fff;border:0;border-radius:4px;padding:4px 8px;cursor:pointer;margin-bottom:6px;'
  freshButton.addEventListener('click', () => {
    sessionStorage.removeItem('cannonball:reconnection')
    location.href = `${location.pathname}?fresh`
  })
  panel.appendChild(freshButton)

  const stats = document.createElement('pre')
  stats.style.cssText = 'margin:0;white-space:pre-wrap;'
  panel.appendChild(stats)

  const help = document.createElement('div')
  help.textContent =
    '` panel · G ghosts · ?dev (reload = instant live arena) · ?fast (0.15x timers) · ?lag=100 · ?offline · ?fresh'
  help.style.cssText = 'margin-top:6px;color:#9b948a;'
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
