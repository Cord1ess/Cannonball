# Cannonball — Technical Architecture Plan

> Companion to `idea.md` (the settled design) and `art_direction.md` (the visual target). This document commits to one answer per technical decision for a **solo developer, ~48–72h jam, browser target**. No implementation code exists yet; nothing is built until this plan is confirmed.
>
> **Stack commitment up front:** TypeScript 5.x everywhere · `three@0.185.x` (WebGLRenderer) · Colyseus `0.17.x` (Node 22 LTS server) · Vite 7 client build · hand-rolled shared arcade physics (real gravity/impulses/bounces — no third-party engine) · Railway (Singapore region) for the server, Netlify/itch.io for the client.

---

## 1. Performance

**Decision: three.js 0.185.x with the plain `WebGLRenderer`, one hemisphere + one directional light, zero shadow maps (art-directed shadow decals + blob shadows instead), `MeshToonMaterial` with a subtle high-key 2-step ramp, stroke-textured inverted-hull sketch outlines, and a kit of canvas-generated textures (gouache tiles, seam linework, tick decals — per `art_direction.md`), a <150 draw-call budget enforced by merged geometry and pre-built arena shells, pooled instanced particles, and a single fixed-timestep (60Hz) loop with allocation-free per-frame code.**

Justification: this scene is small — 6 blocky bean characters of ~6 merged voxel-cluster parts each, one ball, ~6 interior props, walls, sky, HUD — so the danger is not triangle count, it's death by a thousand cuts: draw-call creep from outline hulls, GC hitches from particles, and shadow-map cost across a big scene. The hand-drawn anime-background style is exactly the style that needs none of the expensive features: a subtle toon ramp is *cheaper* than PBR, high-key flat lighting means no shadow maps by definition (shadows are placed decal shapes), and the sketch outline is per-object inverted-hull geometry with a stroke-break texture rather than a full-screen edge pass. The whole look ships on two shared material families (gouache-modulated toon + stroke ink) plus a small kit of textures generated on a canvas at load — zero authored assets, entire frame budget left for gameplay. WebGPU (viable in 2026) buys nothing at this scale and adds compatibility risk on unknown judge laptops — WebGL runs everywhere, full stop.

Concrete techniques, committed:

