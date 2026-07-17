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
export const PATCH_HZ = 20
export const INTERP_DELAY_MS = 120 // remote entity render delay
export const RECONCILE_SMOOTH_S = 0.1 // residual error smoothing after replay

// --- arena -----------------------------------------------------------------
export const ARENA_RADIUS = 28
export const WALL_HEIGHT = 3.4
export const NEUTRAL_DISC_FRACTION = 0.15 // of arena radius; counts for nobody
export const PLATFORM_COUNT = 3
export const PILLAR_COUNT = 4

// --- tick & elimination ------------------------------------------------------
export const TICK_SECONDS_PER_SURVIVOR = 5 // interval = survivors x 5s (idea.md §4)
export const TIE_EPSILON_S = 0.05 // meters within this = tied -> overtime
export const DUEL_METER_CAPACITY_S = 15 // sudden kickoff cumulative meter

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
export const PLAYER_PUSH = 2.5 // running into someone: slight push
export const DIVE_PUSH = 9 // diving into someone: major shove

// --- ball & header (tune in M1 fun-test) -------------------------------------
export const BALL_RADIUS = 2.0 // ~3x the bean: a giant, satisfying target
export const BALL_RESTITUTION = 0.72
export const BALL_GRAVITY = 10 // floaty — big balls hang
export const BALL_MAX_SPEED = 26
export const BALL_DRAG = 0.35 // per-second rolling drag while grounded
export const BODY_NUDGE_FORCE = 4
export const HEADER_POWER = 18
export const HEADER_UP_BIAS = 0.35 // fraction of header impulse aimed upward
export const HEADER_MARGIN = 0.5 // extra reach beyond ball+player radii while diving
export const HEADER_COOLDOWN_S = 0.35

// --- wind (only escalating force, idea.md §4) --------------------------------
export const WIND_BASE_STRENGTH = 2.0
export const WIND_STEP_PER_ELIMINATION = 1.0
export const WIND_GUST_PERIOD_S = 7 // average seconds between gusts
export const WIND_GUST_DURATION_S = 2.2

// --- cannon launch ------------------------------------------------------------
export const LAUNCH_AIM_ARC_DEG = 50 // aimable arc, centered on wedge inward normal
export const LAUNCH_FLIGHT_S = 1.4 // scripted parabola duration

// --- cards ---------------------------------------------------------------------
export const DRAFT_OFFERS_PER_POOL = 3
export const RARITY_WEIGHTS = { common: 0.6, rare: 0.3, epic: 0.1 } as const
