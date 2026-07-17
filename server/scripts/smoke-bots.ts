import { Client, type Room } from '@colyseus/sdk'

/** Solo + 5 bots: the match must play itself through eliminations to the duel. */
const endpoint = process.env.ENDPOINT ?? 'ws://localhost:2567'
const fail = (m: string): never => {
  console.error(`[smoke-bots] FAILED: ${m}`)
  process.exit(1)
}
const timeout = setTimeout(() => fail('timed out after 120s'), 120_000)

interface StateRead {
  phase: number
  survivors: number
  players: { size: number }
}
const read = (room: Room): StateRead => room.state as unknown as StateRead
async function waitFor(cond: () => boolean, what: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (!cond()) {
    if (Date.now() > deadline) fail(`waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

const client = new Client(endpoint)
const room = await client.create('match', { fast: true })
room.onMessage('*', () => {})
await new Promise((r) => setTimeout(r, 400))
room.send('fillBots')
await waitFor(() => read(room).players.size === 6, '6 seats filled', 5000)
console.log('[smoke-bots] lobby full: 1 human + 5 bots')
room.send('start')
await waitFor(() => read(room).phase === 3, 'ARENA', 20000)
console.log('[smoke-bots] arena live, bots playing')
await waitFor(() => read(room).phase === 5, 'first elimination (RESTART)', 40000)
console.log(`[smoke-bots] first elimination happened, survivors=${read(room).survivors}`)
await waitFor(() => read(room).phase === 6 || read(room).phase === 7, 'DUEL or END', 90000)
console.log(`[smoke-bots] match progressed to phase ${read(room).phase}, survivors=${read(room).survivors}`)
await room.leave()
clearTimeout(timeout)
console.log('[smoke-bots] OK — bots carry a full match on their own')
process.exit(0)
