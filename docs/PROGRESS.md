# Cannonball — build progress ledger

> Session handoff document. Updated at every milestone. Read top-to-bottom to
> resume: DONE tells you what exists, NEXT tells you what to build.

## STATUS: M0–M5a + M5b (stadium, crowd, ball, day→night+floodlights, spectate) DONE · NEXT: M6 juice+audio, or M5b leftovers (eliminated-in-stands, HUD paper skin, draft cam)

### M5b — FULL WORLD PASS (this session): stadium + crowd + ball + night lighting + spectate
All committed, typecheck + 56 tests green, 0 shader errors. Files: `render/crowd.ts` (new),
`render/arenaView.ts`, `render/grass.ts`, `render/dayNight.ts`, `render/ballView.ts`,
`render/textures.ts`, `render/clouds.ts`, `render/bean.ts`, `game/camera.ts`, `game/online.ts`,
`game/input.ts`, `game/sandbox.ts`, `main.ts`.

**STADIUM (arenaView.ts) — fully rebuilt.** Layer order OUT from the pitch: field (grass r=28) →
protective NET at the field edge (thin, r+0.4) → solid DISPLAY WALL on a low sandy PLINTH (dark LED
screen band facing pitch; ads mount here later) → raked SEATING rising straight off the display (no
gap) → rim → cannons/flags/light-towers. EVERYTHING anchors to the GROUND (y=0), not WALL_HEIGHT — a
sandy APRON ring (a ring/annulus dropped just BELOW the grass, NOT a full disc — a full disc
z-fights the grass) gives the perimeter solid ground. Seating: TWO teal DECKS, each step = a dark
RISER wall + a light TREAD cap (light-seat/dark-wall), A/B per-row banding, concrete VOM band
splitting decks. Real VERTICAL AISLES = instanced concrete STAIR channels (one draw) at each aisle
angle; the crowd leaves those angles empty. Colours in the `STADIUM` palette const (sandy frame,
teal seat family — NO rainbow). Cannons moved to the TOPMOST rim aiming DOWN-inward at the pitch.
24 waving team FLAGS (shader-waved) + 4 corner FLOODLIGHT TOWERS on the rim.

**CROWD (`render/crowd.ts`) — the hard-won part; READ before touching.** Fans ARE the real player
bean, geometry EXTRACTED from `createBean()` (walk its solid meshes, bake transforms, KEEP+transform
NORMALS — stripping normals = NaN = exploded mesh, cost many rounds; de-index to flat position so the
merge is always clean; tag each vertex with an animation PART via `aPart`). ALL emotes in the VERTEX
SHADER from a per-instance seed (bob, both-arms-up cheer, one-arm wave+waggle, little jumps, head
look L/R, blink) — one InstancedMesh fill + one outline (inverted hull) + one face (plate+eyes) pass,
~zero per-frame CPU (only the clock uniform). Fans wear the REAL team JERSEY: per-instance primary +
secondary + pattern (0 solid/1 stripes/2 hoops), painted in the shader (stripes=vertical, hoops=
horizontal bands on the torso). `setSections(sectionKits, sectionAlive)` binds each fan to a FIXED
stand section (6-way by angle) supporting one seat's team; when a team is ELIMINATED its fans LEAVE
(hidden via scale-0 instance matrix, ~15% stay), driven from the full seat roster in online.ts
`rebuildArenaIfNeeded` (aliveKey in the cache key). Sparse held team BANNERS (~1.5% of fans, shader-
waved). `setNight(frac)` dims the whole crowd (shader ignores scene lights). GOTCHAS: fan SCALE 1.0 +
row spacing 1.25 (packing tighter than fan width = smeared carpet); the arm pivot is the real
shoulder (0.52, 1.0); the head/face turn around the NECK, not world origin.

**BALL (`ballView.ts`).** Fake disc shadow REMOVED (real cast shadow only). Wears the PROCEDURAL
`ballTexture()` (render/textures.ts) — a colourful world-cup-style panel skin painted in our canvas
style (cream base, wobbly seams, teal/coral/gold accent panels, dark pentagons), equirect on the
sphere UV — on a MeshToonMaterial. Zero authored assets. (The cleanup pass dropped the downloaded
`ball_*.png` set and the gitignored `Ball Texture/` source in favour of this.) Zone-colour indicator
gone (the `zone` param is now `_zone`).

