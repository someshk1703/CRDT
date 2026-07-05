import { WebSocket } from 'ws';

const COLORS = [
  '#E53E3E', // red
  '#3182CE', // blue
  '#38A169', // green
  '#D69E2E', // yellow
  '#805AD5', // purple
  '#DD6B20', // orange
  '#00B5D8', // cyan
  '#ED64A6', // pink
] as const;

export interface Client {
  /** Unique per-connection ID (changes on reconnect). */
  id: string;
  ws: WebSocket;
  roomId: string;
  /**
   * User identity — random UUID per connection in Week 1–4.
   * Week 5: derived from a validated JWT; becomes stable across reconnects.
   * Do NOT assume this value is stable before Week 5.
   */
  userId: string;
  color: string;
}

export class RoomManager {
  private readonly rooms = new Map<string, Set<Client>>();
  private colorIndex = 0;

  join(roomId: string, client: Client): void {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId)!.add(client);
    console.log(
      `[room:${roomId}] ${client.id} joined — ${this.rooms.get(roomId)!.size} client(s) in room`,
    );
  }

  leave(client: Client): void {
    const room = this.rooms.get(client.roomId);
    if (!room) return;
    room.delete(client);
    if (room.size === 0) {
      this.rooms.delete(client.roomId);
      console.log(`[room:${client.roomId}] empty — removed`);
    } else {
      console.log(
        `[room:${client.roomId}] ${client.id} left — ${room.size} client(s) remain`,
      );
    }
  }

  /**
   * Broadcast a JSON-serialisable message to every client in the room,
   * optionally excluding the sender.
   */
  broadcast(roomId: string, msg: object, excludeId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const payload = JSON.stringify(msg);
    for (const client of room) {
      if (client.id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  assignColor(): string {
    return COLORS[this.colorIndex++ % COLORS.length];
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getTotalConnections(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.size;
    return total;
  }
}
