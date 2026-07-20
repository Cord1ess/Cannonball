import { KITS, KIT_BY_ID, kitColors } from '@shared/cosmetics/jerseys.ts'
import { GAME_MODES, MATCH_TIME_OPTIONS, DEFAULT_MATCH_TIME_S, gameModeInfo } from '@shared/match/modes.ts'
import type { MatchClient, MatchPlayerInfo } from './online.ts'
import { FONT_HAND, FONT_HEAD, INK, PAPER, inkFrameUrl, paperButton, paperPanel, paperTexture } from './paperSkin.ts'
import { NEUTRAL_UI_KIT, type UiBeanSlot, type UiBeanStage } from '../render/uiBean.ts'
import { requestCreateParty, requestJoinParty } from '../net/connection.ts'

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

const TAGLINE = 'Six players, one ball. Survive the kickoff or get bounced.'

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
  // Crayonara is a thin crayon script → reads small for its size, so bump it up
  tag.style.cssText =
    `font-family:${FONT_HAND};font-weight:500;font-size:clamp(22px,2.4vw,34px);margin-top:16px;` +
    `color:#fdfaf0;text-shadow:2px 2px 0 ${INK};line-height:1.05;`
  tag.textContent = TAGLINE
  left.append(title, tag)
  root.appendChild(left)

  // --- RIGHT: action column (home buttons OR a sliding panel) --------------------
  // wider column so the online lobby has room to breathe (server status, party
  // code, roster, ping) and mode/time button labels never overflow their buttons.
  const PANEL_W = 640
  const right = document.createElement('div')
  right.style.cssText =
    'align-self:center;margin:0 3vw 0 0;width:min(640px,54vw);pointer-events:auto;' +
    'display:flex;flex-direction:column;gap:10px;'
  root.appendChild(right)

  const bigBtn = (label: string, tint: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'font-size:26px;padding:18px 10px;width:100%;'
    paperButton(b, { tint, w: 480, h: 66, big: true })
    return b
  }
  const soloBtn = bigBtn('PLAY SOLO', '#58ae7c')
  const onlineBtn = bigBtn('PLAY ONLINE', '#4fa3d8')

  // the panel container that solo/online slide into
  const panel = document.createElement('div')
  panel.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:14px 26px;'
  paperPanel(panel, { w: PANEL_W, h: 420, weight: 3.2 })

  // The wobbly ink frame is a baked SVG stretched to the panel via
  // background-size:100% 100%. Content height is dynamic (solo vs online, host
  // vs not, roster fill), so RE-BAKE the frame at the panel's REAL rendered size
  // whenever it changes — otherwise the bottom of the content (roster, +BOT,
  // action buttons) spills PAST the frame edge (idea.md §menu fit). Runs on the
  // next frame so layout has settled; re-run after the async roster fills in.
  const refitPanel = (): void => {
    const h = Math.round(panel.getBoundingClientRect().height)
    if (h < 40) return
    // rebuild only the frame layer (first bg image); keep the paper texture layer
    panel.style.backgroundImage = `${inkFrameUrl(PANEL_W, h, INK, 3.2, PAPER)}, url("${paperTexture()}")`
  }
  const scheduleRefit = (): void => {
    requestAnimationFrame(() => requestAnimationFrame(refitPanel))
  }

  function showHome(): void {
    view = 'home'
    right.replaceChildren(soloBtn, onlineBtn)
  }

  // --- shared match-settings block (bot count + your jersey) ---------------------
  let jerseyBean: UiBeanSlot | null = null
  function buildSettings(online: boolean): HTMLElement {
    panel.replaceChildren()
    const h = document.createElement('div')
    // WHITE header (with a solid ink drop shadow like the title) — dark ink on
    // the cream panel read as near-black and barely legible.
    h.style.cssText =
      `font-size:22px;font-weight:800;text-align:center;margin-bottom:0;color:#fdfaf0;text-shadow:2px 2px 0 ${INK};line-height:1;`
    h.textContent = online ? 'ONLINE LOBBY' : 'SOLO MATCH'
    panel.appendChild(h)

    // --- your jersey: a LIVELY 3D bean in a framed SQUARE box + kit cycler ----
    const kitRow = document.createElement('div')
    kitRow.style.cssText = 'display:flex;align-items:center;gap:10px;justify-content:center;margin:0;'
    // a clean framed square the 3D model renders INTO — its own paper card so the
    // model always has a defined box (no half-models bleeding across the panel).
    const beanCard = document.createElement('div')
    beanCard.style.cssText = 'width:92px;height:92px;flex-shrink:0;border-radius:12px;overflow:hidden;'
    paperPanel(beanCard, { w: 92, h: 92, weight: 2.6 })
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

    // bind the lively bean to the jersey card. The selected kit is tracked
    // LOCALLY and applied to the model + label IMMEDIATELY on each cycle, then
    // sent to the server in the background — the old code re-read the kit from
    // server state 60ms after sending, before the round-trip landed, so the
    // model + text never changed (the "jersey swap not working" bug).
    jerseyBean?.dispose()
    let selectedKitId = client.myKitId() || KITS[0]!.id
    if (!KITS.some((k) => k.id === selectedKitId)) selectedKitId = KITS[0]!.id
    jerseyBean = beans.slot(beanCard, kitColors(selectedKitId, false) ?? NEUTRAL_UI_KIT)
    const refreshKit = (): void => {
      kitName.textContent = KIT_BY_ID.get(selectedKitId)?.name ?? 'your team'
      jerseyBean?.setKit(kitColors(selectedKitId, false) ?? NEUTRAL_UI_KIT)
      jerseyBean?.pop()
    }
    const cycleKit = (dir: number): void => {
      const idx = KITS.findIndex((k) => k.id === selectedKitId)
      selectedKitId = KITS[(Math.max(idx, 0) + dir + KITS.length) % KITS.length]!.id
      refreshKit() // reflect INSTANTLY (local), then persist to the server
      client.setKit(selectedKitId)
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
      `font-family:${FONT_HAND};font-size:16px;padding:5px 12px;border-radius:8px;border:2px solid ${INK};` +
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

    scheduleRefit() // fit the ink frame to the built content height
    return panel
  }

  // MATCH SETTINGS: game-mode picker (3 selectable cards) + total-time presets.
  // Online host changes propagate to everyone via setSettings; solo keeps it
  // local (sent on kick-off). Non-host online players see it read-only.
  function buildModeTimePicker(online: boolean): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;'
    const canEdit = true // any lobby player can set mode/time (server allows it)
    // seed from the room state when online (so non-hosts see the host's choice)
    if (online) {
      modeSel = client.mode()
      timeSel = client.matchTime()
    }

    // MODE cards
    const modeLbl = document.createElement('div')
    modeLbl.style.cssText = `font-family:${FONT_HAND};font-size:14px;text-align:center;opacity:0.8;line-height:1;`
    modeLbl.textContent = 'game mode'
    wrap.appendChild(modeLbl)
    const modeRow = document.createElement('div')
    modeRow.style.cssText = 'display:flex;gap:6px;'
    const ruleLine = document.createElement('div')
    ruleLine.style.cssText = `font-family:${FONT_HAND};font-size:12px;text-align:center;min-height:16px;line-height:1.05;color:#6b655c;`
    const renderModes = (): void => {
      if (online) modeSel = client.mode()
      modeRow.replaceChildren()
      for (const m of GAME_MODES) {
        const b = document.createElement('button')
        const on = m.id === modeSel
        b.textContent = m.name
        // wide panel gives each of the 3 buttons ~185px — labels fit on one line;
        // keep wrap enabled as a safety net on very narrow viewports.
        b.style.cssText =
          'flex:1;font-size:12px;padding:8px 6px;line-height:1.05;white-space:normal;overflow-wrap:break-word;min-width:0;'
        paperButton(b, { tint: on ? '#4fa3d8' : undefined, w: 185, h: 40, big: on })
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
        b.style.cssText =
          'flex:1;font-size:12px;padding:8px 6px;white-space:normal;overflow-wrap:break-word;line-height:1.05;min-width:0;'
        paperButton(b, { tint: on ? '#e98a2b' : undefined, w: 185, h: 38, big: on })
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

  // solo: an opponents SLIDER (1..5 bots) — a real range input styled to the
  // paper skin, replacing the old click-dots.
  function buildBotSlider(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'text-align:center;'
    const lbl = document.createElement('div')
    lbl.style.cssText = `font-family:${FONT_HAND};font-size:17px;margin-bottom:6px;`
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '1'
    slider.max = '5'
    slider.step = '1'
    slider.value = String(botCount)
    slider.className = 'bot-slider'
    slider.style.cssText = 'width:82%;cursor:pointer;'
    const render = (): void => {
      lbl.textContent = `opponents: ${botCount} bot${botCount === 1 ? '' : 's'}`
      // paint the filled track up to the thumb (accent), rest cream
      const pct = ((botCount - 1) / 4) * 100
      slider.style.background = `linear-gradient(90deg, #e98a2b 0 ${pct}%, #d8cfb8 ${pct}% 100%)`
    }
    slider.addEventListener('input', () => {
      botCount = Number(slider.value)
      render()
    })
    render()
    wrap.append(lbl, slider)
    return wrap
  }

  // online: the joined roster — each player/bot a lively 3D bean card
  const rosterEl = document.createElement('div')
  const rosterBeans = new Map<number, UiBeanSlot>()
  let rosterSig = ''
  function buildRoster(): HTMLElement {
    const box = document.createElement('div')
    box.style.cssText = 'display:flex;flex-direction:column;gap:6px;'

    // --- PARTY bar: server status + party code (copy) + player count ---------
    const bar = document.createElement('div')
    bar.style.cssText =
      `display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;font-family:${FONT_HAND};font-size:14px;`
    // server status dot (connected because we ARE in a room here)
    const status = document.createElement('div')
    status.style.cssText = 'display:flex;align-items:center;gap:6px;'
    status.innerHTML =
      `<span style="width:10px;height:10px;border-radius:50%;background:#58ae7c;border:1.5px solid ${INK};display:inline-block;"></span>` +
      `<span>server online</span>`
    // player count (live-updated in syncRoster)
    const count = document.createElement('div')
    count.id = 'party-count'
    count.style.cssText = 'opacity:0.85;'
    bar.append(status, count)
    box.appendChild(bar)

    // party CODE row + COPY button (the code IS the room id — share it)
    const codeRow = document.createElement('div')
    codeRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;'
    const codeChip = document.createElement('div')
    codeChip.style.cssText =
      `font-family:${FONT_HEAD};font-weight:800;font-size:20px;letter-spacing:2px;padding:5px 14px;border:2px solid ${INK};border-radius:8px;background:url("${paperTexture()}");background-size:128px;color:${INK};`
    codeChip.textContent = client.roomId
    const copyBtn = document.createElement('button')
    copyBtn.textContent = 'COPY'
    copyBtn.style.cssText = 'font-size:13px;padding:6px 14px;'
    paperButton(copyBtn, { tint: '#4fa3d8', w: 84, h: 34 })
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard?.writeText(client.roomId).catch(() => {})
      copyBtn.textContent = 'COPIED!'
      setTimeout(() => (copyBtn.textContent = 'COPY'), 1200)
    })
    const codeLbl = document.createElement('span')
    codeLbl.style.cssText = `font-family:${FONT_HAND};font-size:14px;opacity:0.85;`
    codeLbl.textContent = 'party code:'
    codeRow.append(codeLbl, codeChip, copyBtn)
    box.appendChild(codeRow)

    // --- roster: all seats, one row -----------------------------------------
    rosterEl.style.cssText = 'display:flex;flex-wrap:nowrap;gap:6px;justify-content:center;min-height:62px;'
    box.appendChild(rosterEl)

    // --- controls: host bot buttons + party create/join ---------------------
    const host = document.createElement('div')
    host.style.cssText = 'display:flex;gap:8px;width:100%;justify-content:center;flex-wrap:wrap;'
    if (client.isHost()) {
      const addBot = document.createElement('button')
      addBot.textContent = '+ BOT'
      addBot.style.cssText = 'font-size:13px;padding:6px 14px;'
      paperButton(addBot, { tint: '#4fa3d8', w: 84, h: 30 })
      addBot.addEventListener('click', () => client.addBot())
      const fill = document.createElement('button')
      fill.textContent = 'FILL'
      fill.style.cssText = 'font-size:13px;padding:6px 14px;'
      paperButton(fill, { tint: '#9678c8', w: 84, h: 30 })
      fill.addEventListener('click', () => client.fillBots())
      host.append(addBot, fill)
    }
    box.appendChild(host)

    // party create / join-by-code — reloading into your OWN room makes YOU host
    // (so you can pick mode/time), and friends join by pasting the same code.
    const partyRow = document.createElement('div')
    partyRow.style.cssText = 'display:flex;gap:8px;width:100%;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:2px;'
    const createBtn = document.createElement('button')
    createBtn.textContent = 'NEW PARTY'
    createBtn.style.cssText = 'font-size:13px;padding:7px 14px;'
    paperButton(createBtn, { tint: '#58ae7c', w: 120, h: 34 })
    createBtn.addEventListener('click', () => {
      requestCreateParty()
      location.href = `${location.pathname}?fresh`
    })
    const joinInput = document.createElement('input')
    joinInput.placeholder = 'paste code'
    joinInput.maxLength = 24
    joinInput.style.cssText =
      `font-family:${FONT_HAND};font-size:15px;padding:6px 10px;border-radius:8px;border:2px solid ${INK};width:120px;text-align:center;` +
      `background:url("${paperTexture()}");background-size:128px;color:${INK};`
    const joinBtn = document.createElement('button')
    joinBtn.textContent = 'JOIN'
    joinBtn.style.cssText = 'font-size:13px;padding:7px 14px;'
    paperButton(joinBtn, { tint: '#e98a2b', w: 84, h: 34 })
    const doJoin = (): void => {
      const c = joinInput.value.trim()
      if (!c) return
      requestJoinParty(c)
      location.href = `${location.pathname}?fresh`
    }
    joinBtn.addEventListener('click', doJoin)
    joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin()
    })
    partyRow.append(createBtn, joinInput, joinBtn)
    box.appendChild(partyRow)

    return box
  }

  // keep the online roster's lively beans in sync with the joined players
  function syncRoster(): void {
    const players = client.players()
    const sig = players.map((p) => `${p.seat}${p.kitId}${p.kitAway ? 'a' : ''}${p.name}`).join(',')
    if (sig === rosterSig) return
    rosterSig = sig
    scheduleRefit() // roster count/size changed → re-fit the panel frame
    // live player count (humans vs bots) in the party bar
    const countEl = document.getElementById('party-count')
    if (countEl) {
      const humans = players.filter((p) => !p.bot).length
      const bots = players.length - humans
      countEl.textContent = `${players.length}/6 players · ${humans} human${humans === 1 ? '' : 's'}${bots ? ` · ${bots} bot${bots === 1 ? '' : 's'}` : ''}`
    }
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
      // narrow cards so all 6 fit one row inside the panel; name clipped to width
      const card = document.createElement('div')
      card.style.cssText = 'width:64px;height:62px;position:relative;flex-shrink:0;'
      const beanBox = document.createElement('div')
      beanBox.style.cssText = 'width:64px;height:48px;'
      const tag = document.createElement('div')
      tag.style.cssText =
        `font-family:${FONT_HAND};font-size:11px;text-align:center;color:${INK};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`
      tag.textContent = p.name
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
