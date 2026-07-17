import { AudioBackendError, type AudioBackend, type ClipHandle, type PlayOptions, type SoundHandle } from './backend.ts'

export interface WebAudioBackendOptions {
  /** Inject a context (tests, offline rendering); defaults to a new AudioContext. */
  readonly context?: AudioContext
}

/**
 * Backend #1: the real WebAudio graph. One master gain feeds the
 * destination; each sound is a BufferSource → per-sound gain → master.
 * Contexts start suspended until a user gesture — wire resume() through
 * @arc/platform's installAutoplayUnlock.
 */
export function createWebAudioBackend(options?: WebAudioBackendOptions): AudioBackend {
  if (options?.context === undefined && typeof AudioContext === 'undefined') {
    throw new AudioBackendError(
      'UNSUPPORTED',
      'createWebAudioBackend: no AudioContext in this environment — use NullAudioBackend for headless runs',
    )
  }
  const context = options?.context ?? new AudioContext()
  const master = context.createGain()
  master.connect(context.destination)

  const clips = new Map<ClipHandle, AudioBuffer>()
  const sounds = new Map<SoundHandle, AudioBufferSourceNode>()
  let nextHandle = 1

  function clipOf(handle: ClipHandle, context_: string): AudioBuffer {
    const clip = clips.get(handle)
    if (clip === undefined) {
      throw new AudioBackendError('UNKNOWN_HANDLE', `${context_}: unknown clip handle ${handle}`)
    }
    return clip
  }

  return {
    get unlocked(): boolean {
      return context.state === 'running'
    },

    async resume(): Promise<void> {
      await context.resume()
    },

    createClip(pcm: Float32Array, sampleRate: number): ClipHandle {
      if (pcm.length === 0) {
        throw new AudioBackendError('BAD_VALUE', 'createClip: pcm must not be empty')
      }
      if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) {
        throw new AudioBackendError('BAD_VALUE', `createClip: bad sampleRate ${sampleRate}`)
      }
      const buffer = context.createBuffer(1, pcm.length, sampleRate)
      // copy pins the data to a plain ArrayBuffer (engine contracts stay buffer-agnostic)
      buffer.copyToChannel(new Float32Array(pcm), 0)
      const handle = nextHandle++
      clips.set(handle, buffer)
      return handle
    },

    async decode(bytes: ArrayBuffer): Promise<ClipHandle> {
      if (bytes.byteLength === 0) {
        throw new AudioBackendError('BAD_VALUE', 'decode: empty bytes')
      }
      const buffer = await context.decodeAudioData(bytes.slice(0))
      const handle = nextHandle++
      clips.set(handle, buffer)
      return handle
    },

    disposeClip(clip: ClipHandle): void {
      clipOf(clip, 'disposeClip')
      clips.delete(clip)
    },

    play(clip: ClipHandle, options?: PlayOptions): SoundHandle {
      const buffer = clipOf(clip, 'play')
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = options?.loop ?? false
      source.playbackRate.value = options?.playbackRate ?? 1
      const gain = context.createGain()
      gain.gain.value = options?.volume ?? 1
      source.connect(gain)
      gain.connect(master)
      const handle = nextHandle++
      sounds.set(handle, source)
      source.onended = () => {
        sounds.delete(handle)
        source.disconnect()
        gain.disconnect()
      }
      source.start()
      return handle
    },

    stop(sound: SoundHandle): void {
      // idempotent by contract — finished sounds already left the map
      sounds.get(sound)?.stop()
    },

    stopAll(): void {
      for (const source of [...sounds.values()]) source.stop()
    },

    setMasterVolume(volume: number): void {
      master.gain.value = volume
    },

    dispose(): void {
      for (const source of [...sounds.values()]) source.stop()
      sounds.clear()
      clips.clear()
      void context.close().catch(() => undefined)
    },
  }
}
