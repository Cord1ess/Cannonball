# Cannonball — build progress ledger

> Session handoff document. Updated at every milestone. Read top-to-bottom to
> resume: DONE tells you what exists, NEXT tells you what to build.

## STATUS: M0–M4b + M5a + friend-playtest ready · NEXT UP: M5b (light arc, banners, HUD skin)

### Friend playtest + player names (works over LAN/tunnel, no deploy)
See PLAYTEST.md. Client resolves server from `?server=` (saved to localStorage, https→wss auto);
Vite binds all hosts. **Player names**: `name` field on PlayerState, lobby name input (persisted
in save-data, auto-applied on join), server sanitizes+caps at 16 chars, defaults `Player N`/`Bot
N`. Names show on lobby chips, in ALL match banners (elim/save/emote/handout/winner via
matchUi `nameOf(seat)`), and as **floating billboard tags over each bean's head**
(`render/nameTag.ts` — canvas sprite, own tag hidden in-match, remote tags always on). VERIFIED
with two-browser same-room test: both names propagate, tags render over heads (screenshotted).
Gameplay time DOUBLED for playtesting (tick 10s×survivors, duel 30s).

### Zone fixes (critical — playtest feedback)
BUG: chalk division lines were drawn at k*span (the zone CENTERS = zoneAngles[i]) instead of
(k+0.5)*span (the BOUNDARIES) — so a line ran through each zone's middle, not between zones.
Fixed the grass frag `toBoundary` to `mod(angle, span)` (numerically verified: all 6 lines now
sit exactly where footprintZone flips owners). WHO-OWNS-WHAT indicator added: (1) each wedge's
grass now takes a deliberate 16% tint of its OWNER's team color, fading toward the neutral disc
(this is intentional + readable, NOT the old danger-floor bleed bug); danger red layers on top.
(2) floating owner-name labels — one persistent `nameTag` per zone placed at the wedge's wall
anchor, showing the owner's name colored by their kit (`zoneLabels` pool in online.ts, driven
from state.zoneSeat + playerNameOf). Own wedge shows your name too (tells you which slice to
defend). Both verified on a live 6-zone arena.

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

### Debug fast-iteration tools (user pain: 30s waits per test loop)
Panel (backquote) now has: **skip phase »** (one button drives lobby→draft→launch→arena→…→
rematch, fast-forwarding every wait; draft auto-picks), **+/− bot live** (join/yank bots
MID-MATCH — zones/cannons/crowd repaint instantly, no elimination ceremony; removal blocked
below 2 alive), **freeze ticks** (toggle: physics/abilities stay live, accrual/ticks/
eliminations stand still; auto-unfreezes at rematch). Plus `?fast` URL flag = create the room
with 0.15x timers from the browser. `scripts/smoke-debug.ts` covers all three.
**`?dev` = ZERO-DELAY iteration:** every reload creates a fresh room and jumps STRAIGHT to a
live 6-bean arena (bots fill, draft auto-picks, launch skipped — beans spawn standing in their
wedges, ball centered; 'instantArena' debug cmd, ~51ms server-side, reload→playing ~340ms).
Implies fresh+fast; re-fires whenever the room falls back to lobby. Panel moved to the LEFT.

