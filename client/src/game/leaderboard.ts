import { kitColors } from '@shared/cosmetics/jerseys.ts'
import type { LeaderRow, MatchClient } from './online.ts'

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
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;font-family:system-ui,sans-serif;z-index:15;'
  document.body.appendChild(root)

  // --- center: next-elimination countdown ---------------------------------------
  const timer = document.createElement('div')
  timer.style.cssText =
    'position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;color:#4a443c;' +
    'text-shadow:0 2px 0 #fff8;'
  const timerLabel = document.createElement('div')
  timerLabel.style.cssText = 'font-size:13px;font-weight:700;letter-spacing:1px;opacity:0.8;'
  timerLabel.textContent = 'NEXT ELIMINATION'
  const timerNum = document.createElement('div')
  timerNum.style.cssText = 'font-size:52px;font-weight:800;line-height:1;'
  timer.append(timerLabel, timerNum)
  root.appendChild(timer)

  // --- center: "get the ball out of your zone!" alarm prompt --------------------
  const prompt = document.createElement('div')
  prompt.style.cssText =
    'position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);text-align:center;' +
    'font-size:30px;font-weight:800;color:#fff;background:#d0402fdd;padding:10px 26px;border-radius:12px;' +
    'box-shadow:0 4px 0 #7a2419;display:none;white-space:nowrap;'
  prompt.textContent = '⚠  GET THE BALL OUT OF YOUR ZONE!'
  root.appendChild(prompt)

  // --- right: leaderboard --------------------------------------------------------
  const board = document.createElement('div')
  board.style.cssText =
    'position:absolute;top:90px;right:16px;width:210px;'
  root.appendChild(board)

  const ROW_H = 42
  const rowPool: RowEl[] = []
  function ensureRow(i: number): RowEl {
    let r = rowPool[i]
    if (r) return r
    const wrap = document.createElement('div')
    wrap.style.cssText =
      'position:absolute;left:0;right:0;height:36px;display:flex;align-items:center;gap:8px;' +
      'background:#fffdf5e8;border-radius:10px;padding:0 8px;border:2px solid #4a443c22;' +
      'transition:none;will-change:transform;'
    const icon = document.createElement('img')
    icon.style.cssText = 'width:28px;height:28px;flex-shrink:0;'
    const mid = document.createElement('div')
    mid.style.cssText = 'flex:1;min-width:0;'
    const name = document.createElement('span')
    name.style.cssText =
      'display:block;font-size:13px;font-weight:700;color:#4a443c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    const bar = document.createElement('div')
    bar.style.cssText = 'height:5px;background:#4a443c22;border-radius:3px;margin-top:2px;overflow:hidden;'
    const barFill = document.createElement('div')
    barFill.style.cssText = 'height:100%;width:0%;background:#d96c6c;transition:width 160ms;'
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
      // center countdown
      const secs = client.elimCountdown()
      if (Number.isFinite(secs) && client.survivors() > 1) {
        timer.style.display = 'block'
        timerNum.textContent = Math.ceil(Math.max(0, secs)).toString()
        // pulse red as it runs low
        timerNum.style.color = secs < 5 ? '#d0402f' : '#4a443c'
      } else {
        timer.style.display = 'none'
      }

      // ball-in-my-zone prompt, blinking
      if (client.ballInMyZone()) {
        const blink = Math.sin(performance.now() / 90) > -0.3
        prompt.style.display = blink ? 'block' : 'none'
      } else {
        prompt.style.display = 'none'
      }

      const rows: LeaderRow[] = client.leaderboard()
      // hide unused pooled rows
      for (let i = rows.length; i < rowPool.length; i++) rowPool[i]!.wrap.style.display = 'none'

      for (let i = 0; i < rows.length; i++) {
        const data = rows[i]!
        const el = ensureRow(i)
        el.wrap.style.display = 'flex'
        el.icon.src = beanIcon(data.kitId, data.kitAway, data.color)
        el.name.textContent = data.isMe ? `${data.name} (you)` : data.name
        el.barFill.style.width = `${Math.round(data.frac * 100)}%`
        // bar color: safe green-ish low, red as it fills; ball-in-zone = bright
        el.barFill.style.background = data.ballHere ? '#e8402e' : data.frac > 0.5 ? '#e08a2b' : '#88b06a'
        // highlight my row + the most-at-risk (last) row
        const atRisk = i === rows.length - 1 && rows.length > 1
        el.wrap.style.border = data.isMe
          ? '2px solid #4a443c'
          : atRisk
            ? '2px solid #d96c6c'
            : '2px solid #4a443c22'
        el.wrap.style.background = data.ballHere ? '#ffe7e0f0' : '#fffdf5e8'

        // smooth vertical slide toward the target slot
        const targetY = i * ROW_H
        el.y += (targetY - el.y) * 0.25
        if (Math.abs(targetY - el.y) < 0.5) el.y = targetY
        el.wrap.style.transform = `translateY(${el.y.toFixed(1)}px)`
      }
    },
  }
}
