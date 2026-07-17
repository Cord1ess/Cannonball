import { describe, expect, it } from 'vitest'
import { AudioBackendError } from './backend.ts'
import { runAudioBackendContract } from './contract.ts'
import { NullAudioBackend } from './null-backend.ts'
import { createWebAudioBackend } from './webaudio-backend.ts'

describe('NullAudioBackend', () => {
  it('passes the audio backend contract', async () => {
    await runAudioBackendContract(() => new NullAudioBackend())
  })

  it('starts locked (mirrors the browser autoplay gate) and records playback', async () => {
    const backend = new NullAudioBackend()
    expect(backend.unlocked).toBe(false)
    await backend.resume()
    expect(backend.unlocked).toBe(true)

    const clip = backend.createClip(new Float32Array([0, 0.5, -0.5]), 44100)
    const sound = backend.play(clip, { volume: 0.3, loop: true })
    expect(backend.playCount).toBe(1)
    expect(backend.activeSoundCount).toBe(1)
    expect(backend.soundOptions(sound)).toEqual({ volume: 0.3, loop: true, playbackRate: 1 })

    backend.stop(sound)
    expect(backend.activeSoundCount).toBe(0)
    backend.setMasterVolume(0.5)
    expect(backend.masterVolume).toBe(0.5)
  })
})

describe('createWebAudioBackend', () => {
  it('teaches instead of crashing where WebAudio does not exist (Node CI)', () => {
    expect(() => createWebAudioBackend()).toThrowError(AudioBackendError)
    try {
      createWebAudioBackend()
    } catch (error) {
      expect((error as AudioBackendError).code).toBe('UNSUPPORTED')
    }
  })
})
