# Cannonball — Art Direction

> Companion to `idea.md` (design) and `architecture.md` (tech). This document supersedes the voxel/Minecraft style notes in `initial_idea.md`.
>
> **North star: replicate the look of [messenger.abeto.co](https://messenger.abeto.co/)** — a walkable anime background painting. Matte gouache surfaces with visible paint variation (never flat vector fills), sketch-quality broken ink linework with interior detail and hatching (never uniform borders), high-key flat lighting with art-directed shadow shapes, a muted warm-neutral world under a flat teal sky with painterly cloud masses, and strategic saturated accents. Warm, nostalgic, Ghibli-adjacent slice-of-life — hosting a frantic party game.
>
> **Production constraint:** solo dev, 48–72h, **no Blender pipeline, no hand-painting sessions.** All geometry is code-assembled; **all textures are canvas-generated at load** (gouache tiles, stroke textures, tick decals, seam linework, fake-glyph signs) — the hand-painted look, authored procedurally.

---

## 1. Tone: cozy world, chaotic play

The style says slice-of-life calm; the game is a frantic elimination royale. That contrast **is** the charm: a serene painted world, drifting clouds, warm light — and six panicked blocky beans scrambling under a ball. Play the world absolutely straight (soft, warm, unhurried) and let all franticness live in the characters, the ball, and the VFX. Never make the *environment* loud.

## 2. The five traits that make it "Abeto," and how each is faked cheaply

These are the non-negotiables. If any one is missing, the result degrades into generic toon-shading — the exact "flat pastels and borders" outcome to avoid.

### 2.1 Painted fills — no surface is flat

- One shared tileable **gouache blotch texture** (canvas-generated: layered soft irregular blobs at low contrast) multiplied over every material's base color at low amplitude. Every wall, floor, and prop gets quiet value wobble inside its color field.
- The existing fullscreen paper-grain quad stays on top. Together: paint below, paper above.

### 2.2 Sketch linework — broken, varied, alive

- **Silhouettes:** inverted-hull outlines, upgraded — per-vertex width jitter *plus* a **stroke alpha texture** along the hull so lines gap and break like pen strokes. Ink is warm dark gray-brown `#4A443C`, never black. Line weight hierarchy: characters/ball > props > arena.
- **Interior lines:** seams, planks, panel edges, window frames are *drawn into the canvas textures* of surfaces — the drawing lives inside faces, not just around them.
- **Hatch ticks & scatter marks:** small pooled decal quads (canvas-drawn dashes, ticks, scribbles, pebbles) scattered along wall bases, prop corners, and across the pitch. This is the single most identifying Abeto trait and costs almost nothing.
- **Line boil:** hull noise re-seeds ~8×/sec so lines shimmer like a hand-drawn animation. *(cuttable polish)*

### 2.3 High-key flat lighting — value is designed, not simulated

- `MeshToonMaterial` with a **subtle 2-step ramp** (lit/shade, small value gap) — banding should whisper, not shout. The directional light exists only to pick which faces sit in the shade step.
- **Per-face value blocking** baked as vertex-color offsets on architectural shapes (walls, posts, cannons): sun-side faces a touch lighter, shade-side a touch darker — the anime-background trick that replaces real lighting.
- **No shadow maps, ever.** Instead: large hard-edged **shadow-shape polygons** (cool-tinted flat decals, art-directed placement) on the pitch, **contact-darkening bands** at the base of walls and props, and blob shadows under dynamic objects (the ball's blob doubles as its gameplay footprint marker).

### 2.4 The color script — neutral world, rationed saturation

- The world is **muted warm neutrals** (creams, warm grays, green-grays) under a **teal sky**. Saturation is *rationed*: only gameplay-critical or charming objects get saturated color — and the six team beans + ball are the most saturated things in the scene. Readability by art direction.

### 2.5 The painted sky

- A sky dome textured with **flat teal + big hand-cut lighter cloud masses** (canvas-generated irregular blobs — NOT a smooth gradient, NOT fluffy 3D geometry for the distant sky). The cloud mask stays constant; its colors lerp across the light arc (§7).
- Near the arena: a few 3D blobby clouds (spectator clouds included), toon-flat with painted edges, so the near/far cloud language matches.

## 3. Palette (starter swatches — tune on the graybox)

- **Sky:** teal `#7DCDC2` · cloud masses `#C6EADD`
- **World neutrals:** ground cream `#E6E1D3` · warm gray `#D9D4C7` · green-gray `#CBD0C2` · off-white `#EFEBE0`
- **Shadow shapes:** cool gray `#C2BEB8` (tinting toward violet-gray `#B3A3B8` at sunset)
- **Ink:** `#4A443C`
- **Team accents (saturated, rationed — the "red postbox" role):** derived from each player's chosen jersey (§4). The default/fallback kit set (bots, quick play, clash-safe): red `#D6453D` · blue `#4FA3D8` · yellow `#EFB53C` · green `#58AE7C` · violet `#9678C8` · orange `#E98A2B`
- **Ball:** warm cream `#F5F0E2` with ink-drawn patches · **UI accent:** gold `#F2C078`, danger rose `#D96C6C`

## 4. Characters: blocky beans (Fall Guys proportions, Minecraft construction)

- **Silhouette:** the Fall Guys bean — one tall body-head mass with no neck, slightly wider at the hips, stubby arms, two block feet — built **entirely from hard-edged voxel boxes** with a stepped, pixelated silhouette. **No spheres, no capsules:** all "roundness" comes from stacking progressively wider/narrower boxes, per the bean reference image.
- **Build (~6 animated parts, each a merged voxel cluster):** body (one merged stack of boxes), two arms, two feet, and a flat **face plate** inset into the front — pale panel, simple black rectangular eyes.
- **Team identity — the jersey system:** each player picks a real football national team or club in the lobby, and the bean wears that team's kit: the jersey pattern (solid / stripes / hoops / halves / sash) is canvas-painted onto the body cluster, the shorts band takes the kit's shorts color, and the feet are the socks. Kits keep the "rationed saturation" role — the six jerseys are the most saturated objects in the scene. Colorways + names only, never crests or sponsor logos; kit clashes resolve to away kits (see idea.md §5). Pale cream face plate on everyone.
- **Faces:** the plate swaps three pixel-style expressions — idle / panic (ball in your wedge) / joy (clean header). *(default — flag if you'd rather one static face)*
- **Rendering:** beans get the same gouache-modulated toon fill and the heaviest sketch outline weight. Hard box edges + broken stroke lines = chunky stepped pen drawing.
- **Animation:** unchanged — code-driven sine/easing on part groups: bouncy idle, flaily sprint, tucked jump, whole-body header snap, panic flail. Rigid blocky parts on squashy timing is the Minecraft-meets-Fall-Guys energy.

## 5. The ball

Warm cream with **ink-drawn patch linework** (canvas texture, sketchy strokes), heaviest outline in the game, exaggerated squash-and-stretch, ink-streak motion trail at speed. The most-watched object gets the most drawing.

## 6. Environment: the floating dream arena

- **A floating colosseum** in the painted sky (user direction, M1 feedback): muted pitch on top (cream/sage, tick marks and pebble decals, art-directed shadow shapes), chunky hand-hewn rock underside, and **tall seamless ring walls — no seams, no gaps — with tiered audience seating on the crown**. Bunting flags and hand-painted banners dress the tiers; banner lettering uses **fake-glyph blocks** (canvas-drawn Japanese-ish letterforms, an Abeto signature).
- **Cannons sit on top of the colosseum wall edges**, one above each player's wedge — they fire the survivors in at every kickoff.
- **Audience slots:** eliminated players take seats in the colosseum tiers (replaces the earlier spectator-cloud idea), emoting from the stands.
- **Interior props, themed:** platforms as cloud puffs / floating earth chunks; wooden festival poles with bunting; round painted bumper posts. All get seam linework, contact-darkening, and a saturated accent detail or two (a red flag, a yellow stripe) in the rationed-color spirit.
- **Cannons:** stubby festival-mortar shapes — more fireworks-launcher than artillery.
- A few tiny distant islands as flat painted silhouettes. Nothing else — minimalist by mandate.

## 7. The light arc (day → sunset → dusk)

The match's emotional ramp is told by the sky. Three keyframes; everything lerps (sky-dome palette over the fixed cloud mask, hemisphere colors, shadow-shape tint, fog, grain tint):

| Phase | Sky / world | Feel |
|---|---|---|
| Draft → first half | teal `#7DCDC2`, clouds `#C6EADD`, cream ground, cool-gray shadows | lazy, nostalgic |
| **Halftime** → second half | apricot `#D98E63`, clouds `#F2C9A0`, warmed ground, violet-gray shadows | golden hour, rising stakes |
| **Sudden Kickoff duel** | deep teal-navy `#34506B`, clouds `#5F7D8C`, lantern gold `#F2C078` accents | blue hour, hushed, electric |

At dusk, **floating paper lanterns** fade in (one small instanced emissive mesh) as the duel's light accent. Victory: lantern glow + confetti against the night sky.

## 8. VFX language

Everything looks *drawn*: ink starbursts and white puffs on headers (scaled by force), cloud-ring poofs on launches and landings, curl-stroke wind lines, soft *poof* + spirit-float-to-cloud on elimination, paper cards that unfurl on reveals. Same pooled particle tech from `architecture.md` — only the sprites (canvas-drawn strokes and blobs) carry the style.

## 9. UI

Hand-drawn paper aesthetic: wobbly ink card frames, paper panels, danger meters as **brush-stroke bars** filling with paint, clean white speech-bubble callouts for emotes (pure flat white pops beautifully against the textured world — straight from the reference). Fonts (self-hosted via Fontsource): **Baloo 2** headers/numbers, **Patrick Hand** card text.

## 10. What NOT to do

1. **No flat vector fills** — every surface carries the gouache modulation. A flat fill anywhere reads as unfinished against the rest.
2. **No uniform, unbroken outlines** — that's the "borders" look. Width jitter + stroke breaks + interior linework or don't bother.
3. **No strong toon banding or dramatic directional light** — light is high-key and flat; drama comes from the palette arc, not contrast.
4. **No pastel-on-pastel** — the world is muted *neutral*, and saturation is rationed to teams, ball, and a few accents. If everything is colorful, nothing is.
5. No PBR, environment maps, HDRIs, photo textures, realistic skies — one realistic surface breaks the whole painting.
6. No post-processing outline pass (`OutlinePass`/Sobel) — sketch lines are hull geometry + textures, per `architecture.md`.

## 11. Production order (style-first, then content)

Build the style kit against a **graybox on day 1**: canvas texture kit — gouache tile, stroke texture, tick/hatch decals, fake-glyph blocks (~2h) · subtle toon ramp + light rig + vertex value blocking (~2h) · sketch-hull outline material (~2h) · painted sky dome + palette pass (~1.5h) · grain overlay (~30min). Once a gray box-stack on a gray disc looks like a drawing, every asset inherits the style for free. Then: bean rig (~3h), island + fencing + props + shadow shapes (~4h), VFX sprite pass (~3h), UI skin (~2h). If time collapses, cut in order: line boil → lanterns → distant islands → face expression swaps — **never** cut the gouache fills, stroke-broken lines, hatch decals, or the light arc: those four ARE the style.
