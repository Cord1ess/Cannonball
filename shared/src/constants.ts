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
export const ARENA_RADIUS = 12
export const WALL_HEIGHT = 2.2
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
export const MOVE_SPEED = 6.5
export const JUMP_SPEED = 7.5
export const GRAVITY = 20
export const ACCEL_GROUND = 14 // 1/s toward target velocity
export const ACCEL_AIR = 6
export const PLAYER_RADIUS = 0.45
export const PLAYER_HEIGHT = 1.4
export const SHOVE_FORCE = 3 // player-vs-player light shove

// --- ball & header (tune in M1 fun-test) -------------------------------------
export const BALL_RADIUS = 0.55
export const BALL_RESTITUTION = 0.72
export const BALL_GRAVITY = 14 // lighter than players: hang-time (art of feel)
export const BALL_MAX_SPEED = 22
export const BALL_DRAG = 0.35 // per-second rolling drag while grounded
export const BODY_NUDGE_FORCE = 4
export const HEADER_POWER = 14
export const HEADER_UP_BIAS = 0.35 // fraction of header impulse aimed upward
export const HEADER_RANGE = 1.1 // contact window around the bean's head
export const HEADER_COOLDOWN_S = 0.35

// --- wind (only escalating force, idea.md §4) --------------------------------
export const WIND_BASE_STRENGTH = 1.2
export const WIND_STEP_PER_ELIMINATION = 0.8
export const WIND_GUST_PERIOD_S = 7 // average seconds between gusts
export const WIND_GUST_DURATION_S = 2.2

// --- cannon launch ------------------------------------------------------------
export const LAUNCH_AIM_ARC_DEG = 50 // aimable arc, centered on wedge inward normal
export const LAUNCH_FLIGHT_S = 1.4 // scripted parabola duration

// --- cards ---------------------------------------------------------------------
export const DRAFT_OFFERS_PER_POOL = 3
export const RARITY_WEIGHTS = { common: 0.6, rare: 0.3, epic: 0.1 } as const
