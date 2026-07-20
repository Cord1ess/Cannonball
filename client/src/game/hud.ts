/**
 * The in-play HUD overlay: wedge alarm vignette, stamina brush-bar, ability
 * chip, pointer-lock hint, death/win overlay. Wears the paper-and-ink skin
 * (art_direction.md §9) — paper panels, wobbly ink frames, brush-stroke bars,
 * Baloo 2 / Patrick Hand fonts. (The old tick timer + per-zone meter row are
 * the leaderboard HUD's job now and stay hidden.)
 */
import { brushFill, FONT_HAND, FONT_HEAD, INK, METER, paperPanel, paperTexture } from './paperSkin.ts'

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
  root.className = 'game-overlay' // hidden while the main menu is up
  root.style.cssText =
    `position:fixed;inset:0;pointer-events:none;font-family:${FONT_HEAD};user-select:none;`
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

  // STAMINA — a labelled bar; the fill is inset well INSIDE the wobbly ink frame
  // (rounded track) so the coloured fill can never poke past the sketched outline.
  const staminaWrap = document.createElement('div')
  staminaWrap.style.cssText =
    'position:absolute;bottom:58px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:3px;'
  const staminaLabel = document.createElement('div')
  staminaLabel.style.cssText = `font-family:${FONT_HEAD};font-size:11px;letter-spacing:2px;color:${INK};opacity:0.8;`
  staminaLabel.textContent = 'STAMINA'
  const staminaBar = document.createElement('div')
  staminaBar.style.cssText = 'position:relative;width:240px;height:20px;'
  paperPanel(staminaBar, { w: 240, h: 20, weight: 2.4 })
  // the TRACK is inset 5px from the frame on all sides + rounded, so the fill
  // stays strictly inside the wobbly outline
  const staminaTrack = document.createElement('div')
  staminaTrack.style.cssText =
    'position:absolute;left:6px;right:6px;top:5px;bottom:5px;border-radius:6px;overflow:hidden;background:rgba(74,68,60,0.12);'
  const staminaFill = document.createElement('div')
  staminaFill.style.cssText = `height:100%;width:100%;background:${brushFill(METER.warn)};transition:width 90ms linear,background 150ms;`
  staminaTrack.appendChild(staminaFill)
  staminaBar.appendChild(staminaTrack)
  staminaWrap.append(staminaLabel, staminaBar)
  root.appendChild(staminaWrap)

  // ABILITY — a labelled chip to the right of the stamina bar; the cooldown wipe
  // is inset inside the frame the same way.
  const abilityChip = document.createElement('div')
  abilityChip.style.cssText =
    'position:absolute;bottom:58px;left:calc(50% + 150px);width:112px;height:44px;' +
    `font-family:${FONT_HEAD};font-size:13px;color:${INK};display:none;align-items:center;justify-content:center;text-align:center;`
  paperPanel(abilityChip, { w: 112, h: 44, weight: 2.4 })
  const abilityFill = document.createElement('div')
  abilityFill.style.cssText =
    'position:absolute;left:6px;right:6px;top:5px;bottom:5px;border-radius:6px;background:rgba(79,163,216,0.5);transform-origin:left;transition:transform 90ms linear;'
  const abilityLabel = document.createElement('span')
  abilityLabel.style.cssText = 'position:relative;padding:0 6px;line-height:1.05;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100px;'
  abilityChip.appendChild(abilityFill)
  abilityChip.appendChild(abilityLabel)
  root.appendChild(abilityChip)

  const hint = document.createElement('div')
  hint.style.cssText =
    `position:absolute;bottom:24px;left:50%;transform:translateX(-50%);font-family:${FONT_HAND};font-size:18px;color:${INK};padding:6px 18px;`
  paperPanel(hint, { w: 720, h: 34, weight: 2 })
  hint.textContent =
    'click to grab the mouse — WASD run, Shift sprint, Space jump, Click/Ctrl mid-air to DIVE, Q/E tilt'
  root.appendChild(hint)

  const end = document.createElement('div')
  end.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;white-space:pre-line;' +
    `font-family:${FONT_HEAD};font-size:44px;font-weight:800;color:${INK};` +
    `background:rgba(246,241,226,0.30);backdrop-filter:blur(1px);`
  const endCard = document.createElement('div')
  endCard.style.cssText = `padding:26px 54px;color:${INK};`
  paperPanel(endCard, { w: 520, h: 180, weight: 3.4 })
  end.appendChild(endCard)
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
      staminaFill.style.background = brushFill(state.stamina < 0.3 ? METER.danger : METER.warn)
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
        endCard.textContent = text
        end.style.display = 'flex'
      }
    },
  }
}
