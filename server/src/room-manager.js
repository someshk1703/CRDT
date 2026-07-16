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
];
export class RoomManager {
    rooms = new Map();
    colorIndex = 0;
    join(roomId, client) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, new Set());
        }
        this.rooms.get(roomId).add(client);
        console.log(`[room:${roomId}] ${client.id} joined — ${this.rooms.get(roomId).size} client(s) in room`);
    }
    leave(client) {
        const room = this.rooms.get(client.roomId);
        if (!room)
            return;
        room.delete(client);
        if (room.size === 0) {
            this.rooms.delete(client.roomId);
            console.log(`[room:${client.roomId}] empty — removed`);
        }
        else {
            console.log(`[room:${client.roomId}] ${client.id} left — ${room.size} client(s) remain`);
        }
    }
    /**
     * Broadcast a JSON-serialisable message to every client in the room,
     * optionally excluding the sender.
     */
    broadcast(roomId, msg, excludeId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return;
        const payload = JSON.stringify(msg);
        for (const client of room) {
            if (client.id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(payload);
            }
        }
    }
    assignColor() {
        return COLORS[this.colorIndex++ % COLORS.length];
    }
    getRoomCount() {
        return this.rooms.size;
    }
    getTotalConnections() {
        let total = 0;
        for (const room of this.rooms.values())
            total += room.size;
        return total;
    }
}
