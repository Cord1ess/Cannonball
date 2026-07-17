/**
 * M1 HUD: plain DOM overlay — tick timer, per-zone danger meters, wedge
 * alarm vignette, death/win overlays, pointer-lock hint. Paper-and-ink
 * skin lands in M5; this is layout + information only.
 */

export interface HudZone {
  color: string
  frac: number
  isPlayer: boolean
}

export interface HudState {
  tickRemaining: number
  zones: readonly HudZone[]
  alarm: boolean
  locked: boolean
}

export interface Hud {
  update(state: HudState): void
  showEnd(text: string | null): void
}

export function createHud(): Hud {
  const root = document.createElement('div')
  root.style.cssText =
    'position:fixed;inset:0;pointer-events:none;font-family:system-ui,sans-serif;user-select:none;'
  document.body.appendChild(root)

  const timer = document.createElement('div')
  timer.style.cssText =
    'position:absolute;top:16px;left:50%;transform:translateX(-50%);font-size:44px;font-weight:800;color:#4a443c;text-shadow:0 1px 0 #fff8;'
  root.appendChild(timer)

  const meterRow = document.createElement('div')
  meterRow.style.cssText =
    'position:absolute;top:74px;left:50%;transform:translateX(-50%);display:flex;gap:8px;'
  root.appendChild(meterRow)

  const alarm = document.createElement('div')
  alarm.style.cssText =
    'position:absolute;inset:0;box-shadow:inset 0 0 90px 24px rgba(217,108,108,0.55);opacity:0;transition:opacity 140ms;'
  root.appendChild(alarm)

  const hint = document.createElement('div')
  hint.style.cssText =
    'position:absolute;bottom:26px;left:50%;transform:translateX(-50%);font-size:16px;color:#4a443c;background:#fffdf5cc;padding:6px 14px;border-radius:8px;'
  hint.textContent = 'click to grab the mouse — WASD move, Space jump, jump into the ball to header it'
  root.appendChild(hint)

  const end = document.createElement('div')
  end.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;font-size:42px;font-weight:800;color:#fffdf5;background:rgba(74,68,60,0.55);text-align:center;white-space:pre-line;'
  root.appendChild(end)

  const bars: HTMLDivElement[] = []
  const fills: HTMLDivElement[] = []

  function rebuildBars(count: number): void {
    meterRow.replaceChildren()
    bars.length = 0
    fills.length = 0
    for (let i = 0; i < count; i++) {
      const bar = document.createElement('div')
      bar.style.cssText =
        'width:74px;height:14px;background:#fffdf5aa;border:2px solid #4a443c;border-radius:6px;overflow:hidden;'
      const fill = document.createElement('div')
      fill.style.cssText = 'height:100%;width:0%;'
      bar.appendChild(fill)
      meterRow.appendChild(bar)
      bars.push(bar)
      fills.push(fill)
    }
  }

  return {
    update(state: HudState): void {
      timer.textContent = Math.ceil(state.tickRemaining).toString()
      if (bars.length !== state.zones.length) rebuildBars(state.zones.length)
      for (let i = 0; i < state.zones.length; i++) {
        const zone = state.zones[i]!
        const fill = fills[i]!
        const bar = bars[i]!
        fill.style.background = zone.color
        fill.style.width = `${Math.min(100, zone.frac * 100).toFixed(1)}%`
        bar.style.outline = zone.isPlayer ? '3px solid #4a443c' : 'none'
      }
      alarm.style.opacity = state.alarm ? '1' : '0'
      hint.style.display = state.locked ? 'none' : 'block'
    },
    showEnd(text: string | null): void {
      if (text === null) {
        end.style.display = 'none'
      } else {
        end.textContent = text
        end.style.display = 'flex'
      }
    },
  }
}
