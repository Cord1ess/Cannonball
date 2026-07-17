import { Client, type Room } from '@colyseus/sdk'

/**
 * Connects to the match server.
 *
 * RELOAD = SAME BEAN: the reconnection token is stashed in sessionStorage, so
 * a page refresh reconnects to the same seat through the server's grace
 * window instead of spawning a ghost + a new player.
 *
 * URL flags: `?fresh` forces a brand-new room (skips reconnect AND matchmaking
 * into existing rooms) · `?lag=100` delays every outgoing message by N ms.
 */

const TOKEN_KEY = 'cannonball:reconnection'
const WS_CLOSE_CONSENTED = 4000

export interface Connection {
  room: Room
  sessionId: string
  /** send with the artificial-lag toggle applied */
  send(type: string, payload?: unknown): void
}

export async function connect(): Promise<Connection> {
  const endpoint =
    (import.meta.env.VITE_SERVER_URL as string | undefined) ??
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`

  const client = new Client(endpoint)
  const params = new URLSearchParams(location.search)
  const fresh = params.has('fresh')

  let room: Room | null = null
  const stored = sessionStorage.getItem(TOKEN_KEY)
  if (stored && !fresh) {
    try {
      room = await client.reconnect(stored)
      console.log('[net] reconnected to previous session')
    } catch {
      sessionStorage.removeItem(TOKEN_KEY)
    }
  }
  room ??= fresh ? await client.create('match') : await client.joinOrCreate('match')

  sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken)
  room.onLeave((code) => {
    // a consented leave can't be reconnected to — drop the stale token
    if (code === WS_CLOSE_CONSENTED) sessionStorage.removeItem(TOKEN_KEY)
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