**DAY→NIGHT + FLOODLIGHTS (`dayNight.ts` + `arenaView.ts` + `grass.ts`).** Match-progress driven
(elims done / elims-to-night; 6p→full night ~3 left; small lobbies stretch to the end), MONOTONIC,
one smooth flow (only LOBBY resets to day; `stepProgress` creeps continuously between elims). Visible
SUN disc arcs high→horizon; `depthTest:true` so it never bleeds through the stadium. Grass/ground
unlit → tinted in-shader: dark dusk as night falls, then FLIPS to floodlit-bright at the switch
point. FLOODLIGHTS are the KEY thing (many rounds to get right): 4 real shadow-casting SpotLights
(same system as the sun) added to the SCENE, `decay=0` (with decay the light died before reaching the
field — that was THE bug), aimed near centre (overlapping) so a player casts 4 shadows. HARD ON/OFF
switch at `LIGHTS_ON_AT=0.9` (not a dimmer) — off through day+dusk, SNAP on at nightfall. Each spot
`castShadow` STARTS false (creation-true + the on/off guard skipped resetting it = 4 shadows in
daylight bug). Sun stops casting its shadow at night (`sun.castShadow = f<0.9`) so night shows only
the 4 flood shadows. GRASS SHADOW must apply AFTER the night re-tint (the re-tint rebuilds colour
from the base palette and discards an earlier shadow — that was the "no night shadows" bug); night
shadow strength kept SUBTLE (0.22). Per-tower intensity 0.7, night hemi 0.3. Subtle low-opacity
additive light BEAM per tower (fresnel + length fade) switches on with the lights. Debug: backquote
→ WORLD group → "night ↔ day" toggle (nightCycle, client-only).

**CLOUDS (`clouds.ts`).** Real 3D bubbly toon clouds (clustered flattened spheres, NO outline —
outline looked odd), random each session, drift/bob/breathe, tint with the sun.

**SPECTATE (`game/camera.ts` + `online.ts` + `input.ts` + `main.ts`).** Eliminated players get a
raised angled-down broadcast ORBIT (radius+21, height 22, look y=3.5) OR a FOLLOW mode (chase a
player). **V** toggles orbit↔follow, **Space** cycles alive players; camera glides, auto-advances if
the followed player dies; a HUD hint shows mode + name. Ground name markers hidden while spectating;
grass ownership tint softened (0.16→0.10) so a big wedge isn't a fully-coloured half in the overview.

### M5b — earlier passes (superseded/folded into the above; kept for history)
- ANIMATED CROWD (`render/crowd.ts`): ~1000+ fans, ALL animation in the VERTEX SHADER from
  per-instance seeds (bob, both-arms-up cheer, one-arm wave+waggle, head look L/R, blink) — ONE
  InstancedMesh, ~zero per-frame CPU (only uTime written). Fans are little beans (body + separate
  head, tagged per-part via `aPart` so the shader swings arms around the shoulder + turns the head).
  Crayon INK BORDER is a second instanced inverted-hull pass sharing the SAME animation (rides the
  moving arms). Faces = a third instanced quad (eyes + shader blink). recolor() fills each wedge's
  stands with its owner-seat supporters. Draws: fill + outline + faces = 3 for the whole crowd.
  GOTCHAS fixed: declare every uniform you reference in the shader source (uLight was missing →
  vanished the crowd); do NOT put `precision mediump float;` in a custom frag when the vertex uses
  default highp (uOutline precision mismatch → no compile).
