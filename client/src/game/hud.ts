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
  /** 0..1 — sprint/dive energy */
  stamina: number
  ability: { id: string; cdFrac: number } | null
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

  // timer + per-zone meters are now the leaderboard HUD's job — keep the
  // elements (update() still writes them) but hide them so nothing double-draws
  const timer = document.createElement('div')
  timer.style.cssText =
    'position:absolute;top:16px;left:50%;transform:translateX(-50%);font-size:44px;font-weight:800;color:#4a443c;text-shadow:0 1px 0 #fff8;display:none;'
  root.appendChild(timer)

  const meterRow = document.createElement('div')
  meterRow.style.cssText =
    'position:absolute;top:74px;left:50%;transform:translateX(-50%);display:none;gap:8px;'
  root.appendChild(meterRow)

  const alarm = document.createElement('div')
  alarm.style.cssText =
    'position:absolute;inset:0;box-shadow:inset 0 0 90px 24px rgba(217,108,108,0.55);opacity:0;transition:opacity 140ms;'
  root.appendChild(alarm)

  const staminaBar = document.createElement('div')
  staminaBar.style.cssText =
    'position:absolute;bottom:64px;left:50%;transform:translateX(-50%);width:220px;height:12px;background:#fffdf5aa;border:2px solid #4a443c;border-radius:6px;overflow:hidden;'
  const staminaFill = document.createElement('div')
  staminaFill.style.cssText = 'height:100%;width:100%;background:#f2c078;transition:background 150ms;'
  staminaBar.appendChild(staminaFill)
  root.appendChild(staminaBar)

  const abilityChip = document.createElement('div')
  abilityChip.style.cssText =
    'position:absolute;bottom:56px;left:calc(50% + 130px);width:88px;height:26px;background:#fffdf5aa;' +
    'border:2px solid #4a443c;border-radius:8px;overflow:hidden;font:700 11px system-ui;color:#4a443c;' +
    'display:none;align-items:center;justify-content:center;'
  const abilityFill = document.createElement('div')
  abilityFill.style.cssText = 'position:absolute;inset:0;background:#4fa3d888;transform-origin:left;'
  const abilityLabel = document.createElement('span')
  abilityLabel.style.cssText = 'position:relative;'
  abilityChip.appendChild(abilityFill)
  abilityChip.appendChild(abilityLabel)
  root.appendChild(abilityChip)

  const hint = document.createElement('div')
  hint.style.cssText =
    'position:absolute;bottom:26px;left:50%;transform:translateX(-50%);font-size:16px;color:#4a443c;background:#fffdf5cc;padding:6px 14px;border-radius:8px;'
  hint.textContent =
    'click to grab the mouse — WASD run, Shift sprint, Space jump, Click/Ctrl mid-air to DIVE, Q/E tilt'
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
      timer.textContent = Number.isFinite(state.tickRemaining) ? Math.ceil(state.tickRemaining).toString() : ''
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
      staminaFill.style.width = `${Math.max(0, Math.min(100, state.stamina * 100)).toFixed(1)}%`
      staminaFill.style.background = state.stamina < 0.3 ? '#d96c6c' : '#f2c078'
      if (state.ability) {
        abilityChip.style.display = 'flex'
        abilityLabel.textContent = state.ability.cdFrac > 0.01 ? state.ability.id : `${state.ability.id} ✔`
        abilityFill.style.transform = `scaleX(${(1 - state.ability.cdFrac).toFixed(3)})`
      } else {
        abilityChip.style.display = 'none'
      }
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
