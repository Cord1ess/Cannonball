import { CARD_BY_ID, type CardPool } from '@shared/cards/definitions.ts'
import { KIT_BY_ID, KITS, kitColors, type KitColors } from '@shared/cosmetics/jerseys.ts'
import { Phase } from '@shared/match/phases.ts'
import type { MatchClient } from './online.ts'
import { FONT_HAND, FONT_HEAD, INK, inkFrameUrl, METER, paperButton, paperPanel, paperTexture } from './paperSkin.ts'

/**
 * The match-flow overlay (M3): lobby, draft grid, launch countdown/aim,
 * elimination + handout targeting, overtime banner, duel note,
 * winner + rematch, emote feed. Wears the paper-and-ink skin (§9): the main
 * panel + banners are paper cards with wobbly ink frames, hand + Baloo fonts.
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

const cssHex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

/** chip/swatch background showing the kit's actual pattern */
const kitSwatchCss = (kit: KitColors | null, fallback: string): string => {
  if (!kit) return `background:${fallback};`
  const p = cssHex(kit.primary)
  const s = cssHex(kit.secondary)
  if (kit.pattern === 'stripes') return `background:repeating-linear-gradient(90deg, ${p} 0 7px, ${s} 7px 11px);`
  if (kit.pattern === 'hoops') return `background:repeating-linear-gradient(180deg, ${p} 0 7px, ${s} 7px 11px);`
  return `background:${p};`
}

