import type { SoundName } from './audio.ts'

/**
 * PROCEDURAL SFX (deadline fallback). The two ATMOSPHERE tracks (crowd, music)
 * are real recordings dropped in client/public/audio/; the short one-shots are
 * SYNTHESIZED here so the game has a full soundscape without sourcing a dozen
 * clips. Each returns mono PCM (Float32, -1..1) at the given sample rate, which
 * the WebAudio backend wraps into a clip. Punchy, short, toon-ish — a hair of
 * pitch variety comes from the play() jitter, so these are single-shot bakes.
 *
 * Anything with a real file present overrides its synth (audio.ts prefers the
 * loaded clip). Slots not covered here just stay silent.
 */

type Env = (t: number, dur: number) => number
const expDecay: Env = (t, dur) => Math.exp((-4 * t) / dur)
const clamp = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v)

interface Osc {
  freq: number | ((t: number) => number)
  type?: 'sine' | 'square' | 'saw' | 'tri' | 'noise'
  gain?: number
  env?: Env
}

function render(sr: number, dur: number, layers: Osc[]): Float32Array {
  const n = Math.max(1, Math.floor(sr * dur))
  const out = new Float32Array(n)
  // per-oscillator running phase for accurate FM sweeps
  const phase = new Array(layers.length).fill(0)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    let s = 0
    for (let l = 0; l < layers.length; l++) {
      const o = layers[l]!
      const f = typeof o.freq === 'function' ? o.freq(t) : o.freq
      phase[l] += (f * Math.PI * 2) / sr
      const ph = phase[l]
      let wave: number
      switch (o.type) {
        case 'square':
          wave = Math.sin(ph) >= 0 ? 1 : -1
          break
        case 'saw':
          wave = ((ph / (Math.PI * 2)) % 1) * 2 - 1
          break
        case 'tri':
          wave = Math.asin(Math.sin(ph)) * (2 / Math.PI)
          break
        case 'noise':
          wave = Math.random() * 2 - 1
          break
        default:
          wave = Math.sin(ph)
      }
      const env = (o.env ?? expDecay)(t, dur)
      s += wave * (o.gain ?? 1) * env
    }
    out[i] = clamp(s)
  }
  // tiny fade-out on the last 4ms to kill clicks
  const fade = Math.min(n, Math.floor(sr * 0.004))
  for (let i = 0; i < fade; i++) out[n - 1 - i]! *= i / fade
  return out
}

/** build the PCM for a synth SFX slot, or null if that slot has no synth. */
export function synthSfx(name: SoundName, sr: number): Float32Array | null {
  switch (name) {
    case 'kick': // heavy thud + a short mid pop (a header on the giant ball)
      return render(sr, 0.22, [
        { freq: (t) => 150 - 90 * t, type: 'sine', gain: 0.9 },
        { freq: 90, type: 'noise', gain: 0.25, env: (t, d) => expDecay(t, d) * (t < 0.02 ? 1 : 0.3) },
      ])
    case 'bounce': // low boing with a quick upward blip
      return render(sr, 0.16, [{ freq: (t) => 120 + 40 * Math.sin(t * 60), type: 'sine', gain: 0.8 }])
    case 'land': // soft grassy thump
      return render(sr, 0.18, [
        { freq: (t) => 110 - 60 * t, type: 'sine', gain: 0.7 },
        { freq: 200, type: 'noise', gain: 0.2, env: (t, d) => expDecay(t, d) * 0.6 },
      ])
    case 'cannon': // BOOM — big low blast + noise burst
      return render(sr, 0.5, [
        { freq: (t) => 90 - 60 * t, type: 'sine', gain: 1.0 },
        { freq: 60, type: 'noise', gain: 0.5, env: (t, d) => expDecay(t, d) },
        { freq: (t) => 200 - 150 * t, type: 'saw', gain: 0.3 },
      ])
    case 'whistle': // referee whistle — high warble
      return render(sr, 0.4, [
        { freq: (t) => 2100 + 120 * Math.sin(t * 90), type: 'sine', gain: 0.5, env: (t, d) => (t < 0.03 ? t / 0.03 : t > d - 0.05 ? (d - t) / 0.05 : 1) },
      ])
    case 'elim': // downward whoosh-out (poof)
      return render(sr, 0.45, [
        { freq: (t) => 700 - 600 * t, type: 'tri', gain: 0.5 },
        { freq: 400, type: 'noise', gain: 0.3, env: (t, d) => expDecay(t, d) * (1 - t / d) },
      ])
    case 'goal': // rising fanfare-ish triad blip
      return render(sr, 0.5, [
        { freq: (t) => (t < 0.16 ? 523 : t < 0.32 ? 659 : 784), type: 'square', gain: 0.35, env: (t) => (Math.sin((t % 0.16) / 0.16 * Math.PI)) },
      ])
    case 'save': // firm punt pop
      return render(sr, 0.2, [
        { freq: (t) => 300 - 180 * t, type: 'square', gain: 0.4 },
        { freq: 500, type: 'noise', gain: 0.2, env: (t, d) => expDecay(t, d) * 0.5 },
      ])
    case 'tick': // tense countdown blip
      return render(sr, 0.08, [{ freq: 880, type: 'square', gain: 0.4 }])
    case 'cheer': // crowd-ish noise swell (short) to layer under elim/goal
      return render(sr, 0.6, [
        { freq: 800, type: 'noise', gain: 0.5, env: (t, d) => Math.sin((t / d) * Math.PI) },
      ])
    case 'click': // soft UI tick
      return render(sr, 0.05, [{ freq: 660, type: 'sine', gain: 0.35 }])
    case 'bang': // floodlights-on thunk
      return render(sr, 0.3, [
        { freq: (t) => 70 - 30 * t, type: 'sine', gain: 0.9 },
        { freq: 120, type: 'noise', gain: 0.3, env: (t, d) => expDecay(t, d) * (t < 0.03 ? 1 : 0.2) },
      ])
    default: // crowd / music are real files — no synth
      return null
  }
}
