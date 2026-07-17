# Cannonball — Established Design

> **What this document is.** The single source of truth for *settled* design decisions. Only material explicitly agreed on lives here. `initial_idea.md` remains the raw brain-dump reference and is never treated as final.
>
> **Ground rules.** Solo developer, ~48–72h jam (IUT ICT Fest 2026, theme: **Kickoff**). This document covers game design only — technical architecture, art, and audio are separate docs later. Sections are added one at a time as they are ironed out.

**Pitch:** A 2–6 player party battle royale where everyone defends a wedge of a circular arena from a shared ball. Keep the ball out of your zone; whoever hosts it the longest each interval is eliminated — and every elimination triggers a fresh kickoff.

---

## 1. Core Loop & Tick System — SETTLED

### Arena

- **One dynamic, walled arena whose shape IS the player count.** With N survivors the arena is a regular N-sided polygon: hexagon at 6, pentagon at 5, square at 4, triangle at 3, and a circle for the final duel. Every elimination morphs the arena to the next shape (during the restart pause), so the space itself broadcasts the state of the match.
- **Each survivor owns one wall.** Your zone (called your **wedge**) is the sector from the neutral center out to your wall side, and your cannon is mounted on your own wall. The morph at each restart is also the zone redraw.
- Neither players nor the ball can ever leave the arena — no falling, no out-of-bounds, no respawn system. Walls are part of play: banking the ball off them is a legitimate technique.
- At the exact center is a **neutral disc** that belongs to nobody. Ball-time spent over it counts for no one. The ball always resets here, so every kickoff starts fair and meters only move once the ball is genuinely pushed into someone's territory. (Disc size is a tuning value, not a design decision — start around 15% of arena radius.)
- **Setting:** the arena is a floating island drifting in a soft painted sky, ringed by slow clouds — a dreamlike festival pitch above the world (full visual spec in `art_direction.md`). Eliminated players watch from small spectator clouds circling the arena (Section 5).
- **Interior:** wind gusts, 2–3 moving platforms, and a handful of static bumpers/pillars keep the ball live and unpredictable. Each polygon shape has its own preset arrangement of these. Escalation behavior is defined in Section 4.

### Players & Movement

- **Free roam.** Any player can go anywhere in the arena at any time. Your wedge is not where you stand — it is the territory where ball-time counts *against you*. Offense means pushing the ball deep into someone else's wedge; defense means clearing it out of yours.
- Base moveset: run and jump. Everything beyond that comes from drafted cards.
- **Camera & controls:** third-person chase camera behind your bean with mouse look (pointer lock, Messenger-style). WASD moves relative to camera, Space jumps, one ability key. Headers fire along your facing.
- Because a chase cam can't watch the whole arena, the HUD compensates: a screen-edge ball indicator when the ball is off-screen, an always-visible danger-meter strip, and a loud visual + audio alarm the moment the ball enters your wedge. *(defaults — flag if you disagree)*
- Players physically collide and can nudge each other with body contact — light shoves only, no damage, no knockouts. Player contact can never eliminate anyone; only the tick does. *(default — flag if you disagree)*

### The Ball & the Header

- **One ball** in play at baseline. (Extra balls, if they ever exist, would be a card or escalation effect — decided in later sections.)
- The ball is a lively physics object: it rolls, bounces, and gets pushed around by wind, platforms, and players.
- **Body contact = weak nudge.** Running into or touching the ball moves it a little. You can herd it, but slowly.
- **Jumped header = the signature move.** Jumping and meeting the ball in the air (Fall Guys-style) delivers a **much stronger push**, directed roughly along your facing/movement at the moment of impact. Timing and positioning aerial headers is the core skill of the game — and keeps every player dangerous regardless of what they drafted.

### Zones, Ball-Time & the Danger Meter

- The ball's zone is determined by its **floor footprint**: its position projected straight down onto the arena floor. This rule applies always — airborne, on a moving platform, mid-bounce. One rule, no surprises.
- While the ball's footprint is inside your wedge, your **ball-time** accrues in real time.
- Every zone has a **publicly visible danger meter** showing its accrued ball-time this interval, so all players can read the risk building and see who is currently "losing" the interval. The tick countdown timer is also public — everyone always knows how long until the next elimination.
- Meters reset to zero at every tick and at every kickoff/restart. Nothing carries over between intervals. *(default — flag if you disagree)*

### The Tick

- Every interval, the game resolves a **tick**: whichever zone accumulated the **most ball-time since the last tick** has its owner **eliminated**. Interval accumulation, never a single-frame snapshot — the whole interval matters, not just the final second.
- **Guaranteed elimination.** Every tick removes exactly one player, no exceptions and no thresholds. A 6-player match is exactly 5 ticks long, so match length is bounded and every tick is a real dramatic beat.
- **Base interval: ~30 seconds** at 6 players — long enough for the ball to swing between zones two or three times, so an early bad bounce is recoverable. Intervals shorten as players are eliminated (exact curve settled in the Escalation section).

