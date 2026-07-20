import { KITS, KIT_BY_ID, kitColors } from '@shared/cosmetics/jerseys.ts'
import { GAME_MODES, MATCH_TIME_OPTIONS, DEFAULT_MATCH_TIME_S, gameModeInfo } from '@shared/match/modes.ts'
import type { MatchClient, MatchPlayerInfo } from './online.ts'
import { FONT_HAND, FONT_HEAD, INK, paperButton, paperPanel, paperTexture } from './paperSkin.ts'
import { NEUTRAL_UI_KIT, type UiBeanSlot, type UiBeanStage } from '../render/uiBean.ts'

/**
 * MAIN MENU + LOBBY (rapid remake). Over a cinematic low-orbit view of a live
 * bot match, this overlay shows: the TITLE + one-line tagline (left), and
 * PLAY SOLO / PLAY ONLINE (right). Choosing one slides in a settings/lobby
 * panel — solo goes straight to match settings, online shows the joined roster
 * (real lively 3D beans) + settings. Everything wears the paper-and-ink skin.
 *
 * The menu drives the SAME MatchClient the game uses; "start" just launches the
 * match (with bots filled for solo). Once the match leaves the lobby phase the
 * menu hides itself and the real HUD takes over.
 */

const TAGLINE = 'Six beans, one giant ball — survive the kickoff or get bounced.'

export interface MainMenu {
  /** true while the menu is showing (lobby/pre-match) — hides HUD, orbits cam */
  readonly visible: boolean
  /** the caller (main.ts) decides when the menu is up vs. the live match HUD */
  setShown(on: boolean): void
  update(dt: number): void
  dispose(): void
}

export interface MainMenuHooks {
  /** SOLO kick-off: reset the room to a clean lobby then start with N bots.
   *  main.ts owns the reset→configure→start sequence so it's not racy. */
  startSolo(botCount: number, mode: number, matchTime: number): void
  /** ONLINE start: just start the current lobby (host only). */
  startOnline(): void
}

