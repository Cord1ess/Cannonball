# vendor/arc — utilities lifted from ARC Engine

Copied 2026-07-17 from `D:\Web\ARC Engine` (the developer's own engine side-project; same author, no licensing concerns). These are the pieces that survived an audit against Cannonball's architecture — complete, tested, zero-external-dependency utilities. The engine's frameworks (ECS, render seam, document sync, Rapier bindings, editor server) were deliberately **not** taken: they are the abstractions `architecture.md` rejects.

**Build note:** files use explicit `.ts` import extensions (ARC convention). Vite/esbuild handle this natively; `tsconfig` needs `"allowImportingTsExtensions": true`.

## What's here and where it goes

| File | What it is | Destination / notes |
|---|---|---|
| `scheduler/time.ts` (+test) | Fixed-timestep accumulator: injected clock (never reads wall time), spiral-of-death clamp, `alpha` render-interpolation factor, `timeScale`. | The **client loop and the server room loop**. The single most load-bearing lift. |
| `scheduler/random.ts` (+test) | Seeded sfc32 PRNG with `getState()`/`setState()` snapshots. | `shared/` — deterministic wind, draft rolls, handout draws; state snapshot enables client resync of wind. |
| `math/types.ts`, `math/vec3.ts`, `math/quat.ts` | Three-free, allocation-free (out-param) vector/quaternion math, three-compatible conventions. | The math core of `shared/physics` (must run on Node without three.js). Client rendering still uses three's math. |
| `input/messages.ts` | Pure-data input message union (replayable/recordable). | `client/net` — **add an input sequence number field + wire encoding** for prediction/reconciliation at implementation time. |
| `input/capture.ts` | DOM→message capture; uses `movementX/Y` (pointer-lock ready). | `client/game/input`. |
| `input/input.ts` (+test) | Action/axis mapping with **latched edges** (sub-frame taps never lost). *Patched: ARC `SystemDef` hook removed.* | `client/game/input`. |
| `platform/visibility.ts` | Tab visibility hook (fires immediately with current state). | Client: pause local FX/audio on tab-switch (sim is server-side anyway). |
| `platform/unlock.ts` | One-shot gesture → WebAudio unlock. | Client boot, paired with `audio.resume()`. |
| `platform/fullscreen.ts` | Normalized fullscreen + **pointer lock** (boolean results, decline ≠ exception). | Client: the chase-cam pointer-lock lifecycle. |
| `platform/save-data.ts` (+test in platform.test.ts) | Typed async KV over IndexedDB (+memory impl). | Client: persist player name + chosen team between sessions. |
| `audio/backend.ts` | Handle-based audio contract — `play(clip, {volume, playbackRate, loop})`. | Client audio. The **force→(volume, pitch) mapping is ours to write** on top; backend just exposes the knobs. |
| `audio/webaudio-backend.ts` | Real WebAudio impl (per-sound gain → master gain). | Client audio. Allocates nodes per play (inherent to WebAudio) — throttle rapid impact SFX at the call site. |
| `audio/null-backend.ts`, `audio/contract.ts` (+test) | Node-safe backend with inspection counters + shared contract test suite. | Tests / server-safe imports. |
| `audio/tone-clip.ts` | Procedural PCM tone generator (extracted from ARC's platformer example). | Placeholder SFX from minute one — real CC0 assets replace clips, not code. |
| `debug/debug-draw.ts` | Immediate-mode line accumulator (geometric growth, zero steady-state allocation). *Patched: minimal `DebugLineSink` replaces ARC's RenderBackend.* | Dev-only overlay — wedge boundaries, physics shapes, server-vs-predicted positions. Back it with one `THREE.LineSegments` + `DynamicDrawUsage`. |

## Techniques noted from ARC but NOT copied (re-implement, don't port)

- **Prev/curr snapshot blending by `Time.alpha`** (ARC `render-core/extract.ts`) — the exact pattern for interpolating remote players/ball between Colyseus patches; rewrite against our own snapshot buffers.
- **`matrixAutoUpdate = false` + whole-matrix writes** (ARC three-backend) — adopt as discipline for all animated parts.
- The fixed-region drive loop shape inside ARC's `scheduler.tick()` — `Time` (lifted) + ~15 lines; the phase/topo-sort framework stays behind.