### Ties → Overtime Micro-Round

If two or more players are *exactly* tied for most ball-time when a tick resolves:

1. The ball resets to the neutral center disc — a mini-kickoff, on theme. *(default — flag if you disagree)*
2. Only the tied players' zones are **live**; everyone else's wedges accrue nothing.
3. **First live zone to accrue any ball-time loses.** Instant, dramatic, cannot stall.
4. Non-tied players stay in the arena and are free to interfere. *(default — flag if you disagree)*

This rule also cleanly covers the degenerate case where the ball somehow spends an entire interval over the neutral disc: all meters read zero, everyone is tied, overtime sorts it out.

---

## 2. Match Flow & Phases — SETTLED

A match flows: **Lobby → Draft → Opening Kickoff → Arena/Tick loop (with a Restart Kickoff after every elimination, one of which is upgraded to Halftime) → Sudden Kickoff (final two) → Winner.**

### Draft (match start)

- **Simultaneous and private.** All players draft at the same time on a shared ~25-second timer. Nobody sees anyone else's picks until launch.
- Each player picks one card from each of the three pools — **Ability**, **Equipment**, **Gameplay Advantage** — ending with exactly 3 cards.
- Each pool offers **3 rarity-weighted options** (9 cards shown per player in total). *(default — flag if you disagree)*
- If the timer expires with picks missing, the game auto-picks the remaining slots. *(default — flag if you disagree)*
- All loadouts are **revealed publicly at launch** — the spectacle depends on everyone knowing what everyone brought.

### Cannon Launch (opening and every restart)

- Every kickoff, survivors are fired from cannons mounted on their own wall of the polygon. The cannon volley IS the kickoff spectacle and the game's namesake.
- **Aim within an arc.** During the countdown, each player steers their cannon's angle within a limited arc to choose roughly where they land. Launch strength is fixed — no power charging, no trajectory preview.
- Landing is harmless (no fall damage, no landing lag worth exploiting).

### Restart Kickoff (after every elimination)

The pause after each tick runs, in order (~10 seconds total):

1. **Elimination beat.** Short slow-mo/zoom on the resolved tick so everyone sees who's out and why.
2. **The eliminated player hands out two cards.** The game auto-generates one **advantage card** and one **curse card**; the eliminated player only chooses **who receives each** (same player or different players allowed — targeting is the interesting decision). Choice timer ~8 seconds.
   - Timeout behavior: the curse auto-targets the current match leader (lowest cumulative ball-time so far), the advantage goes to a random other survivor. *(default — flag if you disagree)*
3. **Public reveal.** Both cards and their recipients are shown to everyone.
4. **Arena morphs & cannons reload.** The arena reshapes to the new survivor-count polygon (interior presets adapt), the ball resets to the neutral center disc, survivors aim their launch arcs during the 3-2-1 countdown, and everyone fires at once as play resumes.

