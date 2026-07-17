import { Client, type Room } from '@colyseus/sdk'

/**
 * Connects to the match server. Dev latency toggle: `?lag=100` delays every
 * outgoing message by N ms so prediction/reconciliation stay honest.
 */

export interface Connection {
  room: Room
  sessionId: string
  /** send with the artificial-lag toggle applied */
  send(type: string, payload: unknown): void
}

export async function connect(): Promise<Connection> {
  const endpoint =
    (import.meta.env.VITE_SERVER_URL as string | undefined) ??
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`

  const client = new Client(endpoint)
  const room = await client.joinOrCreate('match')

  const lag = Number(new URLSearchParams(location.search).get('lag') ?? 0)
  const send =
    lag > 0
      ? (type: string, payload: unknown): void => {
          setTimeout(() => room.send(type, payload), lag)
        }
      : (type: string, payload: unknown): void => {
          room.send(type, payload)
        }

  return { room, sessionId: room.sessionId, send }
}
