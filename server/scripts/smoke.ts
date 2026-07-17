import { Client, type Room } from '@colyseus/sdk'

/**
 * M3 smoke: drives the full match spine with two headless clients in a
 * fast-mode room (all pauses x0.15): LOBBY -> host start -> DRAFT (offers
 * received, picks sent) -> LAUNCH -> DUEL (2 players skip the arena straight
 * to sudden kickoff) -> inputs move the authoritative sims. Exit 0 = alive.
 */

const endpoint = process.env.ENDPOINT ?? 'ws://localhost:2567'

const fail = (message: string): never => {
  console.error(`[smoke] FAILED: ${message}`)
  process.exit(1)
}
const timeout = setTimeout(() => fail('timed out after 30s'), 30_000)

interface StateRead {
  phase: number
  phaseRemaining: number
  hostSessionId: string
  serverTime: number
  players: { get(id: string): PlayerRead | undefined; size: number }
  ball: { x: number; y: number }
}
interface PlayerRead {
  seat: number
  x: number
  z: number
  lastSeq: number
  alive: boolean
  cardAbility: string
}

const read = (room: Room): StateRead => room.state as unknown as StateRead

async function waitFor(cond: () => boolean, what: string, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms
  while (!cond()) {
    if (Date.now() > deadline) fail(`waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 60))
  }
}

const clientA = new Client(endpoint)
const clientB = new Client(endpoint)
const roomA = await clientA.create('match', { fast: true })
const roomB = await clientB.joinById(roomA.roomId)
console.log(`[smoke] A=${roomA.sessionId} B=${roomB.sessionId} room=${roomA.roomId} (fast)`)

let offersA = false
let offersB = false
roomA.onMessage('draftOffer', () => (offersA = true))
roomB.onMessage('draftOffer', () => (offersB = true))
roomA.onMessage('*', () => {})
roomB.onMessage('*', () => {})

await waitFor(() => !!read(roomA).players.get(roomB.sessionId), 'both players in state')
if (read(roomA).hostSessionId !== roomA.sessionId) fail('A should be host')

// LOBBY -> start
if (read(roomA).phase !== 0) fail(`expected Lobby(0), got ${read(roomA).phase}`)
roomA.send('start')
await waitFor(() => read(roomA).phase === 1, 'DRAFT phase')
console.log('[smoke] draft started')
await waitFor(() => offersA && offersB, 'draft offers delivered')
roomA.send('pick', { pool: 'ability', index: 0 })
roomB.send('pick', { pool: 'equipment', index: 1 })

// DRAFT auto-completes -> LAUNCH -> (2 players) DUEL
await waitFor(() => read(roomA).phase === 2, 'LAUNCH phase')
console.log('[smoke] launch countdown')
roomA.send('aim', { angle: 0.3 })
await waitFor(() => read(roomA).phase === 6, 'DUEL phase')
console.log('[smoke] sudden kickoff reached')

const meA = read(roomA).players.get(roomA.sessionId) ?? fail('A missing')
if (meA.cardAbility === '') fail('loadout not revealed at launch')

// let the cannon flight land before measuring
await new Promise((r) => setTimeout(r, 1200))
const startAx = (read(roomA).players.get(roomA.sessionId) ?? fail('A missing post-flight')).x

// drive A toward the FAR side (it spawns near +x) — clear displacement
let seqNum = 0
const driver = setInterval(() => {
  seqNum++
  roomA.send('input', { seq: seqNum, dirX: -1, dirZ: 0, jump: false, dive: false, sprint: true })
  roomB.send('input', { seq: seqNum, dirX: 0.5, dirZ: 0.5, jump: seqNum % 60 === 30, dive: false, sprint: false })
}, 1000 / 60)
await new Promise((r) => setTimeout(r, 2500))
clearInterval(driver)
await new Promise((r) => setTimeout(r, 200))

const a1 = read(roomA).players.get(roomA.sessionId) ?? fail('A vanished')
if (Math.abs(a1.x - startAx) < 3) fail(`A did not move in duel (${startAx.toFixed(1)} -> ${a1.x.toFixed(1)})`)
if (a1.lastSeq === 0) fail('inputs never acked')
console.log(
  `[smoke] duel live: A moved ${(a1.x - startAx).toFixed(1)}m, seq ${a1.lastSeq}, ball y=${read(roomA).ball.y.toFixed(2)}`,
)

await roomA.leave()
await roomB.leave()
clearTimeout(timeout)
console.log('[smoke] OK — lobby, draft, launch, duel all verified')
process.exit(0)
