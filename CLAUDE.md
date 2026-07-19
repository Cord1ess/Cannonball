# Cannonball — agent notes

Multiplayer party battle royale (2-6 players + bots) for IUT ICT Fest 2026 GameJam, theme "Kickoff".
Giant ball, wedge zones, tick eliminations, dive-headers, card draft. Solo dev + Claude.

## Read these before working

All design/status docs live in `docs/` (this CLAUDE.md stays at root so it auto-loads).

- **`docs/PROGRESS.md` — CURRENT STATUS + what to build next. Always start here.**
- `docs/idea.md` — settled game design (source of truth for rules)
- `docs/architecture.md` — tech decisions (Colyseus, prediction, hand-rolled physics)
- `docs/art_direction.md` — Messenger/abeto style spec (canvas textures, ink hulls)
- `docs/implementation_plan.md` — milestone plan M0-M8 with cut lines
- (code comments cite these by bare filename, e.g. `idea.md §1` — all now under `docs/`)

## Commands

- `npm run dev:server` / `npm run dev:client` — THE USER runs these (ports 2567 / 5173)
- `npm run typecheck` · `npm test` (vitest: vendor + shared) · `npm run build`
- Smokes (start a transient server first): in `server/`:
  `PORT=2599 npx tsx src/index.ts` (background), then
  `ENDPOINT=ws://localhost:2599 npx tsx scripts/smoke.ts` (2p full spine)
  · `smoke3.ts` (3p elim/handout/duel) · `smoke-bots.ts` (solo+5 bots full match)
  · `probe.ts` / `probe-phase.ts` (inspect live room state)
- Headless visuals: playwright is a devDep; transient vite on port 5199, screenshot, kill it.

## Hard rules

- **Git:** author Cord1ess <jonayed.inferno@gmail.com> (repo-local). NO Co-Authored-By.
  Commit messages: plain lowercase comma-separated sentences, no feat:/fix: prefixes.
- **Never hold background servers on 2567/5173** — they're the user's. Test on 2599/5199,
  ALWAYS kill after (Windows leaves orphans: `netstat -ano | grep PORT` → `taskkill //PID n //F //T`).
- After editing server files, remind the user to restart their dev server.
- Playtest gates: the user judges feel; ship increments, wait for their verdict.

## Gotchas learned the hard way

- Client SDK is **`@colyseus/sdk`** (0.17) — `colyseus.js` is capped at 0.16, protocol-incompatible.
- Schema via **`schema({...})` factory** (schema v4) — decorators break under tsx (Symbol.metadata).
- `Room<{ state: MatchStateT }>` generic; `onLeave(client, code)` — code 4000 = consented.
- Colyseus 0.17 serves `GET /__healthcheck` itself; never add a custom request handler (it races).
- Room option `{ fast: true }` scales all pauses/ticks ×0.15 (tests/dev).
- Client URL flags: `?dev` (reload = INSTANT live arena with bots; implies fresh+fast)
  · `?server=wss://host` (point client at a specific server — tunnels/LAN; auto https→wss)
  · `?offline` (M1 sandbox) · `?fresh` (new room) · `?lag=100` (send delay)
  · `?fast` (create room with 0.15x phase timers).
- **Friend playtest (no deploy): see docs/PLAYTEST.md.** Share one link
  `http://<client>/?server=<server>`. Server resolution order: ?server → saved (localStorage)
  → VITE_SERVER_URL → same-host:2567. Failed connect shows a red bar with an input to paste the
  server address + retry. Vite binds all hosts (`host:true, allowedHosts:true`) for tunnels/LAN.
- Debug: backquote = grouped panel — FLOW (skip-phase, reset round/lobby, win-me, elim-me),
  PLAYERS (±bot, clear bots), CLOCK (freeze, ±15s, reset score, slow-mo), BALL/WIND
  (ball-to-me, reset ball, wind), new room; toggles show on/off, momentary buttons flash;
  rich live stats. G = server ghosts.
- Match HUD: `game/leaderboard.ts` — center "next elimination" countdown + right-side risk-ranked
  leaderboard (bean-cutout icons, meter bars, animated reorder). Old hud.ts timer/meter row hidden.
- Reload reconnects to the same seat via sessionStorage token + 20s grace.
- All tuning constants live in `shared/src/constants.ts`; cards in `shared/src/cards/definitions.ts`.
- **Spectate (eliminated):** V = toggle orbit-overview ↔ follow-a-player; Space = cycle players.
  Orbit cam is a raised broadcast angle; follow is a chase cam. Hint shown at screen bottom.
- **World/rendering gotchas (M5b, cost real rounds — heed these):**
  · CROWD (`render/crowd.ts`) fans ARE the player bean, geometry EXTRACTED from `createBean()`.
    When touching it: KEEP the normal attribute through extraction (stripped normals → NaN →
    exploded mesh), de-index before merge, never merge already-merged sub-geometries. It's a
    GPU-shader crowd (emotes in the vertex shader from a per-instance seed) — one instanced fill +
    outline + face; do NOT animate on the CPU. Scale 1.0, row spacing ≥ fan width or it smears.
  · Custom ShaderMaterials (grass, crowd) IGNORE three.js scene lights — day/night + floodlight
    effects on them are done by tinting IN-SHADER via a `uNight`/`setNight(frac)` uniform, NOT by
    the sun/spots. The sun + 4 floodlight SpotLights only light the LIT materials (beans, ball,
    toon stadium) and cast shadows onto the grass (which receives via `getShadowMask`).
  · FLOODLIGHTS: `decay=0` on the SpotLights (decay killed the light before the field). They're a
    HARD on/off switch at night frac ≥ 0.9 (not a dimmer); spots start `castShadow=false`; sun
    stops casting at night. In the grass shader the cast-shadow multiply must come AFTER the night
    re-tint or the re-tint discards it.
  · GROUND/APRON: never put a full disc under the pitch (z-fights the grass); use a ring dropped
    below y=0. Never re-encode `pitch_grass.png` or touch its remap (see the locked-texture note).
  · Ball skin is PROCEDURAL — `ballTexture()` in `render/textures.ts` (world-cup panel skin painted
    in-style), NOT an authored asset. The old downloaded `ball_*.png` set was removed in cleanup.
- Headless screenshot notes: rAF is throttled (sparse random logs miss frames — log first-N
  instead); the `eliminate me` debug click + long mouse-move loops can crash the headless page.
  CDP `Page.captureScreenshot` is more reliable than Playwright's (which waits on fonts).