- **Characters:** each bean is a hierarchy of ~6 animated parts — body, two arms, two feet, face plate — where every part is a **merged voxel-box cluster**: its stack of boxes is merged into a single `BufferGeometry` **once at build time** (never per frame), so a visually complex stepped silhouette still costs one draw call per part. Add one team-tinted toon material and one inverted-hull ink shell per part: ~80 draw calls for all six characters with outlines — the reason the budget is 150, and still trivial for WebGL; do not over-engineer instancing here. Animation is code-driven (sine + easing writing `rotation.x/z` on part groups) — no `AnimationMixer`, no GLTF, no skinning. The face plate swaps between three pixel-expression textures. The body cluster carries simple planar UVs so a canvas-generated **jersey texture** (stripes/hoops/halves/sash from the player's chosen team kit in `shared/cosmetics`) wraps the stepped silhouette — one texture per player, generated once at lobby time.
- **Sky & spectators:** the stadium crowd is gone (see `art_direction.md`) — the environment is a painted sky dome (flat teal + canvas-generated cloud masses; the cloud mask is fixed and only its palette lerps across the day→dusk arc), a handful of merged blobby cloud meshes, and up to five drifting **spectator clouds** carrying eliminated players' existing character rigs. The art pivot made the environment *cheaper*: no instanced crowd system needed. Dusk lanterns are one small instanced emissive-toon mesh; ground shadow shapes and hatch/tick marks are pooled decal quads placed once per morph, not per frame.
- **Arena:** all five polygon shells (hexagon → circle) are **pre-built and merged at load** (`BufferGeometryUtils.mergeGeometries`) into one mesh each — outline hull included — and toggled by visibility on morph. Never construct or dispose geometry mid-match.
- **Particles & popups:** pre-allocated `InstancedMesh` pools per effect type (launch trails, header impacts, confetti, card popups) with fixed max counts and recycled indices. Nothing visual is ever `new`-ed during play.
- **GC avoidance:** module-scope scratch `Vector3`/`Quaternion` objects reused in all math; no `.clone()`, no array spreads, no closures created inside the frame loop; HUD meters update by scaling a unit-quad transform, never rebuilding geometry.
- **Loop discipline:** one `requestAnimationFrame`; simulation advances on a fixed 60Hz accumulator (capped to avoid spiral-of-death after tab-switch); rendering interpolates. `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`.

**What NOT to do (three.js mistakes that would hurt this game specifically):**

1. Don't allocate in the render loop — per-frame `new Vector3()` in 6 characters' animation code is the #1 source of GC frame spikes in exactly this kind of game.
2. Don't use `MeshStandardMaterial` + real-time shadow maps across the scene — PBR and a big shadow frustum buy nothing for a cel-shaded look, and one PBR surface breaks the hand-drawn illusion anyway. Blob shadows are cheaper *and better for gameplay*: the ball's blob doubles as its **floor-footprint marker**, which the tick rules require players to read anyway.
3. Don't clone a material per mesh to recolor players — cloning per-part multiplies GPU state changes. Six shared team-tinted toon materials (one per player) + the one shared ink material is the full material inventory for characters.
4. Don't rebuild arena geometry on each morph without disposing the old — that's a VRAM leak that kills the demo on match three. (Solved structurally: pre-build all five, toggle visibility.)
5. Don't reach for post-processing (bloom/AO via EffectComposer or the new r183 RenderPipeline) — **including the tempting `OutlinePass`/Sobel edge pass**. The ink outline is inverted-hull geometry, not a full-screen pipeline on unknown hardware.
6. Don't animate with a tween library spawning tween objects per particle/effect — drive everything from `t = serverTime` math.
7. Don't ship uncapped `devicePixelRatio` — a 2x-display laptop with integrated graphics renders 4× the pixels and silently halves the frame rate.
8. Don't leave `console.log` in the fixed-step or render path — string formatting at 60Hz is a real cost in Chrome.

---

## 2. Networking

**Decision: Colyseus `0.17.x` (`@colyseus/core` + `@colyseus/schema` on Node 22, with the matching `@colyseus/sdk` 0.17 client — note: the old `colyseus.js` package is capped at 0.16 and protocol-incompatible). Fully server-authoritative: the server runs the entire simulation at a fixed 60Hz and broadcasts schema delta patches at 20Hz. Local player movement uses client-side prediction with input-sequence reconciliation; the ball is simulated locally on every client and continuously blended toward server truth, so your impacts respond on the same frame you swing; everything consequential is a discrete server-resolved event.**

Justification: Colyseus is the only option on the table that is *purpose-built* as an authoritative game-room server for Node/TypeScript, which means the jam clock is spent on the game, not on infrastructure. Against the alternatives — **PartyKit/Cloudflare** is a general realtime platform: no schema delta sync, no interpolation conveniences, and a Durable-Object CPU model that's awkward for a continuous 60Hz physics loop. **Socket.IO or raw WebSockets** means hand-rolling state serialization, delta compression, room lifecycle, and reconnection — days of invisible work. **Playroom Kit** is fast but host/client-authoritative, which violates the fairness requirement outright. **Nakama/Photon** are heavyweight infra for a 6-player jam game. Colyseus also gives three features that map 1:1 onto the settled design for free: room-code lobbies (`joinById`), **`allowReconnection(client, 20)` which literally implements the 20-second disconnect grace period from idea.md §5**, and per-client state patching.

Authority split, committed:

| Continuous (schema state, 20Hz patches, interpolated) | Discrete (messages, resolved once on server) |
|---|---|
| Player positions/velocity/facing + anim flags | Lobby team/kit picks (clash resolved server-side); draft offers, picks, locks |
| Ball position/velocity | Cannon aim + synchronized fire event |
| Danger meters (f32 seconds, server-computed) | Ability activation (client *requests*; server validates cooldown, applies) |
| Tick countdown (via synced `serverTime`) | Header impulse (server detects contact, applies force) |
| Wind phase/seed | Tick result + elimination |
| — (platforms are `f(serverTime)` from shared code: zero bandwidth, zero drift) | Handout generation, targeting, public reveal |
| | Phase transitions, arena morphs, emotes |

- **Local player prediction + reconciliation:** the client simulates its own movement immediately using the *same shared TypeScript movement module the server runs*, tagging each input with a sequence number. The server echoes the last-processed sequence + authoritative position; the client rewinds and replays unacknowledged inputs, then smooths any residual error over ~100ms so corrections never visibly snap. This is feasible in jam time precisely because the sim code is shared, not duplicated.
- **Ball feel — local simulation, server-corrected:** every client runs the shared ball physics locally at 60Hz, every frame. When you header or bump the ball, the client detects the contact itself and **applies the impulse locally on that exact frame** — you feel the force you applied instantly — while simultaneously sending the hit event for the server to validate (position tolerance + cooldown) and apply authoritatively. Each 20Hz patch, the client measures error between its local ball and the server ball and blends it out: small error → gentle nudge (~10%/frame), moderate → firm exponential blend (position *and* velocity), beyond a teleport threshold → snap. When *another* player hits the ball, your local sim learns ~RTT late and the blend absorbs the difference — at festival/LAN ping (<30–60ms) corrections stay under the perceptual threshold. What is explicitly out of scope is full Rocket-League rollback netcode (deterministic resimulation of all inputs); the blend approach is ~10% of that work for most of the feel.
- **Tick fairness:** the locally simulated ball is **presentation only** — ball-time accrual is computed exclusively on the server's fixed-step simulation from the authoritative ball footprint; ticks fire on the server clock; clients render the countdown from a `serverTime` offset estimate. No client-reported timing or client ball position is ever used in judgment, so a laggy or hacked client can neither gain nor lose meter time — latency affects only how fast their *inputs* arrive, which is equalized at a co-located festival. Ties are declared server-side when meters differ by < 0.05s (float-safe epsilon for the idea.md overtime rule).

---

## 3. Simplicity — the 80/20 versions

**Decision: no *third-party* physics engine — the physics is real, but hand-rolled. A custom shared "arcade physics" module (~300–500 lines) simulates the whole game: gravity, impulses, restitution, sphere-vs-wall-segment/plane/cylinder/AABB for the ball, capsule-vs-same for players. Network at 20Hz patches over a 60Hz sim — never sync at sim rate.**

Justification: the game has exactly one ball and a handful of primitive colliders. Integrating Rapier/cannon-es on *both* client and server, keeping versions consistent, and marshaling engine state into schema patches costs more than writing sphere math you fully understand at 3am. But the deeper reason is **feel**: a general-purpose engine gives physically-*correct* responses, and arcade games fight it to get physically-*fun* ones. Hand-rolled physics makes every feel-critical value a directly tunable constant — header impulse curves, exaggerated restitution, a gravity scale that makes the ball hang at the top of its arc, speed caps that keep play readable. (Rocket League itself ships heavily gamed physics parameters, not realistic ones.) And because the module is shared TypeScript, the same code drives server authority, player prediction, and the frame-0 local ball response from §2 — one sim, three jobs.

**Simplest-viable versions of everything above:**

- **Reconciliation fallback:** if input-replay reconciliation misbehaves under deadline, degrade to "accept server position + lerp toward it" — acceptable at LAN ping. Decide by end of day 1, don't polish it mid-jam.
- **Arena morph animation** → *flagged: disproportionate cost.* Do not vertex-tween walls between polygons. Hard-swap the pre-built shells behind the restart pause's camera flash + confetti burst. Nobody will miss the tween; build it only if the game is done early.
- **Per-shape interior layouts** → *flagged.* Don't hand-design five arrangements. One parametric rule — platforms and pillars placed at fixed radius fractions, rotated to shape symmetry — gives five sane layouts for the price of one, and Halftime's "re-roll" is a reseed.
- **Cards** → the mirrored-pair insight from idea.md §3 is the implementation: one `ModifierStack` (base value × product of active multipliers) that movement, meters, and cooldowns query. ~80% of all cards are pure data entries; only epics/abilities get bespoke handlers. Rebalancing never touches system code.
- **Crystal Ball trajectory line** → *flagged: first card to cut.* If kept: re-simulate 60 steps of shared ball physics every 100ms into a pre-allocated line buffer — never per frame, never allocating.
- **Cannon launch** → scripted parabola with an aim-angle parameter. Not physics.
- **Halftime dressing** → lerp the light rig + sky-dome gradient along the day→sunset→dusk arc from `art_direction.md` (lanterns fade in for the duel). No asset swaps.
- **Bots** → last build priority, per idea.md. A 3-state FSM (roam / chase-ball-if-in-my-wedge / header-clear); draft picks and handouts already resolve via the timeout rules, so bots get those behaviors free.
- **Emotes/spectating** → sprite popups over the drifting spectator clouds, reusing the existing character rig seated on a cloud puff. No new character systems.

**The single biggest scope trap, named:** escalating from §2's local-sim-plus-blend into full rollback netcode (deterministic resimulation of every player's inputs on every correction, Rocket League-style). The blend version ships the feel — your own impacts are frame-0, which is what a player actually perceives as "the force I apply." If double-hit conflicts ever look rubber-bandy at the venue, the escape hatch is a *constant*, not a rewrite: stiffen the correction blend for a more server-leaning ball. Tune it, don't re-architect it.

