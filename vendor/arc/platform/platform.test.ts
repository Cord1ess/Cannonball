import { describe, expect, it } from 'vitest'
import {
  exitFullscreen,
  isFullscreen,
  requestFullscreen,
  requestPointerLock,
} from './fullscreen.ts'
import { createIndexedDbSaveStore, createMemorySaveStore, PlatformError } from './save-data.ts'
import { installAutoplayUnlock, type GestureTarget } from './unlock.ts'
import { onVisibilityChange, type VisibilityDocument } from './visibility.ts'

function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>()
  const target: GestureTarget = {
    addEventListener: (type, listener) => {
      let set = listeners.get(type)
      if (set === undefined) listeners.set(type, (set = new Set()))
      set.add(listener)
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
  }
  const fire = (type: string): void => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener()
  }
  const count = (): number => [...listeners.values()].reduce((n, set) => n + set.size, 0)
  return { target, fire, count }
}

describe('installAutoplayUnlock', () => {
  it('unlocks on the FIRST gesture only and detaches all listeners', async () => {
    const { target, fire, count } = fakeTarget()
    let unlocks = 0
    installAutoplayUnlock(() => {
      unlocks++
    }, target)
    expect(count()).toBe(3) // pointerdown, keydown, touchend

    fire('keydown')
    fire('pointerdown') // second gesture — already unlocked and detached
    await Promise.resolve()
    expect(unlocks).toBe(1)
    expect(count()).toBe(0)
  })

  it('dispose disarms without unlocking; a throwing unlock is contained', () => {
    const { target, fire, count } = fakeTarget()
    let unlocks = 0
    const dispose = installAutoplayUnlock(() => {
      unlocks++
    }, target)
    dispose()
    fire('keydown')
    expect(unlocks).toBe(0)
    expect(count()).toBe(0)

    installAutoplayUnlock(() => {
      throw new Error('resume failed')
    }, target)
    expect(() => fire('pointerdown')).not.toThrow()
  })
})

describe('onVisibilityChange', () => {
  it('reports the current state immediately, then follows change events', () => {
    const listeners = new Set<() => void>()
    let state = 'visible'
    const doc: VisibilityDocument = {
      get visibilityState() {
        return state
      },
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    }
    const seen: boolean[] = []
    const dispose = onVisibilityChange(doc, (visible) => seen.push(visible))
    expect(seen).toEqual([true]) // immediate

    state = 'hidden'
    for (const listener of listeners) listener()
    expect(seen).toEqual([true, false])

    dispose()
    expect(listeners.size).toBe(0)
  })
})

describe('fullscreen + pointer lock wrappers', () => {
  it('resolve to booleans: granted, denied, unsupported', async () => {
    expect(await requestFullscreen({ requestFullscreen: () => Promise.resolve() })).toBe(true)
    expect(await requestFullscreen({ requestFullscreen: () => Promise.reject(new Error('no gesture')) })).toBe(false)
    expect(await requestFullscreen({})).toBe(false) // unsupported

    expect(await requestPointerLock({ requestPointerLock: () => undefined })).toBe(true)
    expect(await requestPointerLock({})).toBe(false)
  })

  it('exit is safe in every state', async () => {
    await exitFullscreen({}) // no API at all
    await exitFullscreen({ fullscreenElement: null, exitFullscreen: () => Promise.resolve() })
    let exited = false
    await exitFullscreen({
      fullscreenElement: {},
      exitFullscreen: () => {
        exited = true
        return Promise.resolve()
      },
    })
    expect(exited).toBe(true)
    expect(isFullscreen({ fullscreenElement: {} })).toBe(true)
    expect(isFullscreen({ fullscreenElement: null })).toBe(false)
  })
})

describe('createMemorySaveStore', () => {
  it('round-trips values with clone isolation', async () => {
    const store = createMemorySaveStore()
    const saved = { level: 3, unlocked: ['sword', 'map'] }
    await store.set('progress', saved)
    saved.level = 99 // mutating the original must not touch the store

    const loaded = (await store.get('progress')) as typeof saved
    expect(loaded.level).toBe(3)
    loaded.unlocked.push('hacked') // nor must mutating the loaded copy
    expect(((await store.get('progress')) as typeof saved).unlocked).toEqual(['sword', 'map'])

    expect(await store.get('missing')).toBeUndefined()
    expect(await store.keys()).toEqual(['progress'])
    await store.remove('progress')
    expect(await store.keys()).toEqual([])
  })

  it('rejects uncloneable values with a typed error', async () => {
    const store = createMemorySaveStore()
    await expect(store.set('bad', () => {})).rejects.toThrowError(PlatformError)
  })
})

describe('createIndexedDbSaveStore', () => {
  it('teaches instead of crashing where IndexedDB does not exist (Node CI)', () => {
    expect(() => createIndexedDbSaveStore('game')).toThrowError(PlatformError)
    try {
      createIndexedDbSaveStore('game')
    } catch (error) {
      expect((error as PlatformError).code).toBe('UNSUPPORTED')
    }
  })
})