export function createMatchUi(client: MatchClient): MatchUi {
  const seatColor = (seat: number): string => client.seatColorHex(seat)
  // display name for a seat (falls back to "P{n}" if not found yet)
  const nameOf = (seat: number): string =>
    client.players().find((p) => p.seat === seat)?.name ?? `P${seat + 1}`
  const root = document.createElement('div')
  root.style.cssText =
    `position:fixed;inset:0;pointer-events:none;font-family:${FONT_HEAD};user-select:none;z-index:20;`
  document.body.appendChild(root)

  const panel = document.createElement('div')
  panel.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'padding:24px 30px;min-width:420px;max-width:640px;' +
    `color:${INK};text-align:center;pointer-events:auto;display:none;`
  paperPanel(panel, { w: 560, h: 380, weight: 3.4 })
  root.appendChild(panel)

  const banner = document.createElement('div')
  banner.style.cssText =
    'position:absolute;left:50%;top:20%;transform:translateX(-50%);font-size:34px;font-weight:800;' +
    `color:${INK};padding:8px 28px;opacity:0;transition:opacity 200ms;white-space:nowrap;` +
    `background-image:${inkFrameUrl(460, 58, INK, 3.2)}, url("${paperTexture()}");` +
    'background-size:100% 100%, 128px 128px;background-repeat:no-repeat, repeat;'
  root.appendChild(banner)
  let bannerUntil = 0

  const emoteFeed = document.createElement('div')
  emoteFeed.style.cssText =
    `position:absolute;left:14px;bottom:110px;display:flex;flex-direction:column;gap:4px;font-family:${FONT_HAND};font-size:20px;`
  root.appendChild(emoteFeed)

  const showBanner = (text: string, seconds = 2.5): void => {
    banner.textContent = text
    banner.style.opacity = '1'
    bannerUntil = performance.now() + seconds * 1000
  }

  client.onEvent((event) => {
    if (event.type === 'elim' && event.seat !== undefined) {
      showBanner(`${event.seat === client.mySeat() ? 'YOU ARE' : nameOf(event.seat)} ELIMINATED`)
    } else if (event.type === 'overtime') {
      showBanner('OVERTIME — first touch of ball-time loses!', 4)
    } else if (event.type === 'volley') {
      showBanner('KICKOFF!', 1.2)
    } else if (event.type === 'save' && event.seat !== undefined) {
      showBanner(`${nameOf(event.seat)} FREE SAVE!`, 1.5)
    } else if (event.type === 'emote' && event.seat !== undefined && event.id !== undefined) {
      const line = document.createElement('div')
      line.style.cssText =
        `padding:3px 12px;border-left:6px solid ${seatColor(event.seat)};color:${INK};` +
        `background-image:url("${paperTexture()}");background-size:128px 128px;border-radius:6px;`
      line.textContent = `${nameOf(event.seat)} ${EMOTES[event.id] ?? ''}`
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
    const rosterSig = client
      .players()
      .map((p) => `${p.name}${p.kitId}${p.kitAway ? 'a' : ''}${p.connected ? '' : 'x'}`)
      .join(',')
    const key = `${phase}:${handout?.revealed}:${handout?.elimSeat}:${client.players().length}:${client.draftOffers() !== null}:${advChoice}:${curseChoice}:${client.winnerSeat()}:${rosterSig}`
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
        list.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:14px;'
        for (const p of client.players()) {
          const chip = document.createElement('div')
          const kit = kitColors(p.kitId, p.kitAway)
          chip.style.cssText =
            `${kitSwatchCss(kit, seatColor(p.seat))}color:#fffdf5;text-shadow:0 1px 2px rgba(30,26,20,0.75);` +
            `border-radius:8px;padding:6px 12px;font-weight:700;${p.connected ? '' : 'opacity:0.4;'}`
          chip.textContent = `${p.bot ? '🤖 ' : ''}${p.name}${p.seat === client.mySeat() ? ' (you)' : ''}`
          list.appendChild(chip)
        }
        panel.appendChild(list)

        // name field: your display name, shown on your chip + over your head
        const nameRow = document.createElement('div')
        nameRow.style.cssText = 'display:flex;gap:8px;justify-content:center;align-items:center;margin-bottom:12px;'
        const nameLabel = document.createElement('span')
        nameLabel.textContent = 'name:'
        nameLabel.style.cssText = 'font-weight:700;color:#6b655c;'
        const nameInput = document.createElement('input')
        nameInput.maxLength = 16
        nameInput.placeholder = 'your name'
        nameInput.value = client.myName()
        nameInput.style.cssText =
          `font-family:${FONT_HAND};font-size:17px;padding:5px 12px;border-radius:8px;border:2px solid ${INK};min-width:160px;` +
          `background:url("${paperTexture()}");background-size:128px 128px;color:${INK};`
        const commitName = (): void => {
          const v = nameInput.value.trim()
          if (v) client.setName(v)
        }
        nameInput.addEventListener('change', commitName)
        nameInput.addEventListener('blur', commitName)
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            commitName()
            nameInput.blur()
          }
        })
        nameRow.append(nameLabel, nameInput)
        panel.appendChild(nameRow)

        // jersey picker: cycle the fallback kit set (real teams = later content pass)
        const kitRow = document.createElement('div')
        kitRow.style.cssText =
          'display:flex;gap:8px;justify-content:center;align-items:center;margin-bottom:14px;font-weight:800;'
        const myKitId = client.myKitId()
        const myKit = kitColors(myKitId, client.myKitAway())
        const kitIndex = KITS.findIndex((k) => k.id === myKitId)
        const arrow = (label: string, dir: number): HTMLButtonElement => {
          const btn = document.createElement('button')
          btn.textContent = label
          btn.style.cssText = 'font-size:16px;padding:4px 12px;'
          paperButton(btn, { tint: INK, w: 40, h: 30 })
          btn.addEventListener('click', () => {
            const next = KITS[(Math.max(kitIndex, 0) + dir + KITS.length) % KITS.length]!
            client.setKit(next.id)
          })
          return btn
        }
        const swatch = document.createElement('div')
        swatch.style.cssText = `${kitSwatchCss(myKit, seatColor(client.mySeat()))}width:26px;height:20px;border:2px solid #4a443c;border-radius:5px;`
        const kitName = document.createElement('span')
        kitName.style.cssText = `min-width:170px;font-size:16px;font-family:${FONT_HAND};`
        kitName.textContent = `${KIT_BY_ID.get(myKitId)?.name ?? 'your team'}${client.myKitAway() ? ' · away kit' : ''}`
        kitRow.appendChild(arrow('‹', -1))
        kitRow.appendChild(swatch)
        kitRow.appendChild(kitName)
        kitRow.appendChild(arrow('›', 1))
        panel.appendChild(kitRow)
        if (client.isHost()) {
          const botRow = document.createElement('div')
          botRow.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-bottom:12px;'
          const addBot = document.createElement('button')
          addBot.textContent = '+ BOT'
          addBot.style.cssText = 'font-size:13px;padding:6px 14px;'
          paperButton(addBot, { tint: '#4fa3d8', w: 84, h: 32 })
          addBot.addEventListener('click', () => client.addBot())
          const fillBots = document.createElement('button')
          fillBots.textContent = 'FILL WITH BOTS'
          fillBots.style.cssText = 'font-size:13px;padding:6px 14px;'
          paperButton(fillBots, { tint: '#9678c8', w: 140, h: 32 })
          fillBots.addEventListener('click', () => client.fillBots())
          botRow.appendChild(addBot)
          botRow.appendChild(fillBots)
          panel.appendChild(botRow)

          const startButton = document.createElement('button')
          startButton.textContent = 'START MATCH'
          startButton.style.cssText = 'font-size:18px;padding:10px 26px;'
          paperButton(startButton, { tint: '#58ae7c', w: 200, h: 46, big: true })
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
            label.style.cssText = `font-weight:800;font-size:14px;color:${INK};opacity:0.7;letter-spacing:0.5px;`
            label.textContent = POOL_LABELS[pool]
            col.appendChild(label)
            offers[pool].forEach((id, index) => {
              const def = CARD_BY_ID.get(id)
              const picked = client.picks()[pool] === id
              const btn = document.createElement('button')
              btn.style.cssText = 'text-align:left;padding:8px 11px;'
              // a paper card; picked = heavier green ink frame
              paperButton(btn, { w: 180, h: 66 })
              if (picked) {
                btn.style.backgroundImage = `${inkFrameUrl(180, 66, METER.safe, 3.4)}, url("${paperTexture()}")`
              }
              const rarity = def && 'rarity' in def ? def.rarity : 'common'
              const rarityColor = rarity === 'epic' ? '#9678c8' : rarity === 'rare' ? '#4fa3d8' : '#8a7f70'
              btn.innerHTML = `<div style="font-family:${FONT_HEAD};font-weight:800;font-size:15px;">${def?.name ?? id}</div>
                <div style="font-size:10px;color:${rarityColor};font-weight:800;letter-spacing:0.5px;">${rarity.toUpperCase()}</div>
                <div style="font-family:${FONT_HAND};font-size:13px;color:#6b655c;line-height:1.05;">${def && 'blurb' in def ? def.blurb : ''}</div>`
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
      // no numbers — the trajectory arc + cannon show aim/power; just the prompt
      showBanner('KICKOFF! — A/D aim · hold SPACE to charge', 0.4)
      return
    }

    if (phase === Phase.Restart) {
      panel.style.display = 'block'
      if (renderedKey !== key) {
        renderedKey = key
        panel.replaceChildren()
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
                btn.style.cssText = 'padding:6px 14px;font-size:15px;'
                paperButton(btn, { tint: seatColor(p.seat), w: 96, h: 34, big: chosen })
                btn.textContent = nameOf(p.seat)
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
            confirm.style.cssText = 'font-size:16px;padding:8px 20px;'
            paperButton(confirm, { tint: ready ? INK : '#9b948a', w: 170, h: 40, big: true })
            if (!ready) confirm.style.cursor = 'default'
            confirm.addEventListener('click', () => {
              if (advChoice >= 0 && curseChoice >= 0) client.assign(advChoice, curseChoice)
            })
            panel.appendChild(confirm)
          } else if (!handout.revealed) {
            const wait = document.createElement('div')
            wait.style.cssText = 'font-size:18px;font-weight:700;'
            wait.textContent = `${nameOf(handout.elimSeat)} is choosing who gets the advantage… and the curse`
            panel.appendChild(wait)
          } else {
            const reveal = document.createElement('div')
            reveal.innerHTML = `<div style="font-size:20px;font-weight:800;margin-bottom:8px;">THE HANDOUT</div>
              <div style="color:#58ae7c;font-weight:800;">${cardName(handout.advCardId)} → ${nameOf(handout.advTo)}</div>
              <div style="color:#d96c6c;font-weight:800;">${cardName(handout.curseCardId)} → ${nameOf(handout.curseTo)}</div>`
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
        h.innerHTML = `<div style="font-size:30px;font-weight:800;color:${seatColor(winner)};">${nameOf(winner)} WINS!</div>
          <div style="margin:6px 0 16px;">${winner === client.mySeat() ? 'last bean standing 🏆' : 'better luck next kickoff'}</div>`
        panel.appendChild(h)
        if (client.isHost()) {
          const again = document.createElement('button')
          again.textContent = 'REMATCH'
          again.style.cssText = 'font-size:18px;padding:10px 26px;'
          paperButton(again, { tint: '#58ae7c', w: 180, h: 46, big: true })
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
