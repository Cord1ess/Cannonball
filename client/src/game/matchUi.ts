import { CARD_BY_ID, type CardPool } from '@shared/cards/definitions.ts'
import { Phase } from '@shared/match/phases.ts'
import { SEAT_COLORS } from './sandbox.ts'
import type { MatchClient } from './online.ts'

/**
 * The match-flow overlay (M3): lobby, draft grid, launch countdown/aim,
 * elimination + handout targeting, halftime/overtime banners, duel note,
 * winner + rematch, emote feed. Plain DOM — the paper-and-ink skin is M5.
 */

const EMOTES = ['👏', '❤️', '😂', '😱']
const POOLS: readonly CardPool[] = ['ability', 'equipment', 'advantage']
const POOL_LABELS: Record<CardPool, string> = {
  ability: 'ABILITY',
  equipment: 'EQUIPMENT',
  advantage: 'ADVANTAGE',
}

export interface MatchUi {
  update(): void
}

const seatColor = (seat: number): string => `#${(SEAT_COLORS[seat] ?? 0x888888).toString(16).padStart(6, '0')}`

export function createMatchUi(client: MatchClient): MatchUi {
  const root = document.createElement('div')
  root.style.cssText =
    'position:fixed;inset:0;pointer-events:none;font-family:system-ui,sans-serif;user-select:none;z-index:20;'
  document.body.appendChild(root)

  const panel = document.createElement('div')
  panel.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#fffdf5f0;' +
    'border:3px solid #4a443c;border-radius:14px;padding:22px 28px;min-width:420px;max-width:640px;' +
    'color:#4a443c;text-align:center;pointer-events:auto;display:none;'
  root.appendChild(panel)

  const banner = document.createElement('div')
  banner.style.cssText =
    'position:absolute;left:50%;top:20%;transform:translateX(-50%);font-size:34px;font-weight:800;' +
    'color:#fffdf5;text-shadow:0 2px 0 #4a443c;opacity:0;transition:opacity 200ms;white-space:nowrap;'
  root.appendChild(banner)
  let bannerUntil = 0

  const emoteFeed = document.createElement('div')
  emoteFeed.style.cssText =
    'position:absolute;left:14px;bottom:110px;display:flex;flex-direction:column;gap:4px;font-size:20px;'
  root.appendChild(emoteFeed)

  const showBanner = (text: string, seconds = 2.5): void => {
    banner.textContent = text
    banner.style.opacity = '1'
    bannerUntil = performance.now() + seconds * 1000
  }

  client.onEvent((event) => {
    if (event.type === 'elim' && event.seat !== undefined) {
      showBanner(`${event.seat === client.mySeat() ? 'YOU ARE' : `PLAYER ${event.seat + 1}`} ELIMINATED`)
    } else if (event.type === 'overtime') {
      showBanner('OVERTIME — first touch of ball-time loses!', 4)
    } else if (event.type === 'volley') {
      showBanner('KICKOFF!', 1.2)
    } else if (event.type === 'emote' && event.seat !== undefined && event.id !== undefined) {
      const line = document.createElement('div')
      line.style.cssText = `background:#fffdf5cc;border-radius:8px;padding:2px 10px;border-left:6px solid ${seatColor(event.seat)};`
      line.textContent = `P${event.seat + 1} ${EMOTES[event.id] ?? ''}`
      emoteFeed.appendChild(line)
      setTimeout(() => line.remove(), 3000)
    }
  })

  // targeting selections (Restart phase, eliminated player only)
  let advChoice = -1
  let curseChoice = -1
  let renderedKey = ''

  const cardName = (id: string): string => CARD_BY_ID.get(id)?.name ?? id

  function render(): void {
    const phase = client.phase()
    const remaining = Math.max(0, client.phaseRemaining())
    const handout = client.handout()

    // key: only rebuild DOM when the situation changes (timers redraw cheap parts)
    const key = `${phase}:${handout?.revealed}:${handout?.elimSeat}:${client.players().length}:${client.draftOffers() !== null}:${advChoice}:${curseChoice}:${client.winnerSeat()}`
    const timerText = remaining > 0.05 ? ` — ${Math.ceil(remaining)}s` : ''

    if (phase === Phase.Lobby) {
      panel.style.display = 'block'
      if (renderedKey !== key) {
        renderedKey = key
        panel.replaceChildren()
        const h = document.createElement('div')
        h.innerHTML = `<div style="font-size:30px;font-weight:800;">CANNONBALL</div>
          <div style="margin:4px 0 14px;">room code: <b style="font-size:20px;letter-spacing:1px;">${client.roomId}</b></div>`
        panel.appendChild(h)
        const list = document.createElement('div')
        list.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px;'
        for (const p of client.players()) {
          const chip = document.createElement('div')
          chip.style.cssText = `background:${seatColor(p.seat)};color:#fffdf5;border-radius:8px;padding:6px 12px;font-weight:700;${p.connected ? '' : 'opacity:0.4;'}`
          chip.textContent = `P${p.seat + 1}${p.sessionId === '' ? '' : ''}${p.seat === client.mySeat() ? ' (you)' : ''}`
          list.appendChild(chip)
        }
        panel.appendChild(list)
        if (client.isHost()) {
          const startButton = document.createElement('button')
          startButton.textContent = 'START MATCH'
          startButton.style.cssText =
            'font-size:18px;font-weight:800;background:#58ae7c;color:#fff;border:0;border-radius:10px;padding:10px 26px;cursor:pointer;'
          startButton.addEventListener('click', () => client.start())
          panel.appendChild(startButton)
        } else {
          const wait = document.createElement('div')
          wait.textContent = 'waiting for the host to start…'
          panel.appendChild(wait)
        }
        const share = document.createElement('div')
        share.style.cssText = 'margin-top:10px;font-size:12px;color:#9b948a;'
        share.textContent = 'friends join automatically from the same server'
        panel.appendChild(share)
      }
      return
    }

    if (phase === Phase.Draft) {
      panel.style.display = 'block'
      const offers = client.draftOffers()
      if (renderedKey !== key) {
        renderedKey = key
        panel.replaceChildren()
        const h = document.createElement('div')
        h.id = 'draft-title'
        h.style.cssText = 'font-size:22px;font-weight:800;margin-bottom:12px;'
        panel.appendChild(h)
        if (offers) {
          const grid = document.createElement('div')
          grid.style.cssText = 'display:flex;gap:14px;justify-content:center;'
          for (const pool of POOLS) {
            const col = document.createElement('div')
            col.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:180px;'
            const label = document.createElement('div')
            label.style.cssText = 'font-weight:800;font-size:13px;color:#9b948a;'
            label.textContent = POOL_LABELS[pool]
            col.appendChild(label)
            offers[pool].forEach((id, index) => {
              const def = CARD_BY_ID.get(id)
              const picked = client.picks()[pool] === id
              const btn = document.createElement('button')
              btn.style.cssText =
                `text-align:left;border-radius:10px;padding:8px 10px;cursor:pointer;border:3px solid ${picked ? '#58ae7c' : '#4a443c33'};background:#fff;`
              const rarity = def && 'rarity' in def ? def.rarity : 'common'
              const rarityColor = rarity === 'epic' ? '#9678c8' : rarity === 'rare' ? '#4fa3d8' : '#9b948a'
              btn.innerHTML = `<div style="font-weight:800;">${def?.name ?? id}</div>
                <div style="font-size:10px;color:${rarityColor};font-weight:700;">${rarity.toUpperCase()}</div>
                <div style="font-size:11px;color:#6b655c;">${def && 'blurb' in def ? def.blurb : ''}</div>`
              btn.addEventListener('click', () => {
                client.pick(pool, index)
                renderedKey = '' // repaint selection
              })
              col.appendChild(btn)
            })
            grid.appendChild(col)
          }
          panel.appendChild(grid)
        }
      }
      const title = panel.querySelector('#draft-title')
      if (title) title.textContent = `DRAFT YOUR LOADOUT${timerText}`
      return
    }

    if (phase === Phase.Launch) {
      panel.style.display = 'none'
      const deg = Math.round((client.aimAngle() * 180) / Math.PI)
      showBanner(`LAUNCH IN ${Math.ceil(remaining)} — A/D to aim ${deg >= 0 ? '+' : ''}${deg}°`, 0.4)
      return
    }

    if (phase === Phase.Restart) {
      panel.style.display = 'block'
      if (renderedKey !== key) {
        renderedKey = key
        panel.replaceChildren()
        const halftime = client.halftime()
        if (halftime) {
          const h = document.createElement('div')
          h.style.cssText = 'font-size:26px;font-weight:800;color:#e98a2b;margin-bottom:8px;'
          h.textContent = 'HALFTIME — wedges reshuffled!'
          panel.appendChild(h)
        }
        if (handout && handout.elimSeat >= 0) {
          const isMe = handout.elimSeat === client.mySeat()
          if (!handout.revealed && isMe) {
            const h = document.createElement('div')
            h.innerHTML = `<div style="font-size:20px;font-weight:800;margin-bottom:10px;">YOUR PARTING GIFTS</div>`
            panel.appendChild(h)
            const alive = client.players().filter((p) => p.alive)
            const rows: Array<['advantage' | 'curse', string]> = [
              ['advantage', handout.advCardId],
              ['curse', handout.curseCardId],
            ]
            for (const [kind, cardId] of rows) {
              const row = document.createElement('div')
              row.style.cssText = 'margin-bottom:10px;'
              const label = document.createElement('div')
              label.style.cssText = `font-weight:800;color:${kind === 'advantage' ? '#58ae7c' : '#d96c6c'};`
              label.textContent = `${kind.toUpperCase()}: ${cardName(cardId)} → give to…`
              row.appendChild(label)
              const btnRow = document.createElement('div')
              btnRow.style.cssText = 'display:flex;gap:6px;justify-content:center;margin-top:4px;'
              for (const p of alive) {
                const chosen = (kind === 'advantage' ? advChoice : curseChoice) === p.seat
                const btn = document.createElement('button')
                btn.style.cssText = `background:${seatColor(p.seat)};color:#fff;border:3px solid ${chosen ? '#4a443c' : 'transparent'};border-radius:8px;padding:6px 12px;font-weight:800;cursor:pointer;`
                btn.textContent = `P${p.seat + 1}`
                btn.addEventListener('click', () => {
                  if (kind === 'advantage') advChoice = p.seat
                  else curseChoice = p.seat
                  renderedKey = ''
                })
                btnRow.appendChild(btn)
              }
              row.appendChild(btnRow)
              panel.appendChild(row)
            }
            const confirm = document.createElement('button')
            const ready = advChoice >= 0 && curseChoice >= 0
            confirm.textContent = 'HAND THEM OUT'
            confirm.disabled = !ready
            confirm.style.cssText = `font-size:16px;font-weight:800;background:${ready ? '#4a443c' : '#9b948a'};color:#fff;border:0;border-radius:10px;padding:8px 20px;cursor:pointer;`
            confirm.addEventListener('click', () => {
              if (advChoice >= 0 && curseChoice >= 0) client.assign(advChoice, curseChoice)
            })
            panel.appendChild(confirm)
          } else if (!handout.revealed) {
            const wait = document.createElement('div')
            wait.style.cssText = 'font-size:18px;font-weight:700;'
            wait.textContent = `P${handout.elimSeat + 1} is choosing who gets the advantage… and the curse`
            panel.appendChild(wait)
          } else {
            const reveal = document.createElement('div')
            reveal.innerHTML = `<div style="font-size:20px;font-weight:800;margin-bottom:8px;">THE HANDOUT</div>
              <div style="color:#58ae7c;font-weight:800;">${cardName(handout.advCardId)} → P${handout.advTo + 1}</div>
              <div style="color:#d96c6c;font-weight:800;">${cardName(handout.curseCardId)} → P${handout.curseTo + 1}</div>`
            panel.appendChild(reveal)
          }
        }
      }
      return
    }

    if (phase === Phase.End) {
      panel.style.display = 'block'
      if (renderedKey !== key) {
        renderedKey = key
        panel.replaceChildren()
        const winner = client.winnerSeat()
        const h = document.createElement('div')
        h.innerHTML = `<div style="font-size:30px;font-weight:800;color:${seatColor(winner)};">P${winner + 1} WINS!</div>
          <div style="margin:6px 0 16px;">${winner === client.mySeat() ? 'last bean standing 🏆' : 'better luck next kickoff'}</div>`
        panel.appendChild(h)
        if (client.isHost()) {
          const again = document.createElement('button')
          again.textContent = 'REMATCH'
          again.style.cssText =
            'font-size:18px;font-weight:800;background:#58ae7c;color:#fff;border:0;border-radius:10px;padding:10px 26px;cursor:pointer;'
          again.addEventListener('click', () => client.rematch())
          panel.appendChild(again)
        } else {
          const wait = document.createElement('div')
          wait.textContent = 'waiting for the host…'
          panel.appendChild(wait)
        }
      }
      return
    }

    // play phases: no panel, reset targeting choices for next time
    panel.style.display = 'none'
    if (phase === Phase.Arena || phase === Phase.Duel) {
      advChoice = -1
      curseChoice = -1
    }
    if (phase === Phase.Duel && renderedKey !== key) {
      renderedKey = key
      showBanner('SUDDEN KICKOFF — first full meter loses!', 3)
    }
  }

  return {
    update(): void {
      render()
      if (banner.style.opacity === '1' && performance.now() > bannerUntil) {
        banner.style.opacity = '0'
      }
    },
  }
}
