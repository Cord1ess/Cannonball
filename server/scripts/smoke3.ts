import { Client, type Room } from '@colyseus/sdk'

/**
 * M3 deep smoke: THREE players through the arena flow — tick elimination,
 * restart handout with live targeting, arena morph, and the drop to DUEL.
 */
const endpoint = process.env.ENDPOINT ?? 'ws://localhost:2567'
const fail = (message: string): never => {
  console.error(`[smoke3] FAILED: ${message}`)
  process.exit(1)
}
const timeout = setTimeout(() => fail('timed out after 40s'), 40_000)

interface StateRead {
  phase: number
  survivors: number
  players: { get(id: string): { seat: number; alive: boolean } | undefined; size: number }
  handout: { elimSeat: number; advCardId: string; curseCardId: string; revealed: boolean }
}
const read = (room: Room): StateRead => room.state as unknown as StateRead
async function waitFor(cond: () => boolean, what: string, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms
  while (!cond()) {
    if (Date.now() > deadline) fail(`waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 60))
  }
}

const clients = [new Client(endpoint), new Client(endpoint), new Client(endpoint)]
const roomA = await clients[0]!.create('match', { fast: true })
const roomB = await clients[1]!.joinById(roomA.roomId)
const roomC = await clients[2]!.joinById(roomA.roomId)
const rooms = [roomA, roomB, roomC]
for (const r of rooms) r.onMessage('*', () => {})
console.log(`[smoke3] 3 players in ${roomA.roomId}`)

await waitFor(() => read(roomA).players.size === 3, 'all three in state')
roomA.send('start')
await waitFor(() => read(roomA).phase === 3, 'ARENA phase (3 players)', 25000)
console.log('[smoke3] arena live with 3 players')

// park the ball in A's wedge via debug, then wait for the tick to eliminate A
roomA.send('debug', { cmd: 'ballToMe' })
await waitFor(() => read(roomA).phase === 5, 'RESTART after tick elimination', 20000)
const handout = read(roomA).handout
if (!handout.advCardId || !handout.curseCardId) fail('handout cards not generated')
const elimSeat = handout.elimSeat
console.log(`[smoke3] seat ${elimSeat} eliminated, handout: ${handout.advCardId} / ${handout.curseCardId}`)

// the eliminated player assigns targets to the two survivors
const elimRoom = rooms.find((r) => read(roomA).players.get(r.sessionId)?.seat === elimSeat)
if (!elimRoom) fail('eliminated session not found')
const aliveSeats: number[] = []
for (const r of rooms) {
  const p = read(roomA).players.get(r.sessionId)
  if (p && p.alive) aliveSeats.push(p.seat)
}
if (aliveSeats.length !== 2) fail(`expected 2 alive, got ${aliveSeats.length}`)
elimRoom!.send('assign', { advTo: aliveSeats[0], curseTo: aliveSeats[1] })
await waitFor(() => read(roomA).handout.revealed, 'handout reveal')
console.log('[smoke3] handout assigned and revealed')

// restart -> launch -> two survivors -> DUEL
await waitFor(() => read(roomA).phase === 6, 'DUEL after morph', 15000)
console.log(`[smoke3] duel reached, survivors=${read(roomA).survivors}`)

for (const r of rooms) await r.leave()
clearTimeout(timeout)
console.log('[smoke3] OK — tick elimination, handout targeting, morph to duel all verified')
process.exit(0)