**Where the feel actually comes from (cheap, committed, and none of it is netcode):**

- **Hitstop:** ~60–80ms freeze on every header connect — the single highest feel-per-line-of-code technique in games.
- **Camera punch + shake** scaled by impulse strength; a header that rockets the ball should kick the camera.
- **Ball squash-and-stretch** on impacts and bounces, plus a motion trail at high speed.
- **Character squash on jump/land** with landing dust from the particle pool.
- **Force-scaled audio:** impact SFX volume/pitch driven by impulse magnitude — weak nudges thud, clean headers *crack*.
- **Anticipation frames** on the jump (2–3 frames of crouch) so jumps feel weighty, not floaty.

All of it is code-driven easing on pooled objects — the §1 "no tween library" rule bans per-frame tween-object *allocation*, not easing itself, which is everywhere. This list is a day-2 afternoon of work and is where "I want to feel it" gets delivered; it is deliberately in-scope, not stretch.

---

## 4. Robust Architecture

**Decision: one repo, npm workspaces, three packages — `shared/` (simulation + data, runs on both sides), `server/` (Colyseus room), `client/` (Vite 7 + three.js). The server owns an explicit match state machine; cards and tuning are data files in `shared/`; the client's net layer feeds an event bus that rendering and UI subscribe to.**

