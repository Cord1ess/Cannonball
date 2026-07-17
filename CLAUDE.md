# Cannonball — agent notes

Multiplayer party battle royale (2-6 players + bots) for IUT ICT Fest 2026 GameJam, theme "Kickoff".
Giant ball, wedge zones, tick eliminations, dive-headers, card draft. Solo dev + Claude.

## Read these before working

- **`PROGRESS.md` — CURRENT STATUS + what to build next. Always start here.**
- `idea.md` — settled game design (source of truth for rules)
- `architecture.md` — tech decisions (Colyseus, prediction, hand-rolled physics)
- `art_direction.md` — Messenger/abeto style spec (canvas textures, ink hulls)
- `implementation_plan.md` — milestone plan M0-M8 with cut lines

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
- **Friend playtest (no deploy): see PLAYTEST.md.** Share one link
  `http://<client>/?server=<server>`. Server resolution order: ?server → saved (localStorage)
  → VITE_SERVER_URL → same-host:2567. Failed connect shows a red bar with an input to paste the
  server address + retry. Vite binds all hosts (`host:true, allowedHosts:true`) for tunnels/LAN.
- Debug: backquote = panel (skip-phase, live ±bot, freeze ticks, reset round/ball, ball-to-me,
  wind, elim-me, new room), G = server ghosts.
- Reload reconnects to the same seat via sessionStorage token + 20s grace.
- All tuning constants live in `shared/src/constants.ts`; cards in `shared/src/cards/definitions.ts`.
