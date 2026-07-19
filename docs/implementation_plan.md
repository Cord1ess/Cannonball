# Cannonball — Implementation Plan

> Executes: `idea.md` (design) · `architecture.md` (tech) · `art_direction.md` (look) · `vendor/arc/` (lifted foundation). This document adds nothing new to the design — it orders the build.
>
> **Ground rules:** jam clock is running. Every milestone ends **playable** — never more than a few hours from something that runs. Feel gates before content (M1 is a fun-test, not a checkbox). Each milestone has a **cut line**: what to drop if its time box blows. Numbers live in `shared/constants.ts` from day one so balancing never touches code.
>
> **Estimated core total: ~53h** across M0–M7, leaving slack inside a 72h window; the cut ladder (bottom of this doc) compresses it toward 48h.

---

## M0 — Scaffold + style graybox (~4h)

**Goal:** a repo that builds, a server that answers, and a gray scene that already looks hand-drawn.

- `git init`; npm workspaces: root + `shared/` + `server/` + `client/` (+ existing `vendor/`). Base `tsconfig` with `allowImportingTsExtensions`, strict mode. Client: Vite 7 + three@0.185 + colyseus.js 0.17. Server: @colyseus/core 0.17 + tsx watch. Scripts: `dev` (both), `build`, `test` (vitest over vendored tests — free green suite).
- `shared/constants.ts` seeded with every tuning number the docs deferred (tick = survivors×5s, disc radius 15%, duel capacity 15s, pause timings, wind curve placeholders).
- Client skeleton: renderer (DPR capped 1.5), single rAF loop driving vendored `Time` (fixed 60Hz + alpha), pointer-lock via `vendor/arc/platform`.
- **Style kit against a graybox** (art_direction §11): canvas texture kit (gouache tile, stroke-break texture, tick/hatch decals), 2-step toon ramp + hemisphere/directional rig, sketch inverted-hull outline material factory, painted sky dome (teal + cloud masses), fullscreen grain quad.
- **Done when:** a gray box-stack on a gray disc, on the hosted sky, reads as a drawing; server room echoes a join. **Cut line:** if the style kit stalls past ~3h, ship flat toon + plain hull and revisit in M5 — never let shaders block gameplay.

## M1 — Offline arena sandbox: the fun test (~8h)

**Goal:** one player, one hexagon, one ball — prove the header feels great before any networking exists.

- `shared/physics/`: fixed-step arcade physics on vendored `vec3` — ball sphere (gravity, restitution, speed cap) vs floor/polygon wall segments/cylinder posts/AABB platforms; player capsule vs same; three-free, Node-safe.
- `shared/arena/`: the five polygon definitions, wedge sector math, `footprintZone(ballPos, survivors)` lookup, neutral disc, parametric interior placement (platforms/pillars at radius fractions per shape).
- Player: WASD camera-relative movement + jump; third-person chase cam (yaw from pointer-lock mouse, soft follow); `matrixAutoUpdate=false` discipline.
- **Header:** jump + ball proximity/contact window → strong impulse along facing (+ slight up); ground body contact = weak nudge. Tune `HEADER_POWER`, contact window, ball liveliness *here, until it's fun*.
- Bean builder: merged voxel-box clusters (~6 parts), code-driven anims (idle bob, flaily run, tucked jump, header snap); ball with squash-stretch + footprint blob marker.
- Local match loop against 5 static dummy wedges: danger meters HUD (plain bars), tick countdown, guaranteed elimination, arena morph (hard swap) hexagon→…→circle.
- **Done when:** chasing and heading the ball around a morphing arena is *fun with nothing at stake*. This is a hard gate — tune before proceeding. **Cut line:** platforms/pillars can slip to M5; walls + wind + disc are enough to test feel.

## M2 — Netcode core (~8h)

**Goal:** the sandbox becomes server-authoritative with 2+ real clients; deployed to real URLs (day-1 deploy rule).