```
cannonball/
├── vendor/arc/                 # audited utilities lifted from the ARC Engine side-project
│                               #   (Time, Random, vec3/quat, input, platform, audio, debug-draw
│                               #   — see vendor/arc/README.md for provenance + adaptation notes)
├── shared/                     # runs on BOTH client & server — the heart
│   ├── constants.ts            # every tuning number idea.md deferred: tick = count×5s,
│   │                           #   wind curve, disc radius, duel meter capacity, cooldowns
│   ├── types.ts                # ids, enums, message payload types
│   ├── physics/                # ~300-line arcade physics (ball, capsules, colliders, fixed step)
│   ├── arena/                  # polygon definitions, wedge geometry, footprint→zone lookup,
│   │                           #   parametric interior placement, platform f(serverTime) paths
│   ├── cards/                  # definitions.ts (data: pools, rarities, modifier deltas)
│   │                           #   + effect registry keyed by card id for bespoke effects
│   ├── cosmetics/              # jerseys.ts — team kit data (name, colors, pattern, home/away)
│   │                           #   + kit-clash resolution rule; purely cosmetic, no gameplay reads
│   └── match/                  # phase enums, tick/meter/tie rules as pure functions
├── server/
│   ├── rooms/MatchRoom.ts      # Colyseus room: owns the phase state machine, 60Hz sim loop
│   ├── schema/                 # @colyseus/schema: MatchState, PlayerState, BallState
│   ├── phases/                 # lobby / draft / launch / arena / restart / halftime / duel / end
│   │                           #   each with onEnter, onExit, update(dt) — transitions ONLY here
│   └── systems/                # draft.ts, tickJudge.ts, handout.ts, bots.ts
└── client/
    ├── net/                    # connection, prediction+reconciliation, interpolation buffers,
    │                           #   schema→eventBus adapter (the ONLY module that knows Colyseus)
    ├── game/                   # input capture (pointer-lock mouse look, WASD), local sim
    │                           #   wrapper, third-person chase camera rig
    ├── render/                 # scene, materials (toon ramp + ink hull factory), jerseyPainter
    │                           #   (canvas kit textures from shared/cosmetics data), characterRig,
    │                           #   characterAnim, arenaView, ballView, skyView (dome, clouds,
    │                           #   spectator clouds, lanterns), fx/ (pools)
    ├── ui/                     # HUD meters/timer, draft screen, handout screen, lobby, victory
    └── main.ts
```

