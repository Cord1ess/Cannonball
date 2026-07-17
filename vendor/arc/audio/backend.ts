/**
 * The audio seam (docs/systems/architecture.md package list): WebAudio behind
 * a handle-based contract with a null implementation for headless CI — the
 * same swappability discipline as rendering and physics. v1 scope is the
 * basics (clips, one-shots, loops, volumes, the autoplay gate); the spatial
 * graph arrives on this same interface later.
 */

export type ClipHandle = number
export type SoundHandle = number

export interface PlayOptions {
  /** 0..1, default 1 */
  readonly volume?: number
  readonly loop?: boolean
  /** playback speed multiplier, default 1 */
  readonly playbackRate?: number
}

export interface AudioBackend {
  /**
   * Browsers gate audio on a user gesture: contexts start suspended and
   * resume() must be called from one (see @arc/platform's autoplay unlock).
   */
  readonly unlocked: boolean
  resume(): Promise<void>

  /** Mono PCM → clip. Synchronous — procedural audio and decoded artifacts. */
  createClip(pcm: Float32Array, sampleRate: number): ClipHandle
  /** Encoded bytes (wav/mp3/ogg — whatever the platform decodes) → clip. */
  decode(bytes: ArrayBuffer): Promise<ClipHandle>
  disposeClip(clip: ClipHandle): void

  play(clip: ClipHandle, options?: PlayOptions): SoundHandle
  /**
   * Idempotent BY CONTRACT: sounds end on their own, so stopping an unknown
   * or finished handle is a no-op, never an error (unlike clip disposal —
   * clips are owned resources and unknown handles throw).
   */
  stop(sound: SoundHandle): void
  stopAll(): void
  setMasterVolume(volume: number): void

  dispose(): void
}

export type AudioBackendErrorCode = 'UNKNOWN_HANDLE' | 'BAD_VALUE' | 'UNSUPPORTED'

export class AudioBackendError extends Error {
  readonly code: AudioBackendErrorCode

  constructor(code: AudioBackendErrorCode, message: string) {
    super(message)
    this.name = 'AudioBackendError'
    this.code = code
  }
}
