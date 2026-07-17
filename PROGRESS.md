# Cannonball — build progress ledger

> Session handoff document. Updated at every milestone. Read top-to-bottom to
> resume: DONE tells you what exists, NEXT tells you what to build.

## STATUS: M0–M4a complete · NEXT UP: M4b (jersey system)

---

## DONE

### M0 — scaffold + style graybox
npm workspaces (`shared`/`server`/`client` + `vendor/arc` lifted ARC utilities with 33 tests).
TS7, Vite 8, three 0.185, Colyseus 0.17 (+ `@colyseus/sdk` client). Style kit: canvas-generated
gouache/stroke/tick/grain/sky textures, subtle 2-step toon ramp, sketch inverted-hull ink outlines
(smooth-normal hull geometry), painted sky dome, paper-grain overlay.

### M1 — offline sandbox (kept at `?offline`)
Shared arcade physics (three-free, Node-safe): polygon arena math (`shared/src/sim/arena.ts`),
player/ball sim (`physics.ts`), tick judgment (`meters.ts`). Blocky bean (Fall Guys proportions,
Minecraft box construction, spring-target animation: eyes track ball + blink, fidgets, T-pose
sprint glide w/ mini-hops, Q/E lean, dive pose, knocked flail). Chase camera + pointer lock.
**Controls: WASD run · Shift sprint (stamina) · Space jump · LMB/Ctrl mid-air = DIVE (the header)
· RMB/F = ability · Q/E tilt · 1-4 emotes · R restart(sandbox) · ` debug · G ghosts.**

### M2 — netcode + ball feel
Server-authoritative 60Hz (vendored `Time`), 30Hz patches. Client prediction + rewind-replay
reconciliation (seq acks), remotes interpolate 100ms, ball locally simulated with per-patch
stepped correction budget + server-sample velocity lookahead (no rubber-band at speed).
Contact solver (industry trio): true 3D sphere-vs-capsule normals, ball substepping (anti-tunnel,
max 4), impulse resolution w/ separating-velocity early-out, 5:1 mass ratio, Baumgarte slop,
Coulomb friction (mu 0.25). Fast ball KNOCKS players (stun+flail, Δv-based); stand on ball works.
Wind exists but `WIND_ENABLED=false` until ball feel is fully approved. 5 physics regression tests.
Reload = same bean (reconnection token); hardened connect (timeouts + state-arrival verification);
offline fallback shows a loud red banner. Debug panel + server-ghost overlays.

### M3 — full match spine
Phases (`shared/src/match/phases.ts`): LOBBY → DRAFT → LAUNCH → ARENA →(tick)→ RESTART(±HALFTIME)
→ LAUNCH… → DUEL (at 2) → END → rematch. Server machine in `server/src/rooms/MatchRoom.ts`
(transitions ONLY there). Lobby: room code, host start, **+BOT / FILL WITH BOTS**. Draft: private
3×3 rarity-weighted offers (60/30/10), 25s, auto-pick. Launch: parked on wall crown, A/D aims
±25°, ballistic volley (physics does the parabola). Tick = survivors×5s; interval accrual;
zero-accrual ticks eliminate nobody. Restart: eliminated player targets auto-generated
advantage+curse (8s, timeout: curse→leader by lowest cumulative); public reveal; arena morphs
(hexagon→…→circle); relaunch. Ties → OVERTIME micro-round (recentered ball, tied zones only,
first accrual loses). Halftime at survivors==3 (4-6p): wedge reshuffle (card-swap UI cut to M8).
Duel: cumulative meters, capacity 15s, first full loses. Eliminated: orbit spectator cam + emotes.
Permanent mid-match leave = elimination w/ auto-handout. Bots (pulled from M7): wedge-anchored
wander, chase when ball in their wedge or nearest-to-neutral-ball, wall-side approach, jump+dive
clear, occasional ability. `{fast:true}` rooms ×0.15 all timers. Match UI: `client/src/game/matchUi.ts`.

### M4a — cards are REAL (just committed)
`shared/src/cards/effects.ts`: pure `computeMods()` (runs identically server+client-prediction).
Passives: anklet/springs/bumper(nudge×2.4)/magboots(knockTaken×0.45)/hardhat/moonsuit(gravity×0.55)/
slimwedge/padded/reload/comeback(conditional: meter highest). Abilities (RMB/F, cd chip on HUD):
dash, shove(radial ball+players), ballstop, shield(1.2s immovable bouncy, knock-immune),
grapple(long low lunge), tractor(1.5s ball pull). Restart pairs all live, attach at handout,
expire at next restart (persist through duel by design). freesave/bodyguard auto-punt (1/interval,
'save' broadcast+banner). Magnet curse = ball drift toward cursed wedge. Slim/Wide Zone = REAL
judgment geometry (`footprintZoneWidths` in arena.ts: narrow→neutral edge strips, wide neighbor
claims them). Schema: activeAdv/activeCurse/abilityCd replicated. 47 tests green.

**NOT yet verified by the user in-browser (they compacted right after M4a commit) — first thing
next session may be feedback on card feel.**

---

## NEXT: M4b — jersey system (second half of M4)

Design (idea.md §5 Team skins + architecture.md): players pick real football national teams/clubs
in the LOBBY; bean wears that kit. Plan:
1. `shared/src/cosmetics/jerseys.ts` — kit data: { id, name, primary, secondary, pattern:
   'solid'|'stripes'|'hoops', shorts, away:{...} }. Fallback set of ~8 kits (current SEAT_COLORS
   hues as defaults for bots/quick play). Server clash rule: too-close primary → assign away kit.
2. Server: 'kit' message (lobby only) → store kitId on PlayerState (add schema field); bots get
   default kits by seat.
3. Client: `jerseyPainter` (canvas kit texture, once per player at lobby); bean body cluster gets
   planar-UV texture instead of flat color (bean.ts takes a kit param — keep old color path for
   sandbox). Identity color = kit.primary everywhere SEAT_COLORS is used for a seat
   (wedge tints, HUD meters, matchUi chips, ball blob) — build a seat→color map from state.
4. Lobby UI: kit picker (cycle/dropdown on your chip) + persist chosen kit in the vendored
   save-data store, auto-apply on join.
5. Real team list = content pass later (user does research); system ships with fallback kits.
Cut lines: patterns beyond solid/stripes/hoops; crests NEVER (trademark).

## THEN (see implementation_plan.md for full detail)

- **M5 art & world:** floating COLOSSEUM (user direction: seamless ring walls, audience tiers on
  the crown where eliminated players sit, cannons on wall top), day→sunset→dusk light arc +
  lanterns at duel, shadow-shape decals, banners w/ fake glyphs, HUD paper skin, bean face
  expression swaps. Camera during lobby/draft currently stares at the ball — give menus a nice
  camera framing too.
- **M6 juice & audio:** hitstop, camera punch, squash-stretch, pooled particles (header burst,
  launch puff, elim poof, confetti), force-scaled SFX over vendored WebAudio (+`toneClip`
  placeholders), one lo-fi loop, autoplay unlock, tab-mute.
- **M7 hardening & submission:** bot aim improvement, edge cases (overtime stall timeout,
  rematch state, reconnect into non-lobby phases — currently onJoin throws mid-match, ok but
  reconnection path works), perf audit (draw calls <150, zero hot-path allocs), DEPLOY (Render
  free Singapore + Netlify — user hasn't made accounts yet; keep-alive via UptimeRobot; LAN
  fallback), itch page. Wind re-enable decision (`WIND_ENABLED`) after ball feel final.
- **M8 stretch:** halftime card-swap UI, line boil, morph tween, victory ceremony, card balance.

## Deferred by user decision

- Deploy (waiting on GitHub/Render/Netlify accounts — all free tiers).
- Fine feel-tuning (constants in `shared/src/constants.ts`; user said "later when testing").
- Card list finalization + real jersey research (playtest-time content passes).
- Wind (disabled until ball fully approved).

## Open user-facing questions parked

- Card feel feedback after first real M4a playtest.
- When to do the deploy step (accounts).
