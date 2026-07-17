import { Client, type Room } from '@colyseus/sdk'

/**
 * M4b smoke: jersey flow — default kits on join, the lobby 'kit' message,
 * clash resolution (same pick -> later seat wears away), bot defaults,
 * lock after match start.
 */
const endpoint = process.env.ENDPOINT ?? 'ws://localhost:2567'
const fail = (message: string): never => {
  console.error(`[smoke-kits] FAILED: ${message}`)
  process.exit(1)
}
const timeout = setTimeout(() => fail('timed out after 30s'), 30_000)

interface PlayerRead {
  seat: number
  kitId: string
  kitAway: boolean
  bot: boolean
}
interface StateRead {
  phase: number
  players: {
    get(id: string): PlayerRead | undefined
    forEach(cb: (p: PlayerRead, id: string) => void): void
    size: number
  }
}
const read = (room: Room): StateRead => room.state as unknown as StateRead
async function waitFor(cond: () => boolean, what: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms
  while (!cond()) {
    if (Date.now() > deadline) fail(`waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 60))
  }
}
const players = (room: Room): PlayerRead[] => {
  const list: PlayerRead[] = []
  read(room).players.forEach((p) => list.push({ ...p }))
  return list.sort((a, b) => a.seat - b.seat)
}

const clients = [new Client(endpoint), new Client(endpoint)]
const roomA = await clients[0]!.create('match', { fast: true })
const roomB = await clients[1]!.joinById(roomA.roomId)
for (const r of [roomA, roomB]) r.onMessage('*', () => {})
await waitFor(() => read(roomA).players.size === 2, 'both players in state')

// 1. defaults by seat: crimson / azure, both home
await waitFor(() => players(roomA).every((p) => p.kitId !== ''), 'default kits assigned')
let list = players(roomA)
if (list[0]!.kitId !== 'crimson' || list[1]!.kitId !== 'azure') {
  fail(`default kits wrong: ${list.map((p) => p.kitId).join(', ')}`)
}
if (list.some((p) => p.kitAway)) fail('defaults should not clash')
console.log('[smoke-kits] defaults ok (crimson, azure — both home)')

// 2. B picks A's kit -> B (later seat) flips to the away variant
roomB.send('kit', { id: 'crimson' })
await waitFor(() => players(roomA)[1]?.kitId === 'crimson', 'B kit applied')
list = players(roomA)
if (list[0]!.kitAway) fail('seat 0 should keep home priority')
if (!list[1]!.kitAway) fail('seat 1 picked the same kit and should wear away')
console.log('[smoke-kits] clash ok (both crimson -> seat 1 away)')

// 3. B moves to a free kit -> back to home
roomB.send('kit', { id: 'mono' })
await waitFor(() => players(roomA)[1]?.kitId === 'mono', 'B re-pick applied')
if (players(roomA)[1]!.kitAway) fail('mono does not clash with crimson')

// invalid kit id is ignored
roomB.send('kit', { id: 'realmadrid' })
await new Promise((r) => setTimeout(r, 300))
if (players(roomA)[1]!.kitId !== 'mono') fail('invalid kit id must be ignored')
console.log('[smoke-kits] re-pick + invalid-id guard ok')

// 4. bots fill with seat defaults
roomA.send('fillBots')
await waitFor(() => read(roomA).players.size === 6, 'bots filled')
list = players(roomA)
const bots = list.filter((p) => p.bot)
if (bots.length !== 4) fail(`expected 4 bots, got ${bots.length}`)
if (bots.some((p) => p.kitId === '')) fail('bots must get default kits')
console.log(`[smoke-kits] bot kits: ${bots.map((p) => `${p.kitId}${p.kitAway ? '(away)' : ''}`).join(', ')}`)

// 5. kits lock once the match starts
roomA.send('start')
await waitFor(() => read(roomA).phase !== 0, 'match started')
roomB.send('kit', { id: 'rose' })
await new Promise((r) => setTimeout(r, 300))
if (players(roomA)[1]!.kitId !== 'mono') fail('kit must be locked after match start')
console.log('[smoke-kits] kits locked after start')

clearTimeout(timeout)
console.log('[smoke-kits] PASS')
await roomA.leave()
await roomB.leave()
process.exit(0)
