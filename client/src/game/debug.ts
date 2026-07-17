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
  /** debug commands: skipPhase | botPlus | botMinus | freeze | resetRound |
   *  resetBall | ballToMe | windToggle | elimMe */
  send(cmd: string): void
  /** per-frame stats, rendered in the panel */
  info(): Record<string, string | number>
  /** draw server-truth ghosts (online mode only) */
  ghosts?(draw: DebugDraw): void
}

export interface DebugPanel {
  update(dt: number): void
}

const BUTTONS: ReadonlyArray<readonly [string, string]> = [
  // fast iteration: skip drives the whole flow, bots join/leave LIVE mid-match,
  // freeze stops the match clock (ticks/eliminations) while physics stays on
  ['skip phase »', 'skipPhase'],
  ['+ bot live', 'botPlus'],
  ['− bot live', 'botMinus'],
  ['freeze ticks', 'freeze'],
  ['reset round', 'resetRound'],
  ['reset ball', 'resetBall'],
  ['ball to me', 'ballToMe'],
  ['toggle wind', 'windToggle'],
  ['eliminate me', 'elimMe'],
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
    'position:fixed;top:10px;right:10px;width:250px;background:#1c1a18e0;color:#f2eddc;' +
    'font:11px/1.5 ui-monospace,monospace;padding:10px;border-radius:8px;display:none;' +
    'pointer-events:auto;z-index:50;user-select:none;'
  document.body.appendChild(panel)

  const title = document.createElement('div')
  title.textContent = `DEBUG — ${hooks.label} (Esc to unlock mouse)`
  title.style.cssText = 'font-weight:700;margin-bottom:6px;color:#f2c078;'
  panel.appendChild(title)

  const buttonRow = document.createElement('div')
  buttonRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;'
  panel.appendChild(buttonRow)
  for (const [label, cmd] of BUTTONS) {
    const button = document.createElement('button')
    button.textContent = label
    button.style.cssText =
      'font:10px ui-monospace,monospace;background:#4a443c;color:#f2eddc;border:0;' +
      'border-radius:4px;padding:3px 7px;cursor:pointer;'
    button.addEventListener('click', () => hooks.send(cmd))
    buttonRow.appendChild(button)
  }
  const freshButton = document.createElement('button')
  freshButton.textContent = 'new room'
  freshButton.style.cssText =
    'font:10px ui-monospace,monospace;background:#d96c6c;color:#fff;border:0;border-radius:4px;padding:3px 7px;cursor:pointer;'
  freshButton.addEventListener('click', () => {
    sessionStorage.removeItem('cannonball:reconnection')
    location.href = `${location.pathname}?fresh`
  })
  buttonRow.appendChild(freshButton)

  const stats = document.createElement('pre')
  stats.style.cssText = 'margin:0;white-space:pre-wrap;'
  panel.appendChild(stats)

  const help = document.createElement('div')
  help.textContent = '` panel · G ghosts · ?lag=100 · ?offline · ?fresh · ?fast (0.15x timers)'
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