- `server/rooms/MatchRoom.ts`: 60Hz sim via vendored `Time` (injected clock), schema (`MatchState`/`PlayerState`/`BallState`), 20Hz patches, room-code join, `allowReconnection(20)` wired to the grace-period rules.
- Input pipeline: vendored messages + capture + latched-edge mapper, **add sequence numbers**; client prediction for local player, server echoes last-processed seq, rewind-replay through shared movement sim, residual error smoothed ~100ms.
- Remote entities: snapshot interpolation buffer (~120ms) blended by `Time.alpha` (ARC technique, our buffers).
- **Ball:** client-local 60Hz sim + per-patch server correction blend (gentle/firm/snap tiers, position *and* velocity); client-detected header applies impulse frame-0 + sends event; server validates (tolerance + cooldown) and applies authoritatively. Meters/ticks judge **server ball only**.
- Artificial-latency toggle (dev): 100ms + jitter, to keep honesty about feel.
- **Deploy now:** Render free (Singapore) + UptimeRobot ping; Netlify client; verify wss/CORS on real domains. *(Needs from user: GitHub/Render/Netlify accounts.)*
- **Done when:** two tabs (one latency-throttled) chase and contest the ball smoothly; ticks resolve identically on both. **Cut line:** if rewind-replay misbehaves by end of milestone, ship snap+lerp reconciliation (decision rule from architecture.md) and move on.

## M3 — Match state machine: the vertical slice (~8h)

**Goal:** a complete match, start to winner, with every kickoff beat — this milestone is the shippable minimum game.

- Server phase modules (transitions only here): `LOBBY → DRAFT → LAUNCH → ARENA → RESTART(±HALFTIME) → DUEL → END`.
- Lobby: room code display, join/ready, host start, bot-fill placeholder slots (bots dumb-idle until M7).
- Draft: simultaneous private 25s timer, 3 pools × 3 offers (stub cards OK), auto-pick on timeout, public reveal at launch.
- Cannon launch: aim-arc input during countdown, synchronized volley, scripted parabola, landing puff.
- Tick resolution: interval accrual (server), elimination beat (slow-mo zoom), meters reset; tie → overtime micro-round (ball re-center, only tied zones live, first accrual loses).
- Restart Kickoff: handout generation (uniform random), eliminated player's 8s targeting UI, timeout rule (curse→leader, advantage→random), public reveal, arena morph + relaunch.
- Halftime (survivors hit 3): wedge reshuffle, card-swap offer, interior re-roll, **light-arc lerp to sunset**.
- Sudden Kickoff: circle split, duel meters (no timer), dusk + lantern fade-in; final elimination's cards persist all duel.
- Eliminated players → spectator clouds, 4 emotes (white speech-bubble sprites); winner ceremony + one-tap rematch.
- Disconnect: grace window (idle body physical, meter accrues), off-tick restart on expiry via timeout handout rule.
- **Done when:** 3 tabs play a full match with all phases; a 2-tab match goes straight to the duel. **Cut line:** halftime card-swap UI (keep reshuffle + light lerp); emotes.

## M4 — Cards, modifiers & jerseys (~6h)

**Goal:** the draft matters and the beans wear real kits.

- `ModifierStack` in shared: base × active multipliers, queried by movement/meter/cooldown/wedge-width code; expiry at restart events.
- All 6 mirrored restart pairs (one modifier system, two signs) + Magnet Curse (ball force bias) + Bodyguard (auto-punt).
- Starter draft set, in priority order: **commons first** (Dash, Shove, Ball Stop / Speed Anklet, Spring Boots, Bumper Shell / Slim Wedge, Padded Meter, Quick Reload), then rares (Free Save, Hard Hat, Shield Bubble, Grapple Hook, Magnetic Boots, Crystal Ball), then epics (Tractor Beam, Moon Suit, Comeback Engine). Each = data entry + (for actives) small server handler + client VFX hook.
- Jersey system: `shared/cosmetics/jerseys.ts` schema (name, colors, pattern, home/away), kit-clash rule server-side, `jerseyPainter` canvas kit textures (solid/stripes/hoops/halves/sash), lobby team picker (fallback set of 8 kits), identity colors (wedge/meter/HUD) from kit primary; persist name+team via vendored save store.
- **Done when:** two different drafts play differently; a curse on the leader visibly lands; six distinct kits read at a glance (clash rule verified). **Cut line:** epics (Tractor Beam last); jersey patterns beyond solid/stripes/hoops.

## M5 — Art & world pass (~8h)

**Goal:** the target screenshots. The style kit exists (M0) — this is content through it.