**Vendored foundation:** `vendor/arc/` holds tested, dependency-free utilities lifted from the developer's own ARC Engine project rather than rewritten: the `Time` fixed-timestep accumulator (injected clock + render-interpolation `alpha` — becomes both the client loop and the server room loop), seeded `Random` with state snapshots (wind/draft/handout determinism), three-free `vec3`/`quat` (the math core of `shared/physics`), latched-edge input buffering + pointer-lock capture (sequence numbers get added for prediction), the WebAudio backend whose `volume`/`playbackRate` knobs are the force-scaled SFX seam (+ autoplay unlock), visibility/fullscreen/pointer-lock helpers, an IndexedDB save store (persist name + chosen team), a debug line-draw accumulator, and a procedural tone generator for placeholder SFX. ARC's frameworks (ECS, render seam, document sync, Rapier) were audited and deliberately left behind — they are the abstractions this plan rejects.

Justification: the separations follow the game's fault lines. **Phases** are the design's spine (idea.md §2), so they're an explicit server-side state machine — message handlers only delegate; no phase logic hides in callbacks, which is what prevents the classic jam bug of a restart firing during a draft. **Cards/obstacles/timing rebalancing never touches systems**: every number lives in `shared/constants.ts` or `shared/cards/definitions.ts`, so a balance pass during Friday-night playtesting is a data-file edit. The jersey skin system follows the identical pattern — every team kit is one data entry in `shared/cosmetics/jerseys.ts` rendered by one canvas painter, so the "search up real jerseys and match them individually" pass is pure data entry, no code. **`shared/` is the load-bearing wall**: physics, arena math, and rules written once are what make server authority and client prediction the same code instead of two divergent implementations — most desync bugs die here by construction. The client `net/` layer is the only Colyseus-aware module and emits plain events, so rendering and UI stay engine-pure and testable.

**Deployment (assumptions stated):**

- **Server:** Render **free tier**, **Singapore region** — nearest region to the Dhaka venue (~30–60ms), push-to-deploy from GitHub, WebSockets and TLS (`wss://`) out of the box, $0. Trade-off accepted (user decision): free instances sleep after idle, so mitigate with a free UptimeRobot ping every ~10 minutes during playtest/judging days, and keep a browser tab connected at the booth. If a cold start (~30–60s) ever bites at the worst moment, the LAN fallback below is the escape hatch. Still must be **deployed on day 1, not the last hour** — TLS/CORS/wss issues only surface once real clients hit a real domain.
- **Client:** static Vite build on Netlify free tier; the same build zipped for itch.io if the jam requires an upload (itch iframes can open external `wss://` connections fine).
- **LAN fallback:** if venue Wi-Fi is hostile, the same server runs on the dev laptop and clients connect over local IP — with Colyseus that's a one-line endpoint change, and it should be rehearsed once before judging day.
- **Other assumptions:** desktop browser + keyboard/mouse only (mobile out of scope); max one 6-player room per demo (a single small instance handles several rooms regardless); no accounts, no database, no persistence — rooms are in-memory and die with the match.

---

*Awaiting confirmation. No implementation code until this plan is approved.*
