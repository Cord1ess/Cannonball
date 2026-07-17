import { Client } from '@colyseus/sdk'
const client = new Client('ws://localhost:2567')
const room = await client.joinOrCreate('match')
console.log(`[probe] joined ${room.roomId} as ${room.sessionId}`)
await new Promise((r) => setTimeout(r, 1200))
const state = room.state as any
console.log('[probe] serverTime', state.serverTime?.toFixed?.(2), 'tick', state.tickRemaining?.toFixed?.(1))
console.log('[probe] ball', JSON.stringify({ x: state.ball?.x, y: state.ball?.y, z: state.ball?.z }))
console.log('[probe] players size', state.players?.size)
state.players?.forEach?.((p: any, id: string) => {
  console.log(`[probe]   ${id} seat=${p.seat} pos=(${p.x?.toFixed?.(1)},${p.z?.toFixed?.(1)}) alive=${p.alive} connected=${p.connected}`)
})
await room.leave()
process.exit(0)
