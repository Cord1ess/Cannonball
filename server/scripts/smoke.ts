import { Client } from '@colyseus/sdk'

/** Joins the local server, round-trips a ping, leaves. Exit 0 = healthy. */
const endpoint = process.env.ENDPOINT ?? 'ws://localhost:2567'

const timeout = setTimeout(() => {
  console.error('[smoke] FAILED: no pong within 5s')
  process.exit(1)
}, 5000)

const client = new Client(endpoint)
const room = await client.joinOrCreate('match')
console.log(`[smoke] joined room ${room.roomId} as ${room.sessionId}`)

const sent = Date.now()
const pong = new Promise<number>((resolve) => {
  room.onMessage('pong', (t: number) => resolve(t))
  room.onMessage('welcome', () => {}) // silence unhandled-message warning
})
room.send('ping', sent)
await pong
console.log(`[smoke] pong in ${Date.now() - sent}ms`)

await room.leave()
clearTimeout(timeout)
console.log('[smoke] OK')
process.exit(0)
