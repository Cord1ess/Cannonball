import { AudioBackendError, type AudioBackend } from './backend.ts'

/**
 * The reusable audio-backend contract suite (vitest-free, like rendering and
 * physics): handle semantics, validation, the play/stop lifecycle rules, and
 * the deliberate asymmetry — clip disposal is strict, sound stopping is
 * idempotent (sounds end on their own; erroring would make every stop racy).
 * NullAudioBackend runs it in Node CI; the WebAudio backend runs it in a
 * browser harness.
 */
export async function runAudioBackendContract(createBackend: () => AudioBackend): Promise<void> {
  clipLifecycle(createBackend())
  playAndStopSemantics(createBackend())
  await decodeValidation(createBackend())
  await unlockFlow(createBackend())
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`audio backend contract violated: ${message}`)
}

function expectError(fn: () => void, code: string, message: string): void {
  try {
    fn()
  } catch (error) {
    check(error instanceof AudioBackendError, `${message} — expected AudioBackendError`)
    check((error as AudioBackendError).code === code, `${message} — expected code ${code}`)
    return
  }
  check(false, `${message} — expected a throw`)
}

function tone(samples = 128): Float32Array {
  const pcm = new Float32Array(samples)
  for (let i = 0; i < samples; i++) pcm[i] = Math.sin((i / samples) * Math.PI * 2)
  return pcm
}

function clipLifecycle(backend: AudioBackend): void {
  expectError(() => backend.createClip(new Float32Array(0), 44100), 'BAD_VALUE', 'empty pcm')
  expectError(() => backend.createClip(tone(), 0), 'BAD_VALUE', 'zero sample rate')

  const a = backend.createClip(tone(), 44100)
  const b = backend.createClip(tone(), 22050)
  check(a !== b, 'clip handles must be unique')
  backend.disposeClip(a)
  expectError(() => backend.disposeClip(a), 'UNKNOWN_HANDLE', 'double-disposing a clip')
  expectError(() => backend.play(a), 'UNKNOWN_HANDLE', 'playing a disposed clip')
  backend.disposeClip(b)
  backend.dispose()
}

function playAndStopSemantics(backend: AudioBackend): void {
  const clip = backend.createClip(tone(), 44100)
  const first = backend.play(clip, { volume: 0.5, loop: true })
  const second = backend.play(clip, { playbackRate: 2 })
  check(first !== second, 'sound handles must be unique')

  backend.stop(first)
  backend.stop(first) // idempotent by contract
  backend.stop(999999) // unknown sounds are a no-op, never an error

  backend.setMasterVolume(0.25)
  backend.stopAll()
  backend.dispose()
}

async function decodeValidation(backend: AudioBackend): Promise<void> {
  let rejected = false
  try {
    await backend.decode(new ArrayBuffer(0))
  } catch (error) {
    rejected = error instanceof AudioBackendError && error.code === 'BAD_VALUE'
  }
  check(rejected, 'decoding empty bytes must reject with BAD_VALUE')
  backend.dispose()
}

async function unlockFlow(backend: AudioBackend): Promise<void> {
  await backend.resume()
  check(backend.unlocked, 'after resume() the backend must report unlocked')
  backend.dispose()
}
