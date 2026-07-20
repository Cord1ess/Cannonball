import { Client, type Room } from '@colyseus/sdk'

/**
 * Connects to the match server.
 *
 * RELOAD = SAME BEAN: the reconnection token is stashed in sessionStorage, so
 * a page refresh reconnects to the same seat through the server's grace
 * window instead of spawning a ghost + a new player.
 *
 * Hardened: the reconnect attempt is time-boxed, and EVERY join is verified —
 * if our player never appears in replicated state, the zombie connection is
 * dropped and we retry with a clean join. An empty frozen world can't happen.
 *
 * URL flags: `?fresh` forces a brand-new room · `?lag=100` delays sends N ms
 * · `?fast` creates the room with 0.15x phase timers (dev iteration)
 * · `?server=wss://host` points the client at a specific server (tunnels).
 *
 * SERVER RESOLUTION (first match wins):
 *   1. ?server=... in the URL (share this to friends)
 *   2. a value saved from the lobby's server field (localStorage)
 *   3. VITE_SERVER_URL build env
 *   4. same host as the page on :2567 (local play)
 */

const TOKEN_KEY = 'cannonball:reconnection'
const SERVER_KEY = 'cannonball:server'
const WS_CLOSE_CONSENTED = 4000
// PARTY intent (set by the menu, honored on the next boot):
//   'create'    -> make a fresh PRIVATE room; the creator is host + gets a code
//   '<roomId>'  -> join THAT specific room by id (a shared party code)
const PARTY_KEY = 'cannonball:party'

/** Ask for a fresh private party on the next reload (menu → "Create Party"). */
export function requestCreateParty(): void {
  sessionStorage.setItem(PARTY_KEY, 'create')
  sessionStorage.removeItem(TOKEN_KEY) // don't resume the old seat
}
/** Ask to join a specific party room id on the next reload (menu → "Join"). */
export function requestJoinParty(code: string): void {
  const c = code.trim()
  if (!c) return
  sessionStorage.setItem(PARTY_KEY, c)
  sessionStorage.removeItem(TOKEN_KEY)
}

/** Normalize a user-typed address into a ws/wss URL. Accepts bare host,
 *  host:port, http(s)://, or ws(s)://. Tunnels (https) -> wss automatically. */
export function normalizeServerUrl(raw: string): string {
  let s = raw.trim()
  if (!s) return ''
  // strip a trailing slash
  s = s.replace(/\/+$/, '')
  if (s.startsWith('ws://') || s.startsWith('wss://')) return s
  if (s.startsWith('https://')) return 'wss://' + s.slice('https://'.length)
  if (s.startsWith('http://')) return 'ws://' + s.slice('http://'.length)
  // bare host[:port] — a public tunnel host has no port and wants wss
  const hasPort = /:\d+$/.test(s)
  return (hasPort ? 'ws://' : 'wss://') + s
}

