# Cannonball — build progress ledger

> Session handoff document. Updated at every milestone. Read top-to-bottom to
> resume: DONE tells you what exists, NEXT tells you what to build.

## STATUS: M0–M4b + M5a (colosseum redo) complete · NEXT UP: M5b (light arc, banners, HUD skin)

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

### M4b — jersey system
`shared/src/cosmetics/jerseys.ts`: 8 fallback kits { id, name, home/away × { primary, secondary,
pattern solid|stripes|hoops, shorts } }, `DEFAULT_KIT_IDS` per seat (old SEAT_COLORS order),
`resolveKitClashes` (seat order = priority; primaries closer than KIT_CLASH_DISTANCE=45 rgb →
later seat wears away). Server: lobby-only 'kit' message, defaults on join/addBot, re-resolve on
lobby leave, kitId+kitAway replicated on PlayerState, locked after start. Client:
`render/jerseyPainter.ts` (canvas jersey — wobbly painted bands + baked gouache, cached per
colorway), bean torso takes planar UVs + jersey texture when given a KitColors (`createBean(number
| KitColors)` — number = old sandbox path), beans rebuilt on kit change, seat→color map feeds
wedge tints/HUD meters/ball blob/matchUi chips (SEAT_COLORS now sandbox-only + fallback). Lobby:
kit-patterned chips, ‹ swatch+name › picker, "· away kit" marker; choice persists in the vendored
IndexedDB save store and auto-applies on join. Real team research = later user-driven content
pass; crests NEVER (trademark). Verified: 56 tests, smoke-kits.ts (defaults/clash/re-pick/
invalid-id/bot kits/lock), smoke+smoke-bots regressions, playwright lobby+launch+arena shots.

**M4a AND M4b are NOT yet user-playtested in-browser — first thing next session may be feedback
on card feel or jersey look.**

### M5a.2 — flat look + grass pitch + bean crowd (user feedback pass)
Gouache texture KILLED everywhere (it had seams/scale problems): `makeToonMaterial(color)` is now
a FLAT toon fill, Fall Guys-clean; stone palette brightened (warmGray/greenGray). THE PITCH:
`render/grass.ts` — GPU-instanced stadium grass (technique studied from
achrefelouafi/GrassSystemThreeJS per user, rebuilt in our style): ~60k blades, 5 verts each, ONE
draw call, wind gust+flutter in the vertex shader; ZONES LIVE IN THE SHADER — chalk division
lines, neutral-circle ring, per-zone danger heat, mow bands — so a morph is a uniform write.
Feedback pass 2: pastel sun-washed greens, ~110k thinner blades (w 0.05), crayon discipline —
chalk lines wobble + grain like hand strokes, blades darken toward their side edges.
Wedge tint planes/strip lines/decals/disc meshes deleted (grass replaced them). Crowd: cubes →
instanced BEAN spectators (torso+arms merged geometry + baked face plates, 2 draws, ~900), FIVE
tiers + parapets + pennant flags; `recolorCrowd` at every morph dresses each wedge's stands
mostly in that seat's kit color (home fans). arenaView gained `update(dt)` (wind time), called
from both frame loops.

### M5a — THE colosseum (user design revision, replaces the morphing polygon)
**The arena no longer changes shape.** One permanent round stadium; only the PAINTED floor
divisions morph: 6 wedge sectors → 5 → 4 → 3 → two halves. `shared/src/sim/arena.ts` rewritten:
`makeArena(n)` always circular (radius 28 constant now — the old polygons shrank with player
count, this doesn't), `zoneAngles[]` per zone (replaces wallAngles/wallNormals/circle), physics
wall = circle clamp only. `arenaView.ts` rewritten: static colosseum built ONCE (floor, seamless
ring wall, 3 stepped audience tiers + tall outer rim, ~400-instance colored crowd, floating-
island underside, neutral disc + ink ring, decals) + `setZones(arena, colors)` morph layer
(wedge tints w/ danger heat, painted ink division lines per boundary, CANNONS on the wall crown
per zone — dark toon barrel angled inward, seat-colored muzzle band; beans park loaded in them
at launch). online.ts + sandbox.ts keep ONE persistent view and call setZones. Lobby now sits
inside the colosseum (arena visible from boot). Verified: 56 tests (physics regressions hold on
the circular wall), all four smokes, playwright lobby/launch/arena screenshots.

---

## NEXT (see implementation_plan.md for full detail)

- **M5b art & world remainder:** day→sunset→dusk light arc + lanterns at duel, banners w/ fake
  glyphs on the rim, eliminated players seated in the stands, bean face expression swaps, HUD
  paper skin, menu/draft camera framing (currently stares from spawn).
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
