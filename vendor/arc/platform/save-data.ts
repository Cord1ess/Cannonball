/**
 * Save-data (BLUEPRINT §17): a small async KV store for game saves.
 * IndexedDB in browsers (localStorage is synchronous and quota-starved),
 * memory for tests/SSR, one interface for gameplay code. Values must be
 * structured-cloneable; quota exhaustion surfaces as a TYPED error so games
 * can react (prune saves, warn the player) instead of crashing.
 */

export interface SaveStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}

export type PlatformErrorCode = 'UNSUPPORTED' | 'QUOTA_EXCEEDED' | 'BAD_VALUE'

export class PlatformError extends Error {
  readonly code: PlatformErrorCode

  constructor(code: PlatformErrorCode, message: string) {
    super(message)
    this.name = 'PlatformError'
    this.code = code
  }
}

/** In-memory store with clone isolation — tests, previews, headless runs. */
export function createMemorySaveStore(): SaveStore {
  const data = new Map<string, unknown>()
  return {
    get: (key) => Promise.resolve(data.has(key) ? structuredClone(data.get(key)) : undefined),
    set(key, value) {
      try {
        data.set(key, structuredClone(value))
      } catch {
        return Promise.reject(
          new PlatformError('BAD_VALUE', `set "${key}": value is not structured-cloneable`),
        )
      }
      return Promise.resolve()
    },
    remove(key) {
      data.delete(key)
      return Promise.resolve()
    },
    keys: () => Promise.resolve([...data.keys()]),
    clear() {
      data.clear()
      return Promise.resolve()
    },
  }
}

/** The store name is per game/app; one object store holds the KV pairs. */
export function createIndexedDbSaveStore(name: string, factory?: IDBFactory): SaveStore {
  const idb = factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (idb === undefined) {
    throw new PlatformError(
      'UNSUPPORTED',
      'createIndexedDbSaveStore: no IndexedDB in this environment — use createMemorySaveStore',
    )
  }

  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(`arc-save:${name}`, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('kv')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })

  async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database
    return new Promise<T>((resolve, reject) => {
      const request = op(db.transaction('kv', mode).objectStore('kv'))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        const error = request.error
        reject(
          error?.name === 'QuotaExceededError'
            ? new PlatformError('QUOTA_EXCEEDED', 'save-data quota exceeded — remove saves or request persistence')
            : (error ?? new Error('IndexedDB request failed')),
        )
      }
    })
  }

  return {
    get: (key) => run('readonly', (store) => store.get(key)),
    set: async (key, value) => {
      await run('readwrite', (store) => store.put(value, key))
    },
    remove: async (key) => {
      await run('readwrite', (store) => store.delete(key))
    },
    keys: async () => {
      const keys = await run('readonly', (store) => store.getAllKeys())
      return keys.map(String)
    },
    clear: async () => {
      await run('readwrite', (store) => store.clear())
    },
  }
}
