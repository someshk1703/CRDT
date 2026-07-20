import { WebSocket } from 'ws';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { RGADocument } from '@crdt/shared/crdt';
import { supabase } from './db/supabase.js';

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
  /**
   * The userId the client sends in its own messages (e.g. presence messages).
   * Updated on first received message. Used for user-left cleanup so that
   * other clients can correctly remove the cursor by the same userId they saw
   * in presence messages.
   */
  presenceUserId: string | undefined;
  color: string;
}

export class RoomManager {
  private readonly rooms = new Map<string, Set<Client>>();
  private colorIndex = 0;

  /** Server-side RGADocument per room for snapshot generation. */
  readonly documents = new Map<string, RGADocument>();

  /** Op count per room — used to trigger snapshots. */
  private readonly opCounts = new Map<string, number>();

  /** Supabase Realtime subscriptions per room (US4). */
  private readonly realtimeSubs = new Map<string, RealtimeChannel>();

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
      this.documents.delete(client.roomId);
      this.opCounts.delete(client.roomId);
      console.log(`[room:${client.roomId}] empty — removed`);
    } else {
      console.log(
        `[room:${client.roomId}] ${client.id} left — ${room.size} client(s) remain`,
      );
    }
  }

  // ── Op count ──────────────────────────────────────────────────────────────

  /** Increment the op count for a room and return the new count. */
  incrementOpCount(roomId: string): number {
    const next = (this.opCounts.get(roomId) ?? 0) + 1;
    this.opCounts.set(roomId, next);
    return next;
  }

  getOpCount(roomId: string): number {
    return this.opCounts.get(roomId) ?? 0;
  }

  /** Seed op count from the DB on first client join (so snapshot trigger stays accurate). */
  seedOpCount(roomId: string, count: number): void {
    if (!this.opCounts.has(roomId)) {
      this.opCounts.set(roomId, count);
    }
  }

  // ── Realtime subscriptions (US4) ──────────────────────────────────────────

  /** Subscribe to Realtime INSERT events on `operations` for this room. */
  subscribeRoom(roomId: string, onOp: (op: object) => void): void {
    if (this.realtimeSubs.has(roomId)) return;
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'operations', filter: `room_id=eq.${roomId}` },
        (payload) => onOp(payload.new),
      )
      .subscribe();
    this.realtimeSubs.set(roomId, channel);
    console.log(`[realtime] subscribed to room=${roomId}`);
  }

  /** Unsubscribe and remove the Realtime channel for this room. */
  unsubscribeRoom(roomId: string): void {
    const channel = this.realtimeSubs.get(roomId);
    if (!channel) return;
    void supabase.removeChannel(channel);
    this.realtimeSubs.delete(roomId);
    console.log(`[realtime] unsubscribed from room=${roomId}`);
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
