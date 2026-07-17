import { Room, type Client } from 'colyseus'

/**
 * M0: bare room proving the transport — join, ping/pong, leave.
 * The match state machine, schema, and 60Hz sim loop arrive in M2/M3.
 */
export class MatchRoom extends Room {
  override maxClients = 6

  override onCreate(): void {
    console.log(`[room ${this.roomId}] created`)
    this.onMessage('ping', (client, t: number) => {
      client.send('pong', t)
    })
  }

  override onJoin(client: Client): void {
    console.log(`[room ${this.roomId}] join ${client.sessionId}`)
    client.send('welcome', { roomId: this.roomId })
  }

  override onLeave(client: Client): void {
    console.log(`[room ${this.roomId}] leave ${client.sessionId}`)
  }
}
