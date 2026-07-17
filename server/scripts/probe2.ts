import { Client } from '@colyseus/sdk'
const client = new Client('ws://localhost:2567')
const room = await client.create('match')
let fires = 0
let messageCount = 0
room.onStateChange(() => fires++)
room.onMessage('*', () => messageCount++)
room.send('input', { seq: 1, dirX: 1, dirZ: 0, jump: false, dive: false, sprint: false })
await new Promise((r) => setTimeout(r, 2000))
const state = room.state as any
console.log('[probe2] onStateChange fires in 2s:', fires)
console.log('[probe2] wildcard messages:', messageCount)
console.log('[probe2] players.size via raw state:', state.players?.size)
console.log('[probe2] me present:', !!state.players?.get?.(room.sessionId))
await room.leave()
process.exit(0)
