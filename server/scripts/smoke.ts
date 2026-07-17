import { Client, type Room } from '@colyseus/sdk'

/**
 * M2 smoke: two headless clients join, drive inputs for ~3s, and we assert
 * the authoritative sim moved both players, the ball exists, seats differ,
 * lastSeq acks flow, and serverTime advances. Exit 0 = netcode alive.
 */

const endpoint = process.env.ENDPOINT ?? 'ws://localhost:2567'

const fail = (message: string): never => {
  console.error(`[smoke] FAILED: ${message}`)
  process.exit(1)
}

const timeout = setTimeout(() => fail('timed out after 15s'), 15_000)

interface StateRead {
  serverTime: number
  tickRemaining: number
  players: { get(id: string): PlayerRead | undefined; size: number }
  ball: { x: number; y: number; z: number }
}
interface PlayerRead {
  seat: number
  x: number
  z: number
  lastSeq: number
  stamina: number
}

const read = (room: Room): StateRead => room.state as unknown as StateRead

const clientA = new Client(endpoint)
const clientB = new Client(endpoint)
// create() (not joinOrCreate) — a FRESH room, immune to ghost sessions still
// in their reconnection grace window from earlier crashed runs
const roomA = await clientA.create('match')
const roomB = await clientB.joinById(roomA.roomId)
console.log(`[smoke] A=${roomA.sessionId} B=${roomB.sessionId} in room ${roomA.roomId}`)

// wait for BOTH session ids to replicate
await new Promise<void>((resolve) => {
  const check = (): void => {
    const players = read(roomA).players
    if (players?.get(roomA.sessionId) && players?.get(roomB.sessionId)) resolve()
    else setTimeout(check, 50)
  }
  check()
})

const a0 = read(roomA).players.get(roomA.sessionId) ?? fail('A missing from state')
const b0 = read(roomA).players.get(roomB.sessionId) ?? fail('B missing from state')
if (a0.seat === b0.seat) fail(`both got seat ${a0.seat}`)
const startAx = a0.x
const startBx = b0.x
const t0 = read(roomA).serverTime

// drive: A runs +x-ish, B runs -x-ish and jumps, 60Hz for 3s
let seqA = 0
let seqB = 0
const driver = setInterval(() => {
  seqA++
  seqB++
  roomA.send('input', { seq: seqA, dirX: 1, dirZ: 0.2, jump: false, dive: false, sprint: true })
  roomB.send('input', { seq: seqB, dirX: -1, dirZ: -0.2, jump: seqB % 60 === 30, dive: seqB % 60 === 40, sprint: false })
}, 1000 / 60)

await new Promise((resolve) => setTimeout(resolve, 3000))
clearInterval(driver)
await new Promise((resolve) => setTimeout(resolve, 200))

const state = read(roomA)
const a1 = state.players.get(roomA.sessionId) ?? fail('A vanished')
const b1 = state.players.get(roomB.sessionId) ?? fail('B vanished')

if (Math.abs(a1.x - startAx) < 1) fail(`A did not move (x ${startAx.toFixed(2)} -> ${a1.x.toFixed(2)})`)
if (Math.abs(b1.x - startBx) < 1) fail(`B did not move (x ${startBx.toFixed(2)} -> ${b1.x.toFixed(2)})`)
if (a1.lastSeq === 0) fail('server never acked A inputs')
if (state.serverTime - t0 < 2) fail(`serverTime barely advanced (${(state.serverTime - t0).toFixed(2)}s)`)
if (typeof state.ball?.y !== 'number') fail('ball missing from state')
if (a1.stamina >= 100) fail('A sprinted for 3s but stamina did not drain')

console.log(
  `[smoke] A moved ${(a1.x - startAx).toFixed(1)}m (seq ${a1.lastSeq}, stamina ${a1.stamina.toFixed(0)}), ` +
    `B moved ${(b1.x - startBx).toFixed(1)}m, ball at y=${state.ball.y.toFixed(2)}, ` +
    `serverTime +${(state.serverTime - t0).toFixed(2)}s, tick ${state.tickRemaining.toFixed(1)}s`,
)

await roomA.leave()
await roomB.leave()
clearTimeout(timeout)
console.log('[smoke] OK')
process.exit(0)
