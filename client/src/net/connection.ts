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
 * URL flags: `?fresh` forces a brand-new room · `?lag=100` delays sends N ms.
 */

const TOKEN_KEY = 'cannonball:reconnection'
const WS_CLOSE_CONSENTED = 4000

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
  const endpoint =
    (import.meta.env.VITE_SERVER_URL as string | undefined) ??
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`

  const client = new Client(endpoint)
  const params = new URLSearchParams(location.search)
  const fresh = params.has('fresh')

  let room: Room | null = null

  // 1) try to resume the previous session (time-boxed)
  const stored = sessionStorage.getItem(TOKEN_KEY)
  if (stored && !fresh) {
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
      ? await withTimeout(client.create('match'), 6000, 'create')
      : await withTimeout(client.joinOrCreate('match'), 6000, 'join')
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
    room = await withTimeout(client.joinOrCreate('match'), 6000, 'rejoin')
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
