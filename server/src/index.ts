import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { RGADocument } from '@crdt/shared/crdt';
import { RoomManager, type Client } from './room-manager.js';
import type { AppMessage } from '@crdt/shared';
import { persistOp, loadOpsForRoom, maybeSaveSnapshot } from './db/operations.js';

// ─── Startup env validation (T030) ────────────────────────────────────────────

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[server] Missing required env var: ${key}`);
    process.exit(1);
  }
}

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

const rateLimits = new Map<string, { count: number; windowStart: number }>();

function isWithinRateLimit(clientId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(clientId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(clientId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

/** Tracks whether each socket has responded to the last ping. */
const alive = new WeakMap<WebSocket, boolean>();

function startHeartbeat(ws: WebSocket, clientId: string): ReturnType<typeof setInterval> {
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
    res.end(
      JSON.stringify({
        status: 'ok',
        connections: roomManager.getTotalConnections(),
        rooms: roomManager.getRoomCount(),
      }),
    );
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

  const client: Client = {
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
  roomManager.broadcast(
    roomId,
    { type: 'user-joined', userId: client.userId, roomId, color: client.color },
    client.id,
  );

  // ── Catch-up: send full document history to the joining client (T018, T019) ─

  loadOpsForRoom(roomId)
    .then(({ snapshot, ops }) => {
      // Seed op count from DB so snapshot triggers stay accurate
      const totalOps = (snapshot ? 0 : 0) + ops.length +
        (snapshot ? ops.length : 0); // seed with ops-since-snapshot count is imprecise;
      // use full op count if no snapshot, otherwise (snapshot.op_count already in db)
      roomManager.seedOpCount(roomId, snapshot ? ops.length : ops.length);

      // Initialize server-side RGADocument if not already present (T019)
      if (!roomManager.documents.has(roomId)) {
        const serverDoc = new RGADocument('server');
        if (snapshot) {
          serverDoc.loadFromChars(snapshot.chars);
        }
        for (const op of ops) {
          if (op.op_type === 'insert') {
            serverDoc.remoteInsert(op.payload as import('@crdt/shared/crdt').CRDTChar);
          } else {
            serverDoc.remoteDelete((op.payload as { charId: string }).charId);
          }
        }
        roomManager.documents.set(roomId, serverDoc);
      }

      // Send catch-up to joining client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'catchup',
          roomId,
          userId: client.userId,
          snapshot: snapshot ? { chars: snapshot.chars, lastClock: snapshot.lastClock } : null,
          ops,
        }));
        console.log(`[room:${roomId}] catch-up sent — ${ops.length} ops, snapshot=${snapshot !== null}`);
      }

      // Opt-in Realtime broadcast (US4 — T029)
      if (process.env['ENABLE_REALTIME_BROADCAST'] === 'true') {
        const room = roomManager.documents.get(roomId);
        if (room) {
          roomManager.subscribeRoom(roomId, (op) => roomManager.broadcast(roomId, op));
        }
      }
    })
    .catch((err: unknown) => {
      console.error(`[room:${roomId}] catch-up load failed:`, (err as Error).message);
    });

  // ── Incoming messages ──────────────────────────────────────────────────────

  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // Week 1: text (JSON) only

    // Size guard — RawData is Buffer | ArrayBuffer | Buffer[]; normalise to Buffer.
    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data as unknown as ArrayBuffer);
    if (buf.length > MAX_MESSAGE_BYTES) {
      console.warn(`[server] ${client.id} sent oversized message (${buf.length} B) — discarded`);
      return;
    }

    // Rate limit
    if (!isWithinRateLimit(client.id)) {
      console.warn(`[server] ${client.id} exceeded rate limit — discarded`);
      return;
    }

    let parsed: AppMessage | Record<string, unknown>;
    try {
      parsed = JSON.parse(buf.toString()) as AppMessage | Record<string, unknown>;
    } catch {
      console.warn(`[server] ${client.id} sent malformed JSON — discarded`);
      return;
    }

    const msg = parsed as Record<string, unknown>;

    // Track the client's self-reported userId for use in user-left (Week 3)
    if (typeof msg['userId'] === 'string' && msg['userId'].length > 0) {
      client.presenceUserId = msg['userId'] as string;
    }

    // Route by message type
    if (msg['type'] === 'crdt-delete') {
      if (typeof msg['charId'] !== 'string' || msg['charId'].length === 0) {
        console.warn(`[server] ${client.id} crdt-delete missing charId — discarded`);
        return;
      }
    }

    if (msg['type'] === 'crdt-insert') {
      const char = msg['char'] as Record<string, unknown> | undefined;
      if (!char || typeof char['id'] !== 'string' || typeof char['value'] !== 'string') {
        console.warn(`[server] ${client.id} crdt-insert malformed char — discarded`);
        return;
      }
    }

    if (msg['type'] === 'presence') {
      const cursor = msg['cursor'] as Record<string, unknown> | undefined;
      if (
        !cursor ||
        typeof cursor['from'] !== 'number' ||
        typeof cursor['to'] !== 'number'
      ) {
        console.warn(`[server] ${client.id} presence missing cursor — discarded`);
        return;
      }
      const name = msg['name'];
      if (typeof name !== 'string' || name.length === 0 || name.length > 64) {
        console.warn(`[server] ${client.id} presence invalid name — discarded`);
        return;
      }
    }

    console.log(`[room:${roomId}] ${msg['type'] as string} from ${client.id}`);

    // ── Persist CRDT ops before broadcast (T014, T015, T016) ─────────────────
    if (msg['type'] === 'crdt-insert' || msg['type'] === 'crdt-delete') {
      persistOp(roomId, client.id, msg)
        .then(() => {
          // Apply op to server-side doc (T015)
          const serverDoc = roomManager.documents.get(roomId);
          if (serverDoc) {
            if (msg['type'] === 'crdt-insert') {
              serverDoc.remoteInsert(msg['char'] as import('@crdt/shared/crdt').CRDTChar);
            } else {
              serverDoc.remoteDelete(msg['charId'] as string);
            }
          }

          // Trigger snapshot if threshold reached (T016)
          const count = roomManager.incrementOpCount(roomId);
          if (serverDoc) {
            void maybeSaveSnapshot(roomId, serverDoc, count);
          }

          // Broadcast to peers
          roomManager.broadcast(roomId, parsed as object, client.id);
        })
        .catch((err: unknown) => {
          console.error(`[room:${roomId}] persistOp failed — not broadcasting:`, (err as Error).message);
        });
      return;
    }

    roomManager.broadcast(roomId, parsed as object, client.id);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ws.on('close', () => {
    clearInterval(hbTimer);
    rateLimits.delete(client.id);
    roomManager.leave(client);
    // Use the client's self-reported userId so peers can match it to presence messages
    const leftUserId = client.presenceUserId ?? client.userId;
    roomManager.broadcast(roomId, { type: 'user-left', userId: leftUserId, roomId });
    // Unsubscribe Realtime if room became empty
    if (process.env['ENABLE_REALTIME_BROADCAST'] === 'true') {
      roomManager.unsubscribeRoom(roomId);
    }
  });

  ws.on('error', (err) => {
    console.error(`[server] client ${client.id} error:`, err.message);
  });
});

// ─── Metrics (constitution: log every 60 s) ──────────────────────────────────

setInterval(() => {
  console.log(
    `[metrics] rooms=${roomManager.getRoomCount()} connections=${roomManager.getTotalConnections()}`,
  );
}, 60_000);

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log(`[server] health → http://localhost:${PORT}/health`);
  console.log(`[server] ws     → ws://localhost:${PORT}/room/<roomId>`);
});