- Floating island: pitch (muted, tick/pebble decals, art-directed shadow shapes), rock underside, festival fencing walls + bunting + fake-glyph banners, cannons (festival mortars).
- Interior props styled (cloud-puff platforms, wooden poles, painted bumpers); per-shape placement dressed.
- Sky: near 3D clouds + spectator clouds; distant island silhouettes; full light-arc keyframes (afternoon/sunset/dusk) + lanterns.
- Beans: face-plate expression swaps (idle/panic/joy), jersey render polish, contact-darkening under all props.
- HUD skin: brush-stroke meters, paper/ink card frames, fonts (Baloo 2 + Patrick Hand via Fontsource), screen-edge ball indicator, wedge-alarm vignette, tick timer.
- **Readability audit at 6 players** — saturation rationing check per art_direction §10.
- **Done when:** a cold screenshot could be mistaken for the reference's cousin; all six kits + ball pop from the neutral world. **Cut line:** distant islands, line boil, banner glyphs.

## M6 — Juice & audio (~5h)

**Goal:** impacts you can feel with your eyes closed and your ears off — then both on.

- Hitstop (~70ms) on header connect; camera punch + shake scaled by impulse; ball ink-streak trail; landing dust; jump anticipation frames; elimination poof + spirit-float; card unfurl reveals; confetti (all pooled).
- Audio: force→(volume, playbackRate) mapping over the vendored WebAudio backend; `toneClip` placeholders wired first, then CC0 replacement pass (~10 SFX: header ×2, bounce, launch, tick warn, elimination, card, whistle, crowd, UI) + one lo-fi loop; autoplay unlock; tab-visibility mute.
- **Done when:** one header in isolation feels *satisfying*; halftime whistle + sunset land as a moment. **Cut line:** music loop before SFX; never cut the header sound.

## M7 — Bots, hardening & submission (~6h)

**Goal:** a solo judge at an idle booth gets a full experience.

- Bot FSM: roam → chase-if-ball-in-my-wedge → header-clear; random valid drafts + timeout handouts (already free); host bot-fill.
- Edge-case sweep: overtime, exact ties, off-tick eliminations, mid-phase disconnects, rematch state reset, empty-room teardown.
- Performance audit: draw-call count vs 150 budget, zero per-frame allocations (heap snapshot), 6-player+bots stress, low-end laptop check.
- Submission: itch.io zip + page (GIF, screenshots, controls, team-kit credit line), README, LAN fallback rehearsal (server on laptop over local IP once).
- **Done when:** hosted URL → lobby → 1 human + 5 bots → full match → rematch, no dev tools open. **Cut line:** bot header *aiming* (random-direction clears are acceptable).

## M8 — Buffer & stretch (whatever remains)

Playtest-driven balance (constants only) → remaining epics/rares → line boil → arena morph tween → extra kits → victory ceremony polish → spectate-cloud camera angles. Nothing here is load-bearing.

---

## Global cut ladder (invoke top-down when behind)

line boil → lanterns → distant islands → face expression swaps → Crystal Ball → morph tween → halftime interior re-roll (keep the light lerp) → spectator emotes → save persistence → epic cards → jersey patterns beyond solid/stripes → **floor: end of M3 + fallback kits + commons-only cards is a submittable game.**

## Risks & tripwires

- **Header feel fails at M1** → tune contact window/impulse curves before touching netcode; this gate exists so netcode never hides a feel problem.
- **Reconciliation bugs eat M2** → snap+lerp fallback, decided at milestone end, not extended.
- **Ball corrections look rubber-bandy** → stiffen blend constants toward server-lean (tunable, never re-architect).
- **Render cold start at judging** → UptimeRobot + booth tab; worst case LAN fallback (rehearsed in M7).
- **Style kit rabbit-hole (M0) or art pass overrun (M5)** → both time-boxed; gameplay milestones never wait on art.

## Verification per milestone

Vendored tests stay green (`npm test`). Each milestone's **Done when** is the acceptance test, executed live: M1 solo feel-check, M2 two tabs + latency throttle, M3 three-tab full match, M4 draft-difference check + clash check, M5 screenshot + readability audit, M6 eyes-closed header, M7 hosted solo-vs-bots run.
