import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { RoomManager } from './room-manager.js';
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
/** 64 KB — reject oversized messages before parsing (DoS prevention). */
const MAX_MESSAGE_BYTES = 64 * 1024;
/** Send a ping every 30 s; expect a pong within 10 s or terminate. */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** Sliding-window rate limit: max ops per window per client. */
const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW_MS = 1_000;
const roomManager = new RoomManager();
// ─── Rate limiter ────────────────────────────────────────────────────────────
const rateLimits = new Map();
function isWithinRateLimit(clientId) {
    const now = Date.now();
    const entry = rateLimits.get(clientId);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimits.set(clientId, { count: 1, windowStart: now });
        return true;
    }
    if (entry.count >= RATE_LIMIT_MAX)
        return false;
    entry.count++;
    return true;
}
// ─── Heartbeat ───────────────────────────────────────────────────────────────
/** Tracks whether each socket has responded to the last ping. */
const alive = new WeakMap();
function startHeartbeat(ws, clientId) {
    return setInterval(() => {
        if (alive.get(ws) === false) {
            console.log(`[heartbeat] ${clientId} did not pong — terminating`);
            ws.terminate();
            return;
        }
        alive.set(ws, false);
        ws.ping();
    }, HEARTBEAT_INTERVAL_MS);
}
// ─── HTTP server (health endpoint) ───────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            connections: roomManager.getTotalConnections(),
            rooms: roomManager.getRoomCount(),
        }));
        return;
    }
    res.writeHead(404);
    res.end();
});
// ─── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (ws, req) => {
    // URL pattern: ws://host/room/<roomId>
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const segments = url.pathname.split('/').filter(Boolean);
    const roomId = segments[0] === 'room' ? segments[1] : undefined;
    const ROOM_ID_RE = /^[a-z0-9-]{1,64}$/i;
    if (!roomId || !ROOM_ID_RE.test(roomId)) {
        ws.close(1008, 'roomId required and must match /^[a-z0-9-]{1,64}$/i');
        return;
    }
    const client = {
        id: randomUUID(),
        ws,
        roomId,
        // Week 5: userId will come from the validated JWT. For now, one UUID per connection.
        userId: randomUUID(),
        presenceUserId: undefined,
        color: roomManager.assignColor(),
    };
    roomManager.join(roomId, client);
    // Heartbeat setup
    alive.set(ws, true);
    const hbTimer = startHeartbeat(ws, client.id);
    ws.on('pong', () => alive.set(ws, true));
    // Tell the connecting client their server-assigned colour (Week 3: presence)
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'welcome', userId: client.userId, roomId, color: client.color }));
    }
    // Tell existing peers about the new arrival
    roomManager.broadcast(roomId, { type: 'user-joined', userId: client.userId, roomId, color: client.color }, client.id);
    // ── Incoming messages ──────────────────────────────────────────────────────
    ws.on('message', (data, isBinary) => {
        if (isBinary)
            return; // Week 1: text (JSON) only
        // Size guard — RawData is Buffer | ArrayBuffer | Buffer[]; normalise to Buffer.
        const buf = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        if (buf.length > MAX_MESSAGE_BYTES) {
            console.warn(`[server] ${client.id} sent oversized message (${buf.length} B) — discarded`);
            return;
        }
        // Rate limit
        if (!isWithinRateLimit(client.id)) {
            console.warn(`[server] ${client.id} exceeded rate limit — discarded`);
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(buf.toString());
        }
        catch {
            console.warn(`[server] ${client.id} sent malformed JSON — discarded`);
            return;
        }
        const msg = parsed;
        // Track the client's self-reported userId for use in user-left (Week 3)
        if (typeof msg['userId'] === 'string' && msg['userId'].length > 0) {
            client.presenceUserId = msg['userId'];
        }
        // Route by message type
        if (msg['type'] === 'crdt-delete') {
            if (typeof msg['charId'] !== 'string' || msg['charId'].length === 0) {
                console.warn(`[server] ${client.id} crdt-delete missing charId — discarded`);
                return;
            }
        }
        if (msg['type'] === 'crdt-insert') {
            const char = msg['char'];
            if (!char || typeof char['id'] !== 'string' || typeof char['value'] !== 'string') {
                console.warn(`[server] ${client.id} crdt-insert malformed char — discarded`);
                return;
            }
        }
        if (msg['type'] === 'presence') {
            const cursor = msg['cursor'];
            if (!cursor ||
                typeof cursor['from'] !== 'number' ||
                typeof cursor['to'] !== 'number') {
                console.warn(`[server] ${client.id} presence missing cursor — discarded`);
                return;
            }
            const name = msg['name'];
            if (typeof name !== 'string' || name.length === 0 || name.length > 64) {
                console.warn(`[server] ${client.id} presence invalid name — discarded`);
                return;
            }
        }
        console.log(`[room:${roomId}] ${msg['type']} from ${client.id}`);
        roomManager.broadcast(roomId, parsed, client.id);
    });
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    ws.on('close', () => {
        clearInterval(hbTimer);
        rateLimits.delete(client.id);
        roomManager.leave(client);
        // Use the client's self-reported userId so peers can match it to presence messages
        const leftUserId = client.presenceUserId ?? client.userId;
        roomManager.broadcast(roomId, { type: 'user-left', userId: leftUserId, roomId });
    });
    ws.on('error', (err) => {
        console.error(`[server] client ${client.id} error:`, err.message);
    });
});
// ─── Metrics (constitution: log every 60 s) ──────────────────────────────────
setInterval(() => {
    console.log(`[metrics] rooms=${roomManager.getRoomCount()} connections=${roomManager.getTotalConnections()}`);
}, 60_000);
// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
    console.log(`[server] listening on port ${PORT}`);
    console.log(`[server] health → http://localhost:${PORT}/health`);
    console.log(`[server] ws     → ws://localhost:${PORT}/room/<roomId>`);
});