Handed-out cards **expire at the next Restart Kickoff** — they nudge one interval, never snowball. (Card content itself is Section 3's job.)

### Halftime

- **Trigger:** the Restart Kickoff at which survivors first drop to **3** is upgraded to Halftime. This gives 4-, 5- and 6-player matches a Halftime near their midpoint; 3-player and 2-player lobbies skip it and flow straight toward the Sudden Kickoff. *(default — flag if you disagree)*
- The triggering elimination's normal advantage/curse handout still happens in the same pause — Halftime adds to the restart, it doesn't replace it. *(default — flag if you disagree)*
- **Arena reconfigures:** wedge ownership reshuffles (you defend a different wall), the interior re-rolls to a fresh platform/obstacle arrangement, and the sky itself turns — warm afternoon light gives way to golden-hour sunset (the match's day→dusk light arc, see `art_direction.md`). A real halftime whistle without any new mechanics.
- **Card swap:** each survivor may replace **one** of their 3 drafted cards from a fresh offer of options. Power stays flat (still 3 cards) — this is adaptation, not escalation. Skipping the swap is allowed.
- Slightly longer pause (~20 seconds), then a full cannon relaunch.

### Sudden Kickoff (final two)

- The arena takes its final form — the **circle** — split into two clean halves (neutral center disc remains). Dusk falls and floating paper lanterns light the pitch: the match's light arc completes here. One final cannon volley starts the duel.
- **No tick timer.** Each finalist has one large **cumulative duel meter**: ball-time in your half fills your meter and it never resets. **First meter to fill loses.** Meter capacity is a tuning value (start around 15 seconds of ball-time).
- Continuous sudden death — no intervals, no resets, tension only rises. Reuses the meter and footprint systems already built, but reads as a completely different mode.
- The advantage/curse cards handed out at the finale-triggering restart have no "next restart" to expire at — they **last the entire duel**. This makes the final eliminated player's targeting choice the heaviest in the match, deliberately. *(default — flag if you disagree)*

### Winner

Last player standing wins. Short victory ceremony (winner celebration, final standings by elimination order), then back to lobby/rematch — flow detailed in Section 5.

---

## 3. Card Systems — FRAMEWORK SETTLED, card lists provisional

> The rules below are locked. The **specific card lists are provisional** — a starting candidate set to be finalized during playtesting, not a commitment.

### Content budget (locked)

- **~30 cards total**: 6 per draft pool (3 common / 2 rare / 1 epic × Ability, Equipment, Advantage) + 6 restart advantages + 6 restart curses.
- Restart advantages and curses are designed as **mirrored pairs** — mostly the same modifier with the sign flipped (speed ±, header power ±, wedge width ±, meter rate ±, cooldown ±). One modifier system, two signs: half the build cost of 12 unique effects.

### Rules (locked)

- **Abilities** are actives: one ability button, fixed cooldown shown on screen. No charges, no resource.
- **Boldness scales with rarity.** Commons are honest stat nudges, rares are noticeable tools, epics visibly bend rules. An epic reveal should be an event.
- **Draft offers:** 3 rarity-weighted options per pool (60% common / 30% rare / 10% epic per slot), no duplicates within one offer. Duplicates *across players* are allowed — each player rolls their own offer.
- **Restart generation: uniform random** from the advantage and curse pools, excluding effects currently active on any player. No hidden weighting — the drama lives in the eliminated player's targeting choice.
- **Wedge-size direction (corrects initial_idea):** under the elimination rule, a *bigger* wedge is strictly worse — more area collecting ball-time. So advantage effects **shrink** your wedge; curses **widen** it. ("Bigger starting zone" in initial_idea.md is inverted.)
- "Early warning before a tick" from initial_idea is dropped — the tick timer is already public for everyone.

### Provisional card set (finalize in playtesting)

**Ability** — Dash (C, burst of movement) · Shove (C, radial push on players + ball) · Ball Stop (C, freeze ball dead on contact) · Shield Bubble (R, reflects ball with bonus force) · Grapple Hook (R, pull to wall/platform/point) · Tractor Beam (E, pull the ball toward you from range).

**Equipment** — Speed Anklet (C, +15% run speed) · Spring Boots (C, higher jump) · Bumper Shell (C, body contact pushes ball much harder) · Magnetic Boots (R, immune to wind/stagger, stable on platforms) · Hard Hat (R, +30% header power) · Moon Suit (E, personal low gravity, aerial dominance).

**Gameplay Advantage** — Slim Wedge (C, wedge 10% narrower) · Padded Meter (C, meter fills 10% slower) · Quick Reload (C, cooldown 25% shorter) · Free Save (R, once per interval, auto-punt first ball entering your wedge) · Crystal Ball (R, see ball trajectory prediction) · Comeback Engine (E, +20% speed & header power while your meter is highest).

**Restart pairs (advantage / curse)** — Overdrive / Lead Boots (speed ±20%) · Titan Header / Soft Header (header ±) · Slim Zone / Wide Zone (wedge ±20%) · Slow Meter / Fast Meter (fill rate ±25%) · Bodyguard (one auto-save) / Magnet Curse (ball attracted to your wedge) · Double Boost / Jammed Ability (cooldown ×0.5 / ×2).

---

## 4. Escalation & Balance — SETTLED

### The arena is the escalation display

- Every elimination morphs the arena to the next polygon: **hexagon → pentagon → square → triangle → circle**. Fewer walls means longer sides, so **every surviving wedge grows** — baseline danger rises for everyone as the lobby thins.
- The morph happens inside the Restart Kickoff pause, alongside the card handout and cannon reload — never during live play.

### Pacing curve

- **Each shape has its own tempo: tick interval = survivor count × 5 seconds.** Hexagon 30s, pentagon 25s, square 20s, triangle 15s. At two survivors the timer disappears entirely (Sudden Kickoff duel meters). Smaller lobbies simply enter the curve at their shape — a 4-player match starts on the square at 20s. *(default — flag if you disagree)*
- Combined effect: bigger wedges + shorter intervals + stronger wind = pace strictly rises as the match progresses, never slows.

### Escalation levers

- **Wind is the only escalating force.** Gust strength and frequency step up at every elimination.
- Moving platforms and static bumpers/pillars keep **constant behavior** all match. Their arrangement changes exactly twice per cause: adapting to each polygon morph (preset per shape), and one full re-roll at Halftime.
- Ball physics stay constant all match. (Considered and cut: platform speed-up, ball liveliness ramp, second ball at 3 players — rejected for readability and solo-jam scope.)

### Rubber-banding philosophy: visible-only

- **All catch-up is player-visible and player-driven.** Exactly two sanctioned mechanisms: the eliminated player's advantage/curse targeting at every restart, and drafted cards that reward being behind (e.g., Comeback Engine).
- **No hidden math, ever.** No secret speed boosts for whoever's losing, no generation weighted against the leader. If the game helps someone, everyone can see it and can name who chose it.
- **Kingmaking is embraced — and bounded.** Eliminated players cursing the leader is the social heart of the game. It stays bounded because handed-out cards expire at the next restart: a pile-on nudges one interval, it never decides the match outright.

---

## 5. Players & Session Rules — SETTLED

### Player counts

- **2–6 players.** A 6-player match runs the full arc (hexagon → duel). Smaller lobbies enter the polygon/tempo curve at their player count — a 4-player match starts on the square at 20s ticks.
- **A 2-player match is the duel, straight up:** lobby → draft → circle arena → Sudden Kickoff rules. No ticks, no restarts, no handouts — a coherent quick mode for free. *(default — flag if you disagree)*

### Eliminated players: the clouds

- On elimination (after performing their advantage/curse handout), players float up onto a small **spectator cloud** that slowly circles the arena.
- From their cloud they have **emotes/cheer reactions**, visible to everyone in the arena. No gameplay impact — matches are short (~5 minutes), so spectating never gets long, and the handout moment already gave them their dramatic exit.

### Disconnects: grace period

- A disconnected player's character **idles in place for a ~20-second grace window** awaiting reconnection. Reconnecting within the window resumes control seamlessly.
- During the grace window: the idle body remains physical (it can be shoved aside) and **their meter keeps accruing normally** — freezing it would make disconnecting a defensive exploit. *(default — flag if you disagree)*
- If a tick eliminates them during the window, it's a normal elimination. If the window expires, an immediate off-tick Restart Kickoff fires. Either way their handout uses the timeout rule: curse auto-targets the current leader, advantage goes to a random other survivor. *(default — flag if you disagree)*

### Bots: demo insurance

- The design supports **simple bot-fill**: a bot makes random-but-valid draft picks, roams, chases the ball when it's in its own wedge and headers it out, and resolves handouts via the timeout rule (which exists anyway). Dumb but alive.
- Purpose: a solo judge at the booth can still experience a full 6-slot match. **Build priority: last** — bots come after the human game works, never before.

### Team skins: the jersey system

- Skins are a **first-class system built in from the start**: in the lobby, each player picks a real-world football **national team or club**, and their bean's outfit is generated from that team's kit — jersey pattern on the body, shorts band, sock-colored feet.
- **Jerseys are data, not art.** Each team is one data entry: name, primary/secondary/accent colors, pattern type (solid / stripes / hoops / halves / sash), shorts color, socks color, plus an away-kit variant. The real team list is content, matched jersey-by-jersey during implementation (deferred exactly like the card list).
- **Your jersey is your identity:** wedge tint, danger meter, and HUD color all derive from your kit's primary color.
- **Kit clash rule:** if a picked kit is too close in color to one already taken, the later picker automatically wears that team's **away kit** — authentic to real football, and it guarantees all six players stay readable at a glance. *(default — flag if you disagree)*
- **Colorways and team names only — no club crests, badges, or sponsor logos** (keeps a publicly hosted jam build trademark-safe). *(default — flag if you disagree)*
- Skins are purely cosmetic. No gameplay effect, ever.

### Lobby & rematch

- **Room code / link lobbies.** Host creates a room, shares a short code or link, friends and judges join from their own devices. Host fills empty slots with bots if desired, then starts.
- After the winner ceremony and final standings (by elimination order), **one-tap rematch** keeps the same lobby together. Matchmaking is explicitly out of scope.

---

## Deferred (deliberately not decided here)

- **Card list finalization** — the Section 3 lists are candidates; final content and numbers come from playtesting.
- **Jersey/team content list** — the skin *system* ships from day one; the actual team-by-team kit matching (researching real jerseys) is a content pass during implementation.
- **All tuning values** — neutral disc size, duel meter capacity, cooldown lengths, wind curve numbers, grace window length, pause durations. Marked throughout as tuning, not design.
- **Audio** — scoped as a minimal late pass: one cozy lo-fi loop + ~10 CC0 sound effects (sources declared), driven by the force-scaled SFX system in `architecture.md`. No separate audio doc.
- (The technical plan lives in `architecture.md`; the art direction lives in `art_direction.md`, which supersedes the voxel style notes in `initial_idea.md`.)
