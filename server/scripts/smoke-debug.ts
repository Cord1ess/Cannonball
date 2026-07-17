import { Client, type Room } from '@colyseus/sdk'

/**
 * Debug-tooling smoke: skipPhase drives lobby->draft->launch->arena with zero
 * waiting, botPlus/botMinus change the live player count mid-match (zones
 * repaint, no elimination ceremony), freeze stops the match clock.
 */
const endpoint = process.env.ENDPOINT ?? 'ws://localhost:2567'
const fail = (message: string): never => {
  console.error(`[smoke-debug] FAILED: ${message}`)
  process.exit(1)
}
const timeout = setTimeout(() => fail('timed out after 30s'), 30_000)

interface StateRead {
  phase?: number
  survivors?: number
  tickRemaining?: number
  players?: { size: number }
  zoneSeat?: { length: number }
}
const read = (room: Room): StateRead => room.state as unknown as StateRead
async function waitFor(cond: () => boolean, what: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms
  while (!cond()) {
    if (Date.now() > deadline) fail(`waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

const client = new Client(endpoint)
const room = await client.create('match') // NORMAL timers — skip must beat them
room.onMessage('*', () => {})
await waitFor(() => read(room).players?.size === 1, 'joined')

// lobby: two live bots, then skip drives the whole flow to the field
room.send('debug', { cmd: 'botPlus' })
room.send('debug', { cmd: 'botPlus' })
await waitFor(() => read(room).players?.size === 3, 'bots in lobby')
room.send('debug', { cmd: 'skipPhase' }) // lobby -> draft
await waitFor(() => read(room).phase === 1, 'draft')
room.send('debug', { cmd: 'skipPhase' }) // draft -> launch (auto-picks)
await waitFor(() => read(room).phase === 2, 'launch')
room.send('debug', { cmd: 'skipPhase' }) // launch -> arena
await waitFor(() => read(room).phase === 3, 'arena')
console.log('[smoke-debug] skipPhase: lobby -> arena with zero waiting')

// live player-count changes on the field
room.send('debug', { cmd: 'botPlus' })
await waitFor(() => read(room).survivors === 4 && read(room).zoneSeat?.length === 4, '4 live zones')
room.send('debug', { cmd: 'botMinus' })
await waitFor(() => read(room).survivors === 3 && read(room).zoneSeat?.length === 3, 'back to 3 zones')
if (read(room).phase !== 3) fail('live bot changes must not leave the arena phase')
console.log('[smoke-debug] botPlus/botMinus: zones morph live, no elimination ceremony')

// freeze: the tick clock stands still
room.send('debug', { cmd: 'freeze' })
await new Promise((r) => setTimeout(r, 300))
const t0 = read(room).tickRemaining ?? 0
await new Promise((r) => setTimeout(r, 900))
const t1 = read(room).tickRemaining ?? 0
if (Math.abs(t0 - t1) > 0.001) fail(`tick moved while frozen: ${t0} -> ${t1}`)
room.send('debug', { cmd: 'freeze' })
await waitFor(() => (read(room).tickRemaining ?? 99) < t1 - 0.2, 'clock resumed')
console.log('[smoke-debug] freeze: clock stopped and resumed')

// instantArena: one message = full live arena (the ?dev reload path)
const client2 = new Client(endpoint)
const room2 = await client2.create('match')
room2.onMessage('*', () => {})
await waitFor(() => read(room2).players?.size === 1, 'second room joined')
const sentAt = Date.now()
room2.send('debug', { cmd: 'instantArena' })
await waitFor(
  () => read(room2).phase === 3 && read(room2).players?.size === 6 && read(room2).survivors === 6,
  'instant live arena',
  4000,
)
console.log(`[smoke-debug] instantArena: live 6-bean arena in ${Date.now() - sentAt}ms`)
await room2.leave()

clearTimeout(timeout)
console.log('[smoke-debug] PASS')
await room.leave()
process.exit(0)