- STADIUM STRUCTURE (arenaView.ts) rebuilt: pitch → a continuous perimeter DISPLAY-BOARD ring at
  the field edge (dark LED screen face toward the pitch; the digital signs mount here later) → a
  SHORT + THIN protective NET (keeps the ball in, doesn't wall the view) → raked SEATING that climbs
  steeply DIRECTLY from the fence (no flat track/concourse gap) with radial walk AISLES (10) and
  COLOURFUL art-style seat bands (teal/coral/butter/sage/rose/sky cycled up the rake) — replaces the
  flat off-white cylinders. New STADIUM palette (warm frame, taupe rails, colourful seatTones).
- CANNONS moved to the TOPMOST rim (above the audience), barrel tipped down-and-inward so they aim
  into the pitch, never out over the crowd (matches the future trajectory rule).
- Rim crown gained WAVING team FLAGS (24, waved in the vertex shader — one uniform/frame) and FOUR
  tall FLOODLIGHT TOWERS at the corners (pole + lamp bank of bright cells).
- Verified: typecheck + 56 tests, 0 shader errors, day + crowd closeups screenshotted (fans read as
  outlined beans with heads, colourful bowl). Perf: crowd is GPU-only, one InstancedMesh set.
  NOTE staged delivery — user validates feel/perf on real hardware; polish (fan feel, tower beams,
  night lights bang-on, sign content) is pass 2.

### M5b — smooth night flow, bigger sun, real 3D clouds (feedback pass 2)
- NIGHT TRANSITION is now ONE smooth monotonic flow. Bug was: every non-play phase (draft/kickoff/
  RESTART/duel) forced day, so night snapped back to day between rounds then jumped forward. Fix:
  only Phase.Lobby resets to day; all mid-match phases keep progress (survivors already decremented).
  Plus dayNight now tracks a MONOTONIC `stepProgress` (never regresses in a match; only a drop to ~0
  = new match resets it) and the effective target CREEPS from each step toward the next (~0.012/s,
  capped) so the sky keeps darkening continuously instead of freezing then jumping. Verified: sky
  tint sampled across a fast match = ffffff→…→a5a7b3, strictly monotonic, no day snap-backs.
- SUN DISC much bigger: canvas 128→256 with a fat bright core (solid to 0.42) + wide soft glow halo;
  sizes 26/16 → 62/44 (day/night). Keeps the additive glow.
- CLOUDS revamped: flat painted PNG clouds KILLED from skyTexture. New `render/clouds.ts` — real 3D
  BUBBLY toon clouds, each a cluster of 6-10 overlapping low-poly spheres merged and wrapped in ONE
  crayon INK HULL (matches the game's flat-shaded hand-outlined style), flat toon white so they
  warm/cool with the day→night sun for free. RANDOM every session (puff count/shape/size/sky pos)
  and ALIVE: 11 clouds drift around the sky bowl (mixed directions), bob, and each puff breathes so
  the silhouette churns. Placed low near the sky dome so they ride the visible band above the rim
  (chase-cam pitch is clamped ~[-7°,+34°]). Verified: 0 shader errors, clouds render day + night.
- OWN-ZONE GROUND NAME hardened again: zoneLabel now BLANKS its texture when hidden (1×1 clear) so a
  stale name can never linger a frame; the seat+name guard already prevents drawing it. (Live
  spectator capture showed no own ground label on the current build.)

### M5b — real sun, shadows, ground darkening, wind glitch fix (feedback pass)
- REAL VISIBLE SUN: a soft additive sprite disc (`dayNight.ts`) that ARCS across the sky —
  high + bright sharp daytime (day sun intensity 1.35) sinking to the horizon and setting as
  night falls (`sunDirection(frac)`: azimuth swings ~120°, altitude ~54°→~5°). The sun's light +
  the disc share the arc, so shadows visibly rotate + lengthen across the match.
- NIGHT DRIVER is now MATCH PROGRESS, not raw survivors: `setMatchProgress(survivors, seatsAtStart)`
  → target = elimsDone / (seatsAtStart − nightAt), where `nightAt = max(1, seatsAtStart−3)`. So 6p
  reaches full night at 3 left; 3p/2p stretch the day→night fall across the whole match; ALWAYS
  opens in day. Lobby/pre-match forced to day. `onNightfall` one-shot hook reserved for the future
  light-prop + audio "bang" pop.
- SHADOWS (single 2048² PCF, industry-optimal for mass grass): `renderer.shadowMap.type =
  PCFShadowMap` (NB r0.185: PCFShadowMap IS the soft Vogel-disk path; PCFSoftShadowMap falls
  through to hard BASIC). One DirectionalLight caster fitted tight to the pitch (±40, near/far
  40/360). Casters: bean body+shorts, ball, wall (`castShadow`). The GRASS RECEIVES in-shader —
  `#include <shadowmap_pars_vertex/_fragment>` + `lights_pars_begin` + `shadowmask_pars_fragment`,
  `getShadowMask()` × 0.45 into the blade color; ONE shadow-map read per fragment, NO per-blade
  self-shadow, NO extra draw. Material needs `lights: true` + merged `UniformsLib.lights` (live
  object uniforms kept OUT of the deep-cloning merge, re-assigned after) + `mesh.receiveShadow=true`.
  Verified: 0 shader errors, contact + long raking shadows visible day and night.
- GROUND DARKENS at night: `floorTopMat.color` multiplied toward 0x4a5566 as night falls so the
  (fine-tuned, bright) pitch tile stops glowing. ONLY the material color multiplier is touched —
  the texture + its remap pipeline are NEVER modified (still locked, see the ground note).
- OWN-ZONE GROUND TAG removed for good: guarded by seat AND name (catches stale mySeat / the
  seat-default-to-0 case) AND unknown owners; the head tag still names you.
- WIND GLITCH fixed at the ROOT: `windField.step()` returned a COMPACTED `live` array whose indices
  reshuffled every frame as cells spawned/died — so streak clusters + grass gust patches (bound by
  index) teleported between unrelated gusts. Now step() returns the FULL fixed pool (index == a
  STABLE slot, strength 0 when inactive); consumers skip strength-0 slots. With the existing sin-bell
  strength envelope (0→peak→0) gusts now only fade in on spawn + out on death, never jump.

### M5b — day → night light arc (first M5b piece, done)
Survivor-driven: the pitch opens in full daylight and eases toward a dusky moonlit NIGHT,
reaching FULL night by the time 3 players remain (stays night through the duel). Reset to day
in lobby/pre-match. `render/dayNight.ts` owns two keyframe palettes (DAY/NIGHT) and lerps the
sun (color+intensity+lowers toward horizon), hemisphere fill, scene.fog (color+near/far), the
sky-dome tint (multiplied down to night blue), and the GRASS — which is unlit (MeshBasicMaterial)
so it can't take lights; a new `uNight` uniform tints it down + cool IN THE FRAG SHADER (tips keep
a sliver of moonlight so blades still read). `nightFrac` is EASED (`frac += (target-frac)*dt*0.55`,
frame-rate-independent) so dusk falls gradually, never a snap on elimination. Wiring: main.ts owns
sun/hemi/sky/fog and passes a `WorldLighting` bundle into the game → `createArenaView(radius,
lighting)` builds the DayNight and drives it from `arenaView.update(dt)`; online.ts + sandbox.ts
call `arenaView.setSurvivors(n)` each frame (day in non-play phases). DEBUG: new "world" accordion
group with a `night ↔ day` toggle (`nightCycle`, CLIENT-ONLY — intercepted in online.ts, never sent
to the server; `debugForceNight` overrides the survivor arc) so night is previewable without
playing down to 3. Stadium light PROPS (lamps/lanterns) come later. Verified: typecheck + 56 tests,
zero shader errors, full-night palette screenshotted (deep-blue sky, cooled stadium, crowd faces
read like lights in the dark, deeper grass). NOTE: headless rAF is throttled so the eased arc
crawls in playwright — the DESTINATION palette is correct; real 60fps browser converges in ~2-3s.

### Playtest feedback round 2
- Own name tag now floats over MY head in-match too (not just the flat grass zone label).
- ELIMINATION GRACE (server): per-seat ball-DWELL timer — ball must sit in a zone ZONE_DWELL_
  GRACE_S(0.6s) before it accrues; + a TICK_LOCKIN_S(1.0s) final-whistle freeze so a last-instant
  ball flip can't doom you (network/reaction fairness). `#zoneDwell[]`, reset at beginLaunch.
- WIND (corrected): the misunderstanding was "circular" = the gust TRAVEL PATH, not the grass
  bend. windField cells now ORBIT the arena center on curved arcs (orbitR/angle/angVel, swirlSign
  bowl direction); each cell carries its own tangent dir (GustCell.dirX/dirZ) → grass + streaks
  bend along THAT per-cell direction (uGustDir[] / iDir attribute). Grass swirl reverted to a
  simple along-dir bend. Idle sway keeps the breathing envelope.
- CAMERA: robust never-inside-wall — boom-cap at the arena-exit distance + a HARD radial clamp on
  the smoothed position every frame + raise-as-pulled-in; bound is now radius-1.5 (inside the wall).
- DEBUG panel: ACCORDION (one section open at a time, no vertical scroll), grouped FLOW/PLAYERS/
  CLOCK&SCORE/BALL&WIND/ROOM, toggle state + click flash feedback, rich live stats.
- HUD: live PICTURE-IN-PICTURE selfie cam (2nd PerspectiveCamera on the local bean's face,
  scissored top-right) — now SMALL + CIRCULAR (radial-gradient sky mask hides the square
  scissor corners, ring frame + "YOU" tab). Leaderboard below it.
- Own name tag: shows over MY head in-match; NO duplicate flat ground label on my own zone;
  head-tag font/scale fixed so it's never squashed.

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
pastelized to palette) → `client/public/textures/pitch_grass.png` (the ONLY authored asset; the
`grass_02_1k/` source tiles were removed in the cleanup pass since the bake is committed). **Grass upgrades (user request, all in the vertex shader — measured near-zero cost, ~2ms/frame
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

- **M5b — MOSTLY DONE this session** (stadium, animated crowd+jerseys+banners+elim-leave, ball skin,
  day→night arc, real floodlights+shadows, spectate orbit/follow). LEFTOVERS still open:
  - eliminated players SEATED in the stands (currently they just orbit-spectate; the crowd already
    supports hide/show per section — could reuse to seat the eliminated bean among the fans).
  - bean FACE EXPRESSION swaps (react to elim/save/near-miss — pays off in the PIP selfie cam).
  - HUD PAPER SKIN (leaderboard/HUD get the paper-grain art treatment).
  - MENU/DRAFT camera framing (lobby/draft currently stare from spawn — give deliberate framing).
  - AD BOARD content: the display wall's dark LED band is ready for the digital signs (user said
    "we'll use the signs later"). The ball textures folder also has roughness/metallic maps unused.
  - the `onNightfall` one-shot hook is wired but unused — reserved for the light-switch-on audio
    "bang" once M6 audio exists.
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
