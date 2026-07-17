/**
 * Every tuning number idea.md deferred lives HERE and only here.
 * Balancing is a data edit, never a code change (architecture.md §4).
 * All times in seconds, all distances in meters, unless suffixed.
 */

// --- session ---------------------------------------------------------------
export const PLAYERS_MIN = 2
export const PLAYERS_MAX = 6
export const GRACE_SECONDS = 20 // disconnect reconnection window (idea.md §5)

// --- simulation / networking ----------------------------------------------
export const SIM_HZ = 60
export const FIXED_DELTA = 1 / SIM_HZ
export const PATCH_HZ = 30 // positions matter: ball + players patch at 30Hz
export const INTERP_DELAY_MS = 100 // remote entity render delay
export const RECONCILE_SMOOTH_S = 0.1 // residual error smoothing after replay

// --- arena -----------------------------------------------------------------
export const ARENA_RADIUS = 28
export const WALL_HEIGHT = 3.4
export const NEUTRAL_DISC_FRACTION = 0.15 // of arena radius; counts for nobody
export const PLATFORM_COUNT = 3
export const PILLAR_COUNT = 4

// --- tick & elimination ------------------------------------------------------
export const TICK_SECONDS_PER_SURVIVOR = 10 // interval = survivors x 10s — longer rounds for playtesting
export const TIE_EPSILON_S = 0.05 // meters within this = tied -> overtime
export const DUEL_METER_CAPACITY_S = 30 // sudden kickoff cumulative meter (longer duel)
// grace so a ball that just grazes your zone in the final moment can't doom
// you: the ball must DWELL in your zone this long before it accrues meter, and
// accrual freezes this long before the tick fires (a "final whistle" lock-in)
export const ZONE_DWELL_GRACE_S = 0.6 // ball must sit in a zone this long before it counts
export const TICK_LOCKIN_S = 1.0 // meters freeze this long before the tick resolves

// --- match flow pauses -------------------------------------------------------
export const DRAFT_SECONDS = 25
export const HANDOUT_SECONDS = 8
export const RESTART_PAUSE_S = 10
export const HALFTIME_PAUSE_S = 20
export const LAUNCH_COUNTDOWN_S = 3

// --- movement (tune in M1 fun-test) -----------------------------------------
export const RUN_SPEED = 7 // normal run
export const SPRINT_SPEED = 10.5 // shift — costs stamina
export const JUMP_SPEED = 7.5
export const GRAVITY = 20
export const ACCEL_GROUND = 14 // 1/s toward target velocity
export const ACCEL_AIR = 6
export const TURN_RATE = 12 // rad/s — bean turns toward its movement direction
export const PLAYER_RADIUS = 0.45
export const PLAYER_HEIGHT = 1.4

// --- stamina -------------------------------------------------------------------
export const STAMINA_MAX = 100
export const SPRINT_DRAIN = 22 // per second while sprinting
export const STAMINA_REGEN = 16 // per second while not sprinting
export const DIVE_COST = 30 // stamina consumed per dive

// --- dive (while airborne — the header move) -----------------------------------
export const DIVE_FORCE = 11 // forward lunge speed
export const DIVE_UP = 1.5 // small float at dive start
export const DIVE_RECOVERY_S = 0.3 // landing stumble: damped input, no jump

// --- player-vs-player --------------------------------------------------------
export const PLAYER_PUSH = 6 // running into someone: a firm shove, no overlap
export const DIVE_PUSH = 22 // diving into someone: LAUNCH them off their feet

// --- ball & header (tune in M1 fun-test) -------------------------------------
export const BALL_RADIUS = 2.0 // ~3x the bean: a giant, satisfying target
export const BALL_RESTITUTION = 0.75
export const BALL_GRAVITY = 15 // heavy, not a balloon — but still hangs a little
export const BALL_MAX_SPEED = 30
export const BALL_DRAG = 0.4 // heavy ball settles into its roll
export const BODY_NUDGE_FORCE = 2 // walking into the ball barely moves it now
export const HEADER_POWER = 22
export const HEADER_UP_BIAS = 0.35 // fraction of header impulse aimed upward
export const HEADER_MARGIN = 0.5 // extra reach beyond ball+player radii while diving
export const HEADER_COOLDOWN_S = 0.35

// --- ball<->player contact solver (industry-standard trio) ---------------------
export const BALL_MASS = 5 // vs player mass 1: the ball wins exchanges naturally
export const PLAYER_MASS = 1
export const BODY_RESTITUTION = 0.2 // body contact is a thud, not a bounce
export const BODY_FRICTION_MU = 0.25 // Coulomb clamp: grip on brush contacts, dribbles
export const CONTACT_SLOP = 0.02 // allowed overlap — kills micro-jitter
export const CONTACT_CORRECTION = 0.8 // Baumgarte: fraction of penetration fixed/step
export const BALL_SUBSTEP_TRAVEL = 0.3 // max ball travel per substep (anti-tunnel)
export const BALL_MAX_SUBSTEPS = 4

// --- knock gameplay layer (on top of the physical impulse) ----------------------
export const KNOCK_DELTA_V = 6.5 // player Δv above this = knocked (stun + flail)
export const PLAYER_MAX_KNOCK_SPEED = 14 // clamp so launches stay readable
export const BALL_KNOCK_POP = 3.5 // upward pop on a knock
export const KNOCK_STUN_S = 0.6 // flailing, no control

// --- wind (a real, always-on force — deterministic sampleWind(t)) ------------
export const WIND_ENABLED = true // a constant breeze + gusts, on by default
export const WIND_BASE_STRENGTH = 2.0 // base breeze force; gusts multiply up
export const WIND_STEP_PER_ELIMINATION = 0.7 // grows as the field thins

// --- cannon launch ------------------------------------------------------------
export const LAUNCH_AIM_ARC_DEG = 50 // aimable arc, centered on wedge inward normal
export const LAUNCH_FLIGHT_S = 1.4 // scripted parabola duration

// --- cards ---------------------------------------------------------------------
export const DRAFT_OFFERS_PER_POOL = 3
export const RARITY_WEIGHTS = { common: 0.6, rare: 0.3, epic: 0.1 } as const
