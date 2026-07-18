import * as THREE from 'three'
import type { GrassField } from './grass.ts'

/**
 * The day -> night light arc (M5b). Drives a VISIBLE sun that arcs across the
 * sky (high + bright sharp daytime -> sinking to the horizon -> set), plus the
 * directional light, hemisphere fill, fog, sky-dome tint, the (unlit) grass,
 * and the (unlit) ground toward night as the match progresses.
 *
 * Timing is MATCH-PROGRESS driven, not raw survivor count: night is reached as
 * a fraction of the eliminations that will happen this match, so a match ALWAYS
 * opens in daylight and moves toward night regardless of the starting count.
 *  - 6 players start -> full night by the time 3 remain
 *  - 3 or 2 players start -> day-to-night stretched across the whole match
 * (see NIGHT_AT_SURVIVORS below for the exact mapping).
 *
 * nightFrac is eased toward its target every frame so the fall of night is a
 * gradual dusk that also keeps creeping between eliminations (the sun visibly
 * moves), never a snap. Stadium light PROPS + the audio "bang" when they switch
 * on come later — `onNightfall` fires once when night is essentially reached so
 * that pop can hang off it.
 */

export interface DayNight {
  /** target night level from match progress (elims done / elims-to-night) */
  setMatchProgress(survivors: number, seatsAtStart: number): void
  /** set the target directly, 0 = day .. 1 = night (debug / menus) */
  setTarget(frac: number): void
  /** register a one-shot callback for when night is essentially reached */
  onNightfall(cb: () => void): void
  /** ease toward the target, move the sun, and repaint the world; every frame */
  update(dt: number): void
  /** current eased night fraction (0..1) */
  readonly night: number
}

// two keyframes we lerp between; everything is authored as day and night pairs
const DAY = {
  // sharp, bright daytime — a strong key light with crisp shadows
  sunColor: new THREE.Color(0xfff4e2),
  sunIntensity: 1.35,
  hemiSky: new THREE.Color(0xdcefe8),
  hemiGround: new THREE.Color(0xcbbfa6),
  hemiIntensity: 0.8,
  fog: new THREE.Color(0xeef4e2), // horizonCream
  fogNear: 60,
  fogFar: 240,
  skyTint: new THREE.Color(0xffffff), // no tint over the painted day sky
  groundTint: new THREE.Color(0xffffff), // ground shows at its authored value
  discColor: new THREE.Color(0xfff6d8),
  discSize: 62, // a big bright sun
}

const NIGHT = {
  // low, cool moonlight raking from the side
  sunColor: new THREE.Color(0x9fb4e6),
  sunIntensity: 0.4,
  hemiSky: new THREE.Color(0x39476e),
  hemiGround: new THREE.Color(0x222a3c),
  hemiIntensity: 0.55,
  fog: new THREE.Color(0x2a3350), // deep dusk blue
  fogNear: 40,
  fogFar: 200,
  skyTint: new THREE.Color(0x39466f), // multiply the day sky down to night blue
  // GROUND: the pitch is FLOODLIT at night, so only a gentle cool-down (not a
  // dark multiply) — it stays lit under the tower lights. ONLY the material
  // colour multiplier is touched; the texture + remap pipeline are untouched.
  groundTint: new THREE.Color(0xc2c8c0),
  discColor: new THREE.Color(0xdfe6ff), // a pale moon
  discSize: 44, // still a large, clear moon
}

// SUN ARC: the sun rides an east->overhead->west path parameterised by frac.
// At day (frac 0) it's HIGH and to one side (sharp long-ish shadows, not flat
// noon). As night falls it sinks toward the horizon and swings across, so the
// shadows lengthen + rotate visibly. Distance keeps it out on the sky dome.
const SUN_DIST = 220
function sunDirection(frac: number, out: THREE.Vector3): THREE.Vector3 {
  // azimuth swings ~120° across the match; altitude falls from high to horizon
  const az = -0.6 + frac * 2.0 // radians, east-ish -> west-ish
  const alt = (0.95 - frac * 0.85) * (Math.PI / 2) // ~54° high -> ~5° low
  const cosA = Math.cos(alt)
  out.set(Math.cos(az) * cosA, Math.sin(alt), Math.sin(az) * cosA)
  return out
}

// full night for the DRIVER when this many survivors remain. 6p -> 3, but small
// lobbies stretch to the end: max(1, start-3) means 3p/2p reach night at 1 left.
function nightAtSurvivors(seatsAtStart: number): number {
  return Math.max(1, seatsAtStart - 3)
}

const scratchDir = new THREE.Vector3()

