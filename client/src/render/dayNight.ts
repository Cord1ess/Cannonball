import * as THREE from 'three'
import type { GrassField } from './grass.ts'

/**
 * The day -> night light arc (M5b). Drives the sun, hemisphere fill, fog,
 * sky-dome tint, and the (unlit) grass toward night as the match thins out.
 *
 * The arc is survivor-driven: full daylight at the start of a match, easing to
 * FULL NIGHT by the time three players remain (and it stays night through the
 * duel). Stadium light PROPS come later — this is just the sky/lighting mood.
 *
 * nightFrac is eased toward its target every frame so the fall of night is a
 * slow dusk, never a snap when someone is eliminated.
 */

export interface DayNight {
  /** set the TARGET night level from survivor count (full night at <=3) */
  setSurvivors(survivors: number): void
  /** set the target directly, 0 = day .. 1 = night (for debug/menus) */
  setTarget(frac: number): void
  /** ease toward the target and repaint the world; call every frame */
  update(dt: number): void
  /** current eased night fraction (0..1) */
  readonly night: number
}

// two keyframes we lerp between; everything is authored as day and night pairs
const DAY = {
  sunColor: new THREE.Color(0xfff3e0),
  sunIntensity: 0.85,
  sunPos: new THREE.Vector3(6, 10, 4),
  hemiSky: new THREE.Color(0xdcefe8),
  hemiGround: new THREE.Color(0xcbbfa6),
  hemiIntensity: 0.95,
  fog: new THREE.Color(0xeef4e2), // horizonCream
  fogNear: 60,
  fogFar: 240,
  skyTint: new THREE.Color(0xffffff), // no tint over the painted day sky
}

const NIGHT = {
  // low, cool moonlight raking from the side
  sunColor: new THREE.Color(0x9fb4e6),
  sunIntensity: 0.42,
  sunPos: new THREE.Vector3(-9, 2.2, -5),
  hemiSky: new THREE.Color(0x39476e),
  hemiGround: new THREE.Color(0x222a3c),
  hemiIntensity: 0.6,
  fog: new THREE.Color(0x2a3350), // deep dusk blue
  fogNear: 40,
  fogFar: 200,
  skyTint: new THREE.Color(0x39466f), // multiply the day sky down to night blue
}

const SURVIVOR_NIGHT = 3 // full night at this many survivors
const SURVIVOR_DAY = 6 // full day at this many (or more) survivors

export function createDayNight(
  scene: THREE.Scene,
  sun: THREE.DirectionalLight,
  hemi: THREE.HemisphereLight,
  sky: THREE.Mesh,
  grass: GrassField,
): DayNight {
  let target = 0
  let frac = 0
  const skyMat = sky.material as THREE.MeshBasicMaterial
  const fog = scene.fog as THREE.Fog | null

  function apply(): void {
    const f = frac
    sun.color.copy(DAY.sunColor).lerp(NIGHT.sunColor, f)
    sun.intensity = DAY.sunIntensity + (NIGHT.sunIntensity - DAY.sunIntensity) * f
    sun.position.copy(DAY.sunPos).lerp(NIGHT.sunPos, f)

    hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, f)
    hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, f)
    hemi.intensity = DAY.hemiIntensity + (NIGHT.hemiIntensity - DAY.hemiIntensity) * f

    if (fog) {
      fog.color.copy(DAY.fog).lerp(NIGHT.fog, f)
      fog.near = DAY.fogNear + (NIGHT.fogNear - DAY.fogNear) * f
      fog.far = DAY.fogFar + (NIGHT.fogFar - DAY.fogFar) * f
    }

    skyMat.color.copy(DAY.skyTint).lerp(NIGHT.skyTint, f)
    grass.setNight(f)
  }

  apply()

  return {
    get night() {
      return frac
    },
    setSurvivors(survivors: number): void {
      // 6+ players = full day, 3 or fewer = full night, linear between
      const t = (SURVIVOR_DAY - survivors) / (SURVIVOR_DAY - SURVIVOR_NIGHT)
      target = Math.max(0, Math.min(1, t))
    },
    setTarget(frac2: number): void {
      target = Math.max(0, Math.min(1, frac2))
    },
    update(dt: number): void {
      if (Math.abs(target - frac) < 0.0005) {
        if (frac !== target) {
          frac = target
          apply()
        }
        return
      }
      // exponential ease — dusk falls gradually, never a snap on elimination
      frac += (target - frac) * Math.min(1, dt * 0.55)
      apply()
    },
  }
}
