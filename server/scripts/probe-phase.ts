import { Client } from '@colyseus/sdk'
const client = new Client('ws://localhost:2567')
const room = await client.create('match', { fast: true })
await new Promise((r) => setTimeout(r, 800))
const state = room.state as any
console.log('[probe] phase field:', state.phase, '| hostSessionId:', state.hostSessionId ?? '(missing)')
console.log('[probe] verdict:', state.phase === undefined ? 'OLD SERVER CODE (M2) on port 2567' : 'M3 server running correctly')
await room.leave()
process.exit(0)