export function createDayNight(
  scene: THREE.Scene,
  sun: THREE.DirectionalLight,
  hemi: THREE.HemisphereLight,
  sky: THREE.Mesh,
  grass: GrassField,
  groundMat: THREE.MeshBasicMaterial | null,
): DayNight {
  let target = 0
  let frac = 0
  let stepProgress = 0 // the discrete elimination-driven progress (monotonic)
  let nightfallFired = false
  let nightfallCb: (() => void) | null = null
  const skyMat = sky.material as THREE.MeshBasicMaterial
  const fog = scene.fog as THREE.Fog | null

  // the VISIBLE sun disc — a BIG bright solid core with a soft glow halo around
  // it, an additive sprite far out on the sky dome so players see it climb/sink
  // as the day turns. Cosmetic; not the light itself.
  const discCanvas = document.createElement('canvas')
  discCanvas.width = discCanvas.height = 256
  {
    const c = discCanvas.getContext('2d')!
    const g = c.createRadialGradient(128, 128, 0, 128, 128, 128)
    // a fat, near-solid disc (bright out to ~0.42) then a wide soft glow falloff
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.42, 'rgba(255,255,255,1)')
    g.addColorStop(0.52, 'rgba(255,255,255,0.7)')
    g.addColorStop(0.72, 'rgba(255,255,255,0.25)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 256, 256)
  }
  const discTex = new THREE.CanvasTexture(discCanvas)
  discTex.colorSpace = THREE.SRGBColorSpace
  const discMat = new THREE.SpriteMaterial({
    map: discTex,
    transparent: true,
    depthWrite: false,
    depthTest: false, // always on the sky, behind everything
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const disc = new THREE.Sprite(discMat)
  disc.renderOrder = -1 // with the sky dome
  scene.add(disc)

  function apply(): void {
    const f = frac

    // move the light + the visible disc along the arc
    sunDirection(f, scratchDir)
    sun.position.copy(scratchDir).multiplyScalar(SUN_DIST)
    if (sun.target) {
      sun.target.position.set(0, 0, 0)
      sun.target.updateMatrixWorld()
    }
    disc.position.copy(scratchDir).multiplyScalar(SUN_DIST * 1.1)
    const size = DAY.discSize + (NIGHT.discSize - DAY.discSize) * f
    disc.scale.setScalar(size)
    discMat.color.copy(DAY.discColor).lerp(NIGHT.discColor, f)
    // the disc dims + warms (reddens toward the horizon) as it sets, then reads
    // as a cool moon at full night
    discMat.opacity = 1.0 - f * 0.35

    sun.color.copy(DAY.sunColor).lerp(NIGHT.sunColor, f)
    sun.intensity = DAY.sunIntensity + (NIGHT.sunIntensity - DAY.sunIntensity) * f

    hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, f)
    hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, f)
    hemi.intensity = DAY.hemiIntensity + (NIGHT.hemiIntensity - DAY.hemiIntensity) * f

    if (fog) {
      fog.color.copy(DAY.fog).lerp(NIGHT.fog, f)
      fog.near = DAY.fogNear + (NIGHT.fogNear - DAY.fogNear) * f
      fog.far = DAY.fogFar + (NIGHT.fogFar - DAY.fogFar) * f
    }

    skyMat.color.copy(DAY.skyTint).lerp(NIGHT.skyTint, f)
    if (groundMat) groundMat.color.copy(DAY.groundTint).lerp(NIGHT.groundTint, f)
    grass.setNight(f)

    // one-shot nightfall pop hook (for the future light-prop + audio "bang")
    if (!nightfallFired && f > 0.92) {
      nightfallFired = true
      nightfallCb?.()
    } else if (nightfallFired && f < 0.6) {
      nightfallFired = false // re-arm if we swing back to day (rematch/debug)
    }
  }

  apply()

  return {
    get night() {
      return frac
    },
    setMatchProgress(survivors: number, seatsAtStart: number): void {
      if (seatsAtStart < 2) {
        stepProgress = 0
        target = 0
        return
      }
      const nightAt = nightAtSurvivors(seatsAtStart)
      const denom = Math.max(1, seatsAtStart - nightAt) // elims needed for night
      const done = seatsAtStart - survivors // elims so far
      const p = Math.max(0, Math.min(1, done / denom))
      // a DROP to ~0 means a new match (lobby) — allow the reset back to day.
      // otherwise the arc is MONOTONIC during a match: night never walks back.
      if (p < 0.02) {
        stepProgress = 0
        target = 0
      } else {
        stepProgress = Math.max(stepProgress, p)
      }
    },
    setTarget(frac2: number): void {
      stepProgress = Math.max(0, Math.min(1, frac2))
      target = stepProgress
    },
    onNightfall(cb: () => void): void {
      nightfallCb = cb
    },
    update(dt: number): void {
      // CONTINUOUS flow: between eliminations the stepped progress is flat, which
      // would make the sky freeze then jump. So the effective target CREEPS from
      // the last step toward the NEXT one over time — the sun keeps visibly
      // moving and night keeps deepening a little every second, no plateaus, no
      // snaps. Capped so a round can't push past the elimination it's heading to.
      if (stepProgress > 0.001 && stepProgress < 0.999) {
        const nextStepCreep = Math.min(0.16, 1 - stepProgress) // how far into the gap
        target = Math.min(stepProgress + nextStepCreep, target + dt * 0.012)
        target = Math.max(target, stepProgress) // never regress below the step
      } else {
        target = stepProgress
      }

      if (Math.abs(target - frac) < 0.0005) {
        if (frac !== target) {
          frac = target
          apply()
        }
        return
      }
      // exponential ease — dusk falls gradually, never a snap on elimination;
      // frame-rate independent (dt-scaled), clamped so a huge dt can't overshoot
      frac += (target - frac) * Math.min(1, dt * 0.5)
      apply()
    },
  }
}
