import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { RGADocument } from '@crdt/shared/crdt';
import { RoomManager, type Client } from './room-manager.js';
import type { AppMessage } from '@crdt/shared';
import {
  persistOp,
  loadOpsForRoom,
  maybeSaveSnapshot,
  upsertRoomMember,
  updateRoomLanguage,
} from './db/operations.js';
import { validateToken } from './auth.js';
import {
  createRoomHandler,
  listRoomsHandler,
  getRoomHandler,
  patchRoomHandler,
  SUPPORTED_LANGUAGES,
  getRoomBySlug,
} from './rooms.js';

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

const ALLOWED_ORIGIN = process.env['ALLOWED_ORIGIN'] ?? 'http://localhost:5173';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

// ─── HTTP server (health + REST) ─────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // Attach CORS headers to all responses
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connections: roomManager.getTotalConnections(),
      rooms: roomManager.getRoomCount(),
    }));
    return;
  }

  if (req.method === 'POST' && path === '/rooms') {
    createRoomHandler(req, res).catch((err: unknown) => {
      console.error('[rooms] POST /rooms error:', (err as Error).message);
      res.writeHead(500); res.end();
    });
    return;
  }

  if (req.method === 'GET' && path === '/rooms') {
    listRoomsHandler(req, res).catch((err: unknown) => {
      console.error('[rooms] GET /rooms error:', (err as Error).message);
      res.writeHead(500); res.end();
    });
    return;
  }

  const roomSlugMatch = path.match(/^\/rooms\/([a-z0-9]{1,64})$/i);
  if (roomSlugMatch) {
    const slug = roomSlugMatch[1];
    if (req.method === 'GET') {
      getRoomHandler(req, res, slug).catch((err: unknown) => {
        console.error('[rooms] GET /rooms/:slug error:', (err as Error).message);
        res.writeHead(500); res.end();
      });
      return;
    }
    if (req.method === 'PATCH') {
      patchRoomHandler(req, res, slug, (roomId, name) => {
        roomManager.broadcast(roomId, { type: 'room-meta', name });
      }).catch((err: unknown) => {
        console.error('[rooms] PATCH /rooms/:slug error:', (err as Error).message);
        res.writeHead(500); res.end();
      });
      return;
    }
  }

  res.writeHead(404);
  res.end();
});

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

// JWT-gated upgrade handler — validates token BEFORE the WS handshake completes
httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token') ?? '';
  const segments = url.pathname.split('/').filter(Boolean);
  const roomId = segments[0] === 'room' ? segments[1] : undefined;

  const ROOM_ID_RE = /^[a-z0-9-]{1,64}$/i;
  if (!roomId || !ROOM_ID_RE.test(roomId)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  validateToken(token).then((user) => {
    if (!user) {
      console.warn(`[auth] rejected upgrade — no valid token for room=${roomId}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user, roomId);
    });
  }).catch(() => {
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    socket.destroy();
  });
});

wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, user: { id: string; username: string; avatarUrl: string }, roomId: string) => {

  const client: Client = {
    id: randomUUID(),
    ws,
    roomId,
    userId: user.id,          // stable Supabase user ID from validated JWT
    presenceUserId: undefined,
    color: roomManager.assignColor(),
  };

  roomManager.join(roomId, client);
  roomManager.setClientMeta(ws, {
    userId: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    roomId,
  });

  // Record / refresh membership and seed room row
  void upsertRoomMember(user.id, roomId);

  // Heartbeat setup
  alive.set(ws, true);
  const hbTimer = startHeartbeat(ws, client.id);
  ws.on('pong', () => alive.set(ws, true));

  // Enrich welcome with real identity (Week 5)
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'welcome',
      userId: client.userId,
      roomId,
      color: client.color,
      username: user.username,
      avatarUrl: user.avatarUrl,
    }));
  }

  // Tell existing peers about the new arrival (enriched with identity)
  roomManager.broadcast(
    roomId,
    {
      type: 'user-joined',
      userId: client.userId,
      roomId,
      color: client.color,
      username: user.username,
      avatarUrl: user.avatarUrl,
    },
    client.id,
  );

  // ── Catch-up: send full document history to the joining client (T018, T019) ─

  loadOpsForRoom(roomId)
    .then(async ({ snapshot, ops }) => {
      roomManager.seedOpCount(roomId, snapshot ? ops.length : ops.length);

      // Initialize server-side RGADocument if not already present
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

      // Send catch-up to joining client (include currentLanguage — Week 5)
      if (ws.readyState === WebSocket.OPEN) {
        // Fetch room language for catch-up
        const roomRow = await getRoomBySlug(roomId).catch(() => null);
        ws.send(JSON.stringify({
          type: 'catchup',
          roomId,
          userId: client.userId,
          currentLanguage: roomRow?.language ?? 'javascript',
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

  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
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

    // ── Language change (Week 5) ─────────────────────────────────────────
    if (msg['type'] === 'language') {
      const lang = msg['lang'] as unknown;
      if (typeof lang !== 'string' || !SUPPORTED_LANGUAGES.has(lang)) {
        console.warn(`[server] ${client.id} invalid language ${String(lang)} — discarded`);
        return;
      }
      void updateRoomLanguage(roomId, lang);
      roomManager.broadcast(roomId, { type: 'language', lang, changedBy: client.userId });
      return;
    }

    // ── Presence: enrich with identity before broadcasting (Week 5) ─────────
    if (msg['type'] === 'presence') {
      const meta = roomManager.getClientMeta(ws);
      const enriched = {
        ...msg,
        userId: client.userId,
        username: meta?.username ?? '',
        avatarUrl: meta?.avatarUrl ?? '',
      };
      roomManager.broadcast(roomId, enriched as object, client.id);
      return;
    }

    // ── Persist CRDT ops before broadcast ───────────────────────────────────
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

  ws.on('error', (err: Error) => {
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
