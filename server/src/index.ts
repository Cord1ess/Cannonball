import { createServer } from 'node:http'
import { Server } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { MatchRoom } from './rooms/MatchRoom.ts'

const port = Number(process.env.PORT ?? 2567)

// No custom request handler: Colyseus 0.17 prepends its own router on this
// server (matchmaking + a built-in GET /__healthcheck — the Render/UptimeRobot
// keep-alive target). A handler of ours would race it on every request.
const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
})

gameServer.define('match', MatchRoom)

await gameServer.listen(port)
console.log(`[cannonball] server listening on :${port} (health: GET /__healthcheck)`)
