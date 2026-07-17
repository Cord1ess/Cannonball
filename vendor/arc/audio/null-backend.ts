import { AudioBackendError, type AudioBackend, type ClipHandle, type PlayOptions, type SoundHandle } from './backend.ts'

interface NullSound {
  readonly clip: ClipHandle
  readonly options: Required<PlayOptions>
}

/**
 * The headless backend: full contract semantics, zero sound. CI worlds play
 * "into" this, and tests read back exactly what gameplay requested. Starts
 * LOCKED on purpose — it mirrors the browser's autoplay gate so unlock flows
 * are testable in Node.
 */
export class NullAudioBackend implements AudioBackend {
  #clips = new Map<ClipHandle, { readonly samples: number; readonly sampleRate: number }>()
  #sounds = new Map<SoundHandle, NullSound>()
  #nextHandle = 1
  #unlocked = false
  #masterVolume = 1
  #playCount = 0

  get unlocked(): boolean {
    return this.#unlocked
  }

  resume(): Promise<void> {
    this.#unlocked = true
    return Promise.resolve()
  }

  createClip(pcm: Float32Array, sampleRate: number): ClipHandle {
    if (pcm.length === 0) {
      throw new AudioBackendError('BAD_VALUE', 'createClip: pcm must not be empty')
    }
    if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) {
      throw new AudioBackendError('BAD_VALUE', `createClip: bad sampleRate ${sampleRate}`)
    }
    const handle = this.#nextHandle++
    this.#clips.set(handle, { samples: pcm.length, sampleRate })
    return handle
  }

  decode(bytes: ArrayBuffer): Promise<ClipHandle> {
    if (bytes.byteLength === 0) {
      return Promise.reject(new AudioBackendError('BAD_VALUE', 'decode: empty bytes'))
    }
    const handle = this.#nextHandle++
    this.#clips.set(handle, { samples: bytes.byteLength, sampleRate: 44100 })
    return Promise.resolve(handle)
  }

  disposeClip(clip: ClipHandle): void {
    if (!this.#clips.delete(clip)) {
      throw new AudioBackendError('UNKNOWN_HANDLE', `disposeClip: unknown clip handle ${clip}`)
    }
  }

  play(clip: ClipHandle, options?: PlayOptions): SoundHandle {
    if (!this.#clips.has(clip)) {
      throw new AudioBackendError('UNKNOWN_HANDLE', `play: unknown clip handle ${clip}`)
    }
    const handle = this.#nextHandle++
    this.#sounds.set(handle, {
      clip,
      options: {
        volume: options?.volume ?? 1,
        loop: options?.loop ?? false,
        playbackRate: options?.playbackRate ?? 1,
      },
    })
    this.#playCount++
    return handle
  }

  stop(sound: SoundHandle): void {
    this.#sounds.delete(sound) // idempotent by contract
  }

  stopAll(): void {
    this.#sounds.clear()
  }

  setMasterVolume(volume: number): void {
    this.#masterVolume = volume
  }

  dispose(): void {
    this.#sounds.clear()
    this.#clips.clear()
  }

  // --- inspection (tests/tooling; not part of the AudioBackend contract) -----

  get clipCount(): number {
    return this.#clips.size
  }

  get activeSoundCount(): number {
    return this.#sounds.size
  }

  get playCount(): number {
    return this.#playCount
  }

  get masterVolume(): number {
    return this.#masterVolume
  }

  soundOptions(sound: SoundHandle): Required<PlayOptions> | undefined {
    return this.#sounds.get(sound)?.options
  }
}
