import { kitColors } from '@shared/cosmetics/jerseys.ts'
import type { LeaderRow, MatchClient } from './online.ts'
import { brushFill, FONT_HAND, FONT_HEAD, INK, inkFrameUrl, METER, PAPER, paperPanel, paperTexture } from './paperSkin.ts'

/**
 * The match HUD (M5b): a big center "next elimination" countdown + a right-side
 * LEADERBOARD that ranks alive players by elimination risk. Each row has a
 * little bean-cutout icon in the player's kit colors, their name, and a meter
 * bar. Rows animate up/down smoothly as the risk order changes (whoever's zone
 * the ball is in sinks toward the bottom). Plain DOM over the canvas.
 */

export interface Leaderboard {
  update(): void
}

/** a tiny bean silhouette icon in the kit colors, as a data URL (cached) */
const iconCache = new Map<string, string>()
function beanIcon(kitId: string, kitAway: boolean, fallback: string): string {
  const key = `${kitId}|${kitAway}|${fallback}`
  const hit = iconCache.get(key)
  if (hit) return hit
  const kit = kitColors(kitId, kitAway)
  const body = kit ? `#${kit.primary.toString(16).padStart(6, '0')}` : fallback
  const cv = document.createElement('canvas')
  cv.width = cv.height = 40
  const ctx = cv.getContext('2d')!
  // rounded-square bean body
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.roundRect(8, 6, 24, 28, 8)
  ctx.fill()
  // pattern hint: a secondary stripe/hoop
  if (kit && kit.pattern !== 'solid') {
    ctx.fillStyle = `#${kit.secondary.toString(16).padStart(6, '0')}`
    if (kit.pattern === 'stripes') {
      ctx.fillRect(15, 6, 4, 28)
      ctx.fillRect(23, 6, 4, 28)
    } else {
      ctx.fillRect(8, 15, 24, 5)
      ctx.fillRect(8, 24, 24, 5)
    }
  }
  // face plate + eyes
  ctx.fillStyle = '#fbf6e8'
  ctx.beginPath()
  ctx.roundRect(11, 11, 18, 12, 3)
  ctx.fill()
  ctx.fillStyle = '#1c1a18'
  ctx.fillRect(15, 14, 3, 6)
  ctx.fillRect(23, 14, 3, 6)
  const url = cv.toDataURL()
  iconCache.set(key, url)
  return url
}

interface RowEl {
  wrap: HTMLDivElement
  icon: HTMLImageElement
  name: HTMLSpanElement
  barFill: HTMLDivElement
  y: number // current animated Y (px)
}