/** The server URL the client should use, applying the resolution order. */
export function resolveServerUrl(): string {
  const params = new URLSearchParams(location.search)
  const fromParam = params.get('server')
  if (fromParam) {
    const url = normalizeServerUrl(fromParam)
    localStorage.setItem(SERVER_KEY, url) // remember it for reloads
    return url
  }
  const saved = localStorage.getItem(SERVER_KEY)
  if (saved) return saved
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined
  if (fromEnv) return fromEnv
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`
}

/** Persist a server URL chosen in the lobby field (for the next reload). */
export function saveServerUrl(raw: string): string {
  const url = normalizeServerUrl(raw)
  if (url) localStorage.setItem(SERVER_KEY, url)
  else localStorage.removeItem(SERVER_KEY)
  return url
}

/** The currently-resolved server URL, for display in the lobby field. */
export function currentServerUrl(): string {
  return resolveServerUrl()
}

export interface Connection {
  room: Room
  sessionId: string
  /** send with the artificial-lag toggle applied */
  send(type: string, payload?: unknown): void
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ])
}

/** resolves once our sessionId shows up in replicated state; false = zombie */
async function stateArrives(room: Room, ms: number): Promise<boolean> {
  const deadline = performance.now() + ms
  for (;;) {
    const players = (room.state as { players?: { get(id: string): unknown } })?.players
    if (players?.get?.(room.sessionId)) return true
    if (performance.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export async function connect(): Promise<Connection> {
  const endpoint = resolveServerUrl()
  console.log(`[net] connecting to ${endpoint}`)

  const client = new Client(endpoint)
  const params = new URLSearchParams(location.search)
  // dev implies fresh: every reload is a brand-new instant arena, never a
  // reconnect into a spectator seat
  const fresh = params.has('fresh') || params.has('dev')
  // dev implies fast: restart pauses shrink too while iterating
  const roomOptions = params.has('fast') || params.has('dev') ? { fast: true } : {}

  let room: Room | null = null

  // 0) PARTY intent takes priority — a one-shot from the menu (create/join code).
  const party = sessionStorage.getItem(PARTY_KEY)
  sessionStorage.removeItem(PARTY_KEY) // consume it (one boot only)
  if (party === 'create') {
    room = await withTimeout(client.create('match', roomOptions), 6000, 'create-party')
  } else if (party) {
    // join a specific room by its code; fall back to a fresh room if it's gone
    try {
      room = await withTimeout(client.joinById(party, roomOptions), 6000, 'join-party')
    } catch (error) {
      console.warn(`[net] party ${party} unavailable (full/ended), creating a new one:`, error)
      room = await withTimeout(client.create('match', roomOptions), 6000, 'create-fallback')
    }
  }

  // 1) try to resume the previous session (time-boxed)
  const stored = sessionStorage.getItem(TOKEN_KEY)
  if (!room && stored && !fresh) {
    try {
      room = await withTimeout(client.reconnect(stored), 4000, 'reconnect')
      console.log('[net] reconnected to previous session')
    } catch (error) {
      console.warn('[net] reconnect failed, joining fresh:', error)
      sessionStorage.removeItem(TOKEN_KEY)
      room = null
    }
  }

  // 2) fresh join (with one verified retry against zombie connections)
  for (let attempt = 0; attempt < 2 && !room; attempt++) {
    room = fresh
      ? await withTimeout(client.create('match', roomOptions), 6000, 'create')
      : await withTimeout(client.joinOrCreate('match', roomOptions), 6000, 'join')
    if (!(await stateArrives(room, 3000))) {
      console.warn('[net] joined but state never arrived — dropping zombie connection, retrying')
      try {
        await room.leave(false)
      } catch {
        /* already dead */
      }
      room = null
    }
  }
  if (!room) throw new Error('could not establish a live room connection')

  // 3) verify the reconnect path too — a resumed session must also stream state
  if (!(await stateArrives(room, 3000))) {
    console.warn('[net] reconnected session is stale — abandoning it for a clean join')
    sessionStorage.removeItem(TOKEN_KEY)
    try {
      await room.leave(true)
    } catch {
      /* already dead */
    }
    room = await withTimeout(client.joinOrCreate('match', roomOptions), 6000, 'rejoin')
    if (!(await stateArrives(room, 3000))) throw new Error('server replicates no state')
  }

  sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken)
  room.onLeave((code) => {
    console.log(`[net] left room (code ${code})`)
    if (code === WS_CLOSE_CONSENTED) sessionStorage.removeItem(TOKEN_KEY)
  })
  room.onError((code, message) => {
    console.error(`[net] room error ${code}: ${message}`)
  })

  const lag = Number(params.get('lag') ?? 0)
  const send =
    lag > 0
      ? (type: string, payload?: unknown): void => {
          setTimeout(() => room.send(type, payload), lag)
        }
      : (type: string, payload?: unknown): void => {
          room.send(type, payload)
        }

  return { room, sessionId: room.sessionId, send }
}