### M5a.2 — flat look + grass pitch + bean crowd (user feedback pass)
Gouache texture KILLED everywhere (it had seams/scale problems): `makeToonMaterial(color)` is now
a FLAT toon fill, Fall Guys-clean; stone palette brightened (warmGray/greenGray). THE PITCH:
`render/grass.ts` — GPU-instanced stadium grass (technique studied from
achrefelouafi/GrassSystemThreeJS per user, rebuilt in our style): ~60k blades, 5 verts each, ONE
draw call, wind gust+flutter in the vertex shader; ZONES LIVE IN THE SHADER — chalk division
lines, neutral-circle ring, per-zone danger heat, mow bands — so a morph is a uniform write.
Feedback pass 2: pastel sun-washed greens, ~110k thinner blades (w 0.05), crayon discipline —
chalk lines wobble + grain like hand strokes, blades darken toward their side edges.
Feedback pass 3 (top-down gaps): the floor under the blades now wears the user's freestylized
grass_02 tile, preprocessed ONCE offline (playwright canvas: white-clover flowers masked by
blue/green ratio > 0.62 — probed, grass tops out ~0.45 — dilated, onion-peel inpainted, then
pastelized to palette) → `client/public/textures/pitch_grass.png` (the ONLY authored asset;
source folder `grass_02_1k/` gitignored). **Grass upgrades (user request, all in the vertex shader — measured near-zero cost, ~2ms/frame
uncapped at 160k):** blade count 110k→160k; wind is now LAYERED and non-uniform (slow base sway +
big rolling gust fronts that sweep across the field + per-blade flutter); INTERACTIVE displacement
— up to 8 bodies (players + ball, fed each frame from online.ts/sandbox.ts via `setGrassBodies`,
pooled/no-alloc). Feedback pass: TIGHT radii (~body size, not a whole region), blades PART
sideways like walking THROUGH grass with only a whisker of height loss, and SPRINGY recovery —
per-key wobble state (keyed self/rN/ball in online.ts) ramps with move-speed and decays after a
body leaves so blades bob back up. Wind made VISIBLE via `render/windStreaks.ts` (140 instanced
dashes drifting on the wind, brighten on gusts). GOTCHA: streaks MUST be view-space billboarded
— world-flat horizontal quads are seen edge-on from the chase cam and vanish (cost a round).
GOTCHA: never name a GLSL local `flat` (reserved keyword → shader won't compile → grass vanishes).
Perf: fill-bound not geometry-bound, ~5x headroom at 1080p, all of this measured free (~2ms/frame).

**WIND is now a REAL unified system (user request "make wind an actually working part, not a
gimmick").** `shared/src/sim/physics.ts`: `sampleWind(t, strength)` — ONE deterministic wind field,
pure function of time (always-on light breeze + smooth low-freq gust envelope + slowly rotating
dir). Old rng-based `makeWind`/`stepWind`/`Wind` DELETED. `applyWindToBall` (full) + `applyWindTo
Player` (airborne ONLY, gusts shove harder). WIND_ENABLED now TRUE. Server samples from
`fixedElapsed` and applies to ball + airborne beans; replicates only scalar `windStrength` (grows
with elims) — client derives dir/gust itself so PREDICTION MATCHES with zero back-and-forth. Client
(online.ts) mirrors the server clock in `simTime`, applies wind to predicted ball + airborne self,
exposes `currentWind`. Grass shader: constant base sway (never stops) + `uGust`-driven rolling
fronts + flutter, all following the real wind dir. `render/windStreaks.ts` rewritten as LOW curved
S-shaped ribbons (10-seg strips snaking on a travelling sine) that whiz across the field one
direction (fixed the back-and-forth). NEW `render/windMarks.ts`: direction-line streaklets beside
bodies the wind is catching (airborne beans + airborne ball), fed from online.ts. Sandbox wind
unified too. GOTCHA carried: streaks/marks MUST billboard (view-space) or vanish edge-on. 56 tests
+ smoke pass with wind live; perf ~3.6ms/frame uncapped (still ~4x headroom).

**Wind/PvP feedback pass:** (1) BUG FIX — kit/audience colors bled into grass: the danger tint
had a 0.06 floor of `uZoneColors[i]` (team color) so a yellow-kit wedge had permanently yellow
grass. Now danger tints toward warning RED and is ZERO at rest; grass never reads team colors.
(2) Wind NO LONGER pushes the ball (a drifting ball read as netcode lag) — removed applyWindToBall
everywhere; wind still catches airborne beans. (3) PvP fixed: client now predicts `collidePlayers`
(remote stubs shoved transiently, overwritten from snapshots — so you never visually pass through
someone); PLAYER_PUSH 2.5→6, DIVE_PUSH 9→22 with vy launch 2.2→6.5 + a knock stun, so a dive
LAUNCHES the target. (4) Wind streaks rebuilt as PHYSICAL 3D curved tubes (round cross-section,
GPU-bent S-curves, toon-shaded, ~22 of them, higher up) — visible from any angle, no more flat
billboards. GOTCHA: build the tube frame from a REAL tangent (two spine samples) + a ref-up that's
never parallel, else the frame goes degenerate and tubes explode into black smears. (5) Grass gust
displacement much stronger + directional: constant downwind lean + big rolling gust fronts that
bend whole patches over (not just tiny flutter).

**Wind refined to LOCALIZED gust cells (feedback: too much, too uniform, too sine-y).** New
`render/windField.ts`: a pool of ≤6 gust cells that spawn upwind (bursty — sometimes 2-4 at once),
travel downwind across a SMALL area (radius 5-12m), swell then fade on a sin bell, and die. arenaView
owns the field, steps it, feeds the live cells to grass (`grass.setGusts`, `GustCell[]` uniform — a
blade bends only where a cell overlaps it, with a per-cell/per-blade swirl so it's not linear) and to
streaks. Grass base motion is now just a SMALL ambient breeze + jitter (never dead, never a big
uniform wave). `windStreaks.ts` rewritten: thin (r 0.06) FAINT (α 0.42) 3D tubes CLUSTERED at each
active cell (3/cell), fading in/out with it — lines appear in a spot, whiz past, vanish, then another
cluster elsewhere. `windMarks` now only on airborne beans (not the ball). arenaView.update(dt) is
self-driven (owns wind); exposes windDir(). Spectate grass color bug was STALE BUILD — verified clean
(uniform green, no team tint) on current code. 56 tests + smoke pass, no shader errors.

Feedback pass 4: the tile's luminance is remapped
onto the EXACT blade palette at load (grassBase→grassTip, unlit MeshBasicMaterial like the
blades) so ground/blade color can never drift; ground chalk LINES removed (they doubled the
blade-shader lines) — ground keeps only the pale neutral wash + faint mow bands.
**⚠ NEVER re-encode pitch_grass.png (e.g. to JPEG "for size") and never touch the ground
remap/blade-root constants.** The remap normalizes by the image's absolute min/max luminance;
JPEG smoothing+ringing shifts that and washes the whole pitch out pale (cost 3 feedback
rounds). PNG + this exact pipeline = the user-approved look. It is DONE.
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