export function createMainMenu(client: MatchClient, beans: UiBeanStage, hooks: MainMenuHooks): MainMenu {
  let view: 'home' | 'solo' | 'online' = 'home'
  let visible = true
  let botCount = 5 // solo default
  let modeSel = 0 // GameMode id (HotZone)
  let timeSel = DEFAULT_MATCH_TIME_S

  const root = document.createElement('div')
  root.style.cssText =
    `position:fixed;inset:0;z-index:30;font-family:${FONT_HEAD};color:${INK};` +
    'display:flex;align-items:stretch;justify-content:space-between;pointer-events:none;'
  document.body.appendChild(root)

  // --- LEFT: title + tagline ----------------------------------------------------
  const left = document.createElement('div')
  left.style.cssText = 'align-self:center;margin:0 0 0 6vw;max-width:34vw;pointer-events:none;'
  const title = document.createElement('div')
  // Bungee boxy signage caps, white, with a SOLID stepped ink drop shadow (the
  // Abeto title look). Bungee is a single weight + already boxy, so no bold /
  // negative tracking — the shadow gives the punch. Two-line for a poster feel.
  title.style.cssText =
    `font-family:${FONT_HEAD};font-size:clamp(38px,4.6vw,68px);line-height:0.98;` +
    `color:#fdfaf0;` +
    // layered hard offsets = a chunky solid shadow, not a soft blur
    `text-shadow:2px 2px 0 ${INK}, 4px 4px 0 ${INK}, 6px 6px 0 ${INK}, 5px 5px 0 ${INK};`
  title.innerHTML = 'CANNON<br>BALL'
  const tag = document.createElement('div')
  // Caveat is a thin script → it reads small for its size, so bump it up
  tag.style.cssText =
    `font-family:${FONT_HAND};font-weight:500;font-size:clamp(22px,2.4vw,34px);margin-top:16px;` +
    `color:#fdfaf0;text-shadow:2px 2px 0 ${INK};line-height:1.05;`
  tag.textContent = TAGLINE
  left.append(title, tag)
  root.appendChild(left)

  // --- RIGHT: action column (home buttons OR a sliding panel) --------------------
  const right = document.createElement('div')
  right.style.cssText =
    'align-self:center;margin:0 5vw 0 0;width:min(420px,40vw);pointer-events:auto;' +
    'display:flex;flex-direction:column;gap:16px;'
  root.appendChild(right)

  const bigBtn = (label: string, tint: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'font-size:26px;padding:18px 10px;width:100%;'
    paperButton(b, { tint, w: 380, h: 66, big: true })
    return b
  }
  const soloBtn = bigBtn('PLAY SOLO', '#58ae7c')
  const onlineBtn = bigBtn('PLAY ONLINE', '#4fa3d8')

  // the panel container that solo/online slide into
  const panel = document.createElement('div')
  panel.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:20px 22px;'
  paperPanel(panel, { w: 400, h: 420, weight: 3.2 })

  function showHome(): void {
    view = 'home'
    right.replaceChildren(soloBtn, onlineBtn)
  }

  // --- shared match-settings block (bot count + your jersey) ---------------------
  let jerseyBean: UiBeanSlot | null = null
  function buildSettings(online: boolean): HTMLElement {
    panel.replaceChildren()
    const h = document.createElement('div')
    h.style.cssText = 'font-size:24px;font-weight:800;text-align:center;margin-bottom:2px;'
    h.textContent = online ? 'ONLINE LOBBY' : 'SOLO MATCH'
    panel.appendChild(h)

    // --- your jersey: a LIVELY 3D bean + kit cycler --------------------------
    const kitRow = document.createElement('div')
    kitRow.style.cssText = 'display:flex;align-items:center;gap:12px;justify-content:center;margin:4px 0;'
    const beanCard = document.createElement('div')
    beanCard.style.cssText = 'width:96px;height:120px;flex-shrink:0;'
    const arrowL = document.createElement('button')
    arrowL.textContent = '‹'
    arrowL.style.cssText = 'font-size:22px;padding:6px 12px;'
    paperButton(arrowL, { tint: INK, w: 42, h: 40 })
    const kitName = document.createElement('div')
    kitName.style.cssText = `font-family:${FONT_HAND};font-size:18px;min-width:130px;text-align:center;`
    const arrowR = document.createElement('button')
    arrowR.textContent = '›'
    arrowR.style.cssText = 'font-size:22px;padding:6px 12px;'
    paperButton(arrowR, { tint: INK, w: 42, h: 40 })
    kitRow.append(arrowL, beanCard, kitName, arrowR)
    panel.appendChild(kitRow)

    // bind the lively bean to the jersey card
    jerseyBean?.dispose()
    const startKit = kitColors(client.myKitId(), client.myKitAway()) ?? NEUTRAL_UI_KIT
    jerseyBean = beans.slot(beanCard, startKit)
    const refreshKit = (): void => {
      const id = client.myKitId()
      kitName.textContent = `${KIT_BY_ID.get(id)?.name ?? 'your team'}${client.myKitAway() ? ' · away' : ''}`
      jerseyBean?.setKit(kitColors(id, client.myKitAway()) ?? NEUTRAL_UI_KIT)
      jerseyBean?.pop()
    }
    const cycleKit = (dir: number): void => {
      const idx = KITS.findIndex((k) => k.id === client.myKitId())
      const next = KITS[(Math.max(idx, 0) + dir + KITS.length) % KITS.length]!
      client.setKit(next.id)
      // give the server a beat, then reflect
      setTimeout(refreshKit, 60)
    }
    arrowL.addEventListener('click', () => cycleKit(-1))
    arrowR.addEventListener('click', () => cycleKit(1))
    refreshKit()

    // name field
    const nameInput = document.createElement('input')
    nameInput.maxLength = 16
    nameInput.placeholder = 'your name'
    nameInput.value = client.myName()
    nameInput.style.cssText =
      `font-family:${FONT_HAND};font-size:17px;padding:6px 12px;border-radius:8px;border:2px solid ${INK};` +
      `background:url("${paperTexture()}");background-size:128px 128px;color:${INK};text-align:center;`
    const commit = (): void => {
      const v = nameInput.value.trim()
      if (v) client.setName(v)
    }
    nameInput.addEventListener('change', commit)
    nameInput.addEventListener('blur', commit)
    panel.appendChild(nameInput)

    panel.appendChild(buildModeTimePicker(online))

    if (online) panel.appendChild(buildRoster())
    else panel.appendChild(buildBotSlider())

    // action buttons
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:10px;margin-top:6px;'
    const back = document.createElement('button')
    back.textContent = 'BACK'
    back.style.cssText = 'flex:1;font-size:16px;padding:10px;'
    paperButton(back, { tint: '#9b948a', w: 120, h: 42 })
    back.addEventListener('click', () => {
      jerseyBean?.dispose()
      jerseyBean = null
      showHome()
    })
    const go = document.createElement('button')
    go.textContent = online ? 'START MATCH' : 'KICK OFF!'
    go.style.cssText = 'flex:2;font-size:18px;padding:10px;'
    paperButton(go, { tint: '#58ae7c', w: 200, h: 42, big: true })
    go.addEventListener('click', () => {
      if (!online) hooks.startSolo(botCount, modeSel, timeSel)
      else hooks.startOnline()
    })
    // online non-hosts can't start
    if (online && !client.isHost()) {
      go.textContent = 'WAITING FOR HOST…'
      go.disabled = true
    }
    actions.append(back, go)
    panel.appendChild(actions)

    return panel
  }

  // MATCH SETTINGS: game-mode picker (3 selectable cards) + total-time presets.
  // Online host changes propagate to everyone via setSettings; solo keeps it
  // local (sent on kick-off). Non-host online players see it read-only.
  function buildModeTimePicker(online: boolean): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;'
    const canEdit = !online || client.isHost()
    // seed from the room state when online (so non-hosts see the host's choice)
    if (online) {
      modeSel = client.mode()
      timeSel = client.matchTime()
    }

    // MODE cards
    const modeLbl = document.createElement('div')
    modeLbl.style.cssText = `font-family:${FONT_HAND};font-size:15px;text-align:center;opacity:0.8;`
    modeLbl.textContent = 'game mode'
    wrap.appendChild(modeLbl)
    const modeRow = document.createElement('div')
    modeRow.style.cssText = 'display:flex;gap:6px;'
    const ruleLine = document.createElement('div')
    ruleLine.style.cssText = `font-family:${FONT_HAND};font-size:13px;text-align:center;min-height:30px;line-height:1.05;color:#6b655c;`
    const renderModes = (): void => {
      if (online) modeSel = client.mode()
      modeRow.replaceChildren()
      for (const m of GAME_MODES) {
        const b = document.createElement('button')
        const on = m.id === modeSel
        b.textContent = m.name
        b.style.cssText = 'flex:1;font-size:11px;padding:8px 2px;line-height:1.05;'
        paperButton(b, { tint: on ? '#4fa3d8' : undefined, w: 120, h: 44, big: on })
        if (canEdit) {
          b.addEventListener('click', () => {
            modeSel = m.id
            if (online) client.setSettings(modeSel, timeSel)
            renderModes()
          })
        } else {
          b.style.cursor = 'default'
        }
        modeRow.appendChild(b)
      }
      ruleLine.textContent = gameModeInfo(modeSel).rule
    }
    renderModes()
    wrap.append(modeRow, ruleLine)

    // TIME presets
    const timeLbl = document.createElement('div')
    timeLbl.style.cssText = `font-family:${FONT_HAND};font-size:15px;text-align:center;opacity:0.8;`
    timeLbl.textContent = 'match length'
    wrap.appendChild(timeLbl)
    const timeRow = document.createElement('div')
    timeRow.style.cssText = 'display:flex;gap:6px;'
    const renderTimes = (): void => {
      if (online) timeSel = client.matchTime()
      timeRow.replaceChildren()
      for (const t of MATCH_TIME_OPTIONS) {
        const b = document.createElement('button')
        const on = t.totalSeconds === timeSel
        b.textContent = t.label
        b.style.cssText = 'flex:1;font-size:11px;padding:8px 2px;'
        paperButton(b, { tint: on ? '#e98a2b' : undefined, w: 120, h: 36, big: on })
        if (canEdit) {
          b.addEventListener('click', () => {
            timeSel = t.totalSeconds
            if (online) client.setSettings(modeSel, timeSel)
            renderTimes()
          })
        } else {
          b.style.cursor = 'default'
        }
        timeRow.appendChild(b)
      }
    }
    renderTimes()
    wrap.appendChild(timeRow)

    // online non-hosts: keep in sync with the host's picks as state updates
    if (online && !canEdit) {
      ;(wrap as unknown as { __syncSettings: () => void }).__syncSettings = () => {
        renderModes()
        renderTimes()
      }
    }
    return wrap
  }

  // solo: a bot-count picker (visual dots, no raw number field)
  function buildBotSlider(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'text-align:center;'
    const lbl = document.createElement('div')
    lbl.style.cssText = `font-family:${FONT_HAND};font-size:17px;margin-bottom:4px;`
    const dots = document.createElement('div')
    dots.style.cssText = 'display:flex;gap:8px;justify-content:center;'
    const render = (): void => {
      lbl.textContent = `opponents: ${botCount} bot${botCount === 1 ? '' : 's'}`
      dots.replaceChildren()
      for (let i = 1; i <= 5; i++) {
        const d = document.createElement('button')
        d.style.cssText =
          `width:34px;height:34px;border-radius:8px;cursor:pointer;border:2px solid ${INK};` +
          (i <= botCount ? `background:#e98a2b;` : `background:url("${paperTexture()}");background-size:128px;`)
        d.addEventListener('click', () => {
          botCount = i
          render()
        })
        dots.appendChild(d)
      }
    }
    render()
    wrap.append(lbl, dots)
    return wrap
  }

  // online: the joined roster — each player/bot a lively 3D bean card
  const rosterEl = document.createElement('div')
  const rosterBeans = new Map<number, UiBeanSlot>()
  let rosterSig = ''
  function buildRoster(): HTMLElement {
    rosterEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;min-height:110px;'
    const code = document.createElement('div')
    code.style.cssText = `font-family:${FONT_HAND};font-size:16px;text-align:center;width:100%;`
    code.textContent = `room ${client.roomId} · friends join automatically`
    const host = document.createElement('div')
    host.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:100%;'
    if (client.isHost()) {
      const r = document.createElement('div')
      r.style.cssText = 'display:flex;gap:8px;justify-content:center;'
      const addBot = document.createElement('button')
      addBot.textContent = '+ BOT'
      addBot.style.cssText = 'font-size:13px;padding:6px 14px;'
      paperButton(addBot, { tint: '#4fa3d8', w: 84, h: 32 })
      addBot.addEventListener('click', () => client.addBot())
      const fill = document.createElement('button')
      fill.textContent = 'FILL'
      fill.style.cssText = 'font-size:13px;padding:6px 14px;'
      paperButton(fill, { tint: '#9678c8', w: 84, h: 32 })
      fill.addEventListener('click', () => client.fillBots())
      r.append(addBot, fill)
      host.appendChild(r)
    }
    const box = document.createElement('div')
    box.append(code, rosterEl, host)
    return box
  }

  // keep the online roster's lively beans in sync with the joined players
  function syncRoster(): void {
    const players = client.players()
    const sig = players.map((p) => `${p.seat}${p.kitId}${p.kitAway ? 'a' : ''}${p.name}`).join(',')
    if (sig === rosterSig) return
    rosterSig = sig
    // drop stale slots
    const seats = new Set(players.map((p) => p.seat))
    for (const [seat, slot] of rosterBeans) {
      if (!seats.has(seat)) {
        slot.dispose()
        rosterBeans.delete(seat)
      }
    }
    rosterEl.replaceChildren()
    for (const p of players) {
      const card = document.createElement('div')
      card.style.cssText = 'width:66px;height:92px;position:relative;'
      const beanBox = document.createElement('div')
      beanBox.style.cssText = 'width:66px;height:70px;'
      const tag = document.createElement('div')
      tag.style.cssText =
        `font-family:${FONT_HAND};font-size:12px;text-align:center;color:${INK};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`
      tag.textContent = `${p.bot ? '🤖 ' : ''}${p.name}`
      card.append(beanBox, tag)
      rosterEl.appendChild(card)
      const kit = kitColors(p.kitId, p.kitAway) ?? NEUTRAL_UI_KIT
      let slot = rosterBeans.get(p.seat)
      if (!slot) {
        slot = beans.slot(beanBox, kit)
        slot.pop() // celebrate the join
        rosterBeans.set(p.seat, slot)
      } else {
        slot.anchor = beanBox // re-anchor to the fresh card element
        slot.setKit(kit)
      }
    }
  }

  soloBtn.addEventListener('click', () => {
    view = 'solo'
    right.replaceChildren(buildSettings(false))
  })
  onlineBtn.addEventListener('click', () => {
    view = 'online'
    right.replaceChildren(buildSettings(true))
  })

  showHome()

  return {
    get visible() {
      return visible
    },
    setShown(on: boolean): void {
      if (on === visible) return
      visible = on
      root.style.display = on ? 'flex' : 'none'
      if (!on) {
        // tear down the lively beans while hidden so nothing renders off-screen
        for (const s of rosterBeans.values()) s.dispose()
        rosterBeans.clear()
        rosterSig = ''
        jerseyBean?.dispose()
        jerseyBean = null
      } else {
        showHome()
      }
    },
    update() {
      if (visible && view === 'online') syncRoster()
    },
    dispose() {
      root.remove()
    },
  }
}