export function createLeaderboard(client: MatchClient): Leaderboard {
  const root = document.createElement('div')
  root.className = 'game-overlay' // hidden while the main menu is up
  root.style.cssText = `position:fixed;inset:0;pointer-events:none;font-family:${FONT_HEAD};z-index:15;`
  document.body.appendChild(root)

  // --- center: next-elimination countdown ---------------------------------------
  // a paper chip with a wobbly ink frame, hand-lettered label + big Baloo number
  const timer = document.createElement('div')
  timer.style.cssText =
    `position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;color:${INK};` +
    'padding:6px 22px 8px;'
  paperPanel(timer, { w: 200, h: 92, weight: 2.6 })
  const timerLabel = document.createElement('div')
  timerLabel.style.cssText = `font-family:${FONT_HAND};font-size:16px;letter-spacing:0.5px;opacity:0.85;margin-top:2px;`
  timerLabel.textContent = 'next elimination'
  const timerNum = document.createElement('div')
  timerNum.style.cssText = `font-size:54px;font-weight:800;line-height:0.95;`
  timer.append(timerLabel, timerNum)
  root.appendChild(timer)

  // --- center: "get the ball out of your zone!" alarm prompt --------------------
  // a torn-paper danger banner: rose paper with a heavy ink frame, hand text
  const prompt = document.createElement('div')
  prompt.style.cssText =
    'position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);text-align:center;' +
    `font-family:${FONT_HEAD};font-size:30px;font-weight:800;color:${INK};` +
    'padding:10px 30px;display:none;white-space:nowrap;' +
    `background-image:${inkFrameUrl(440, 60, INK, 3.2)}, url("${paperTexture()}");` +
    'background-size:100% 100%, 128px 128px;background-repeat:no-repeat, repeat;' +
    'box-shadow:0 5px 0 rgba(74,68,60,0.22);'
  prompt.textContent = '⚠ get the ball out of your zone!'
  root.appendChild(prompt)

  // --- right: leaderboard (below the PIP selfie cam) ----------------------------
  const board = document.createElement('div')
  board.style.cssText =
    'position:absolute;top:290px;right:16px;width:210px;'
  root.appendChild(board)

  const ROW_H = 42
  const rowPool: RowEl[] = []
  function ensureRow(i: number): RowEl {
    let r = rowPool[i]
    if (r) return r
    const wrap = document.createElement('div')
    // FILLED paper card + generous inset padding so the icon/name/bar always sit
    // INSIDE the wobbly ink outline (they were bleeding past a hollow frame).
    wrap.style.cssText =
      'position:absolute;left:0;right:0;height:38px;display:flex;align-items:center;gap:8px;' +
      'padding:0 16px;box-sizing:border-box;transition:none;will-change:transform;'
    paperPanel(wrap, { w: 210, h: 38, weight: 2 })
    const icon = document.createElement('img')
    icon.style.cssText = 'width:26px;height:26px;flex-shrink:0;'
    const mid = document.createElement('div')
    mid.style.cssText = 'flex:1;min-width:0;'
    const name = document.createElement('span')
    name.style.cssText =
      `display:block;font-family:${FONT_HAND};font-size:15px;line-height:1;color:${INK};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`
    const bar = document.createElement('div')
    bar.style.cssText = `height:6px;background:rgba(74,68,60,0.16);border-radius:3px;margin-top:3px;overflow:hidden;`
    const barFill = document.createElement('div')
    barFill.style.cssText = `height:100%;width:0%;background:${brushFill(METER.danger)};transition:width 160ms;`
    bar.appendChild(barFill)
    mid.append(name, bar)
    wrap.append(icon, mid)
    board.appendChild(wrap)
    r = { wrap, icon, name, barFill, y: i * ROW_H }
    rowPool[i] = r
    return r
  }

  return {
    update(): void {
      const gmGolden = client.mode() === 2 // GameMode.GoldenBoot
      // center countdown — the label frames the mode's stakes
      timerLabel.textContent = gmGolden ? 'lowest scorer out in' : 'next elimination'
      const secs = client.elimCountdown()
      if (Number.isFinite(secs) && client.survivors() > 1) {
        timer.style.display = 'block'
        timerNum.textContent = Math.ceil(Math.max(0, secs)).toString()
        // pulse rose as it runs low
        timerNum.style.color = secs < 5 ? METER.hot : INK
      } else {
        timer.style.display = 'none'
      }

      // ball-in-my-zone prompt, blinking — only meaningful in the ball-time modes
      // (in GOLDEN BOOT the ball near your goal isn't inherently bad)
      if (!gmGolden && client.ballInMyZone()) {
        const blink = Math.sin(performance.now() / 90) > -0.3
        prompt.style.display = blink ? 'block' : 'none'
      } else {
        prompt.style.display = 'none'
      }

      const rows: LeaderRow[] = client.leaderboard()
      const goldenBoot = client.mode() === 2 // GameMode.GoldenBoot
      // hide unused pooled rows
      for (let i = rows.length; i < rowPool.length; i++) rowPool[i]!.wrap.style.display = 'none'

      for (let i = 0; i < rows.length; i++) {
        const data = rows[i]!
        const el = ensureRow(i)
        el.wrap.style.display = 'flex'
        el.icon.src = beanIcon(data.kitId, data.kitAway, data.color)
        el.name.textContent = data.isMe ? `${data.name} (you)` : data.name
        el.barFill.style.width = `${Math.round(data.frac * 100)}%`
        // GOLDEN BOOT: the bar is a SCORE (higher = better) → more green as it
        // fills. Ball-time modes: the bar is danger → hotter as it fills.
        const meterColor = goldenBoot
          ? data.frac > 0.5 ? METER.safe : data.frac > 0.15 ? METER.warn : METER.danger
          : data.ballHere ? METER.hot : data.frac > 0.5 ? METER.warn : METER.safe
        el.barFill.style.background = brushFill(meterColor)
        // emphasis via the INK FRAME weight/tint (not a hard border): my row +
        // the most-at-risk (last) row get a heavier/rose frame, ball-in-zone hot
        const atRisk = i === rows.length - 1 && rows.length > 1
        const frameColor = data.ballHere ? METER.hot : atRisk ? METER.danger : INK
        const frameWeight = data.isMe || atRisk || data.ballHere ? 3.2 : 2
        // FILLED with cream (PAPER) so the row is a solid card the content can't
        // bleed out of — the emphasis colour only tints the outline.
        el.wrap.style.backgroundImage = `${inkFrameUrl(210, 38, frameColor, frameWeight, PAPER)}, url("${paperTexture()}")`

        // smooth vertical slide toward the target slot
        const targetY = i * ROW_H
        el.y += (targetY - el.y) * 0.25
        if (Math.abs(targetY - el.y) < 0.5) el.y = targetY
        el.wrap.style.transform = `translateY(${el.y.toFixed(1)}px)`
      }
    },
  }
}
