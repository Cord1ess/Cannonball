import type { AudioBackend, ClipHandle } from './backend.ts'

/**
 * Procedural PCM tone generator — placeholder SFX until real assets land.
 * Lifted from ARC Engine examples/m1-platformer/src/main.ts (adapted: the
 * backend is passed in instead of closed over).
 *
 * Examples:
 *   toneClip(audio, 0.15, (t) => 220 + 400 * t, 14)          // rising blip (jump)
 *   toneClip(audio, 0.2, (t) => (t < 0.08 ? 988 : 1319), 12) // two-tone chime
 */
export function toneClip(
  audio: AudioBackend,
  seconds: number,
  pitch: (t: number) => number,
  decay: number,
): ClipHandle {
  const rate = 44100
  const samples = Math.floor(rate * seconds)
  const pcm = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const t = i / rate
    pcm[i] = Math.sin(2 * Math.PI * pitch(t) * t) * Math.exp(-t * decay) * 0.5
  }
  return audio.createClip(pcm, rate)
}
