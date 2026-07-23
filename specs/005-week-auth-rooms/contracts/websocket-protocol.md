# API & Message Contracts: Week 5 — Auth, Rooms, and Polished UX

**Feature**: [spec.md](../spec.md)
**Branch**: `005-week-auth-rooms`
**Created**: 2026-07-22
**Extends**: [Week 4 WebSocket Protocol](../../004-week4-supabase-persistence/contracts/websocket-protocol.md)

---

## WebSocket Connection — Authentication

### Changed: Connection URL

The WebSocket URL now requires an `access_token` query parameter containing the Supabase session JWT. The server validates this token during the HTTP upgrade handshake and rejects the connection before any room data is exchanged if the token is missing or invalid.

```
Before (Week 1–4):
  ws://localhost:3001/room/{roomId}

After (Week 5+):
  wss://{WS_HOST}/room/{roomId}?token={supabase_access_token}
```

**Server upgrade handler** (pseudocode):

```typescript
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const roomId = url.pathname.split('/').at(-1);

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Token is valid — proceed with upgrade
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, user, roomId);
  });
});
```

**Rejection behavior**: Connection is destroyed before the WebSocket handshake completes. No `welcome` message is ever sent. No room data is exchanged.

---

## WebSocket Message Protocol — Updated Messages

### Updated: `welcome` Message (Server → Client)

The `welcome` message now carries the authenticated user's identity. The `userId` field changes from an anonymous server-assigned UUID to the Supabase user ID.

```typescript
interface WelcomeMessage {
  type: 'welcome';
  roomId: string;
  userId: string;      // Supabase auth.users.id — stable across reconnects
  username: string;    // GitHub username (from user_metadata.user_name)
  avatarUrl: string;   // GitHub avatar URL (from user_metadata.avatar_url)
}
```

**Change from Week 4**: `userId` was previously an ephemeral UUID assigned per connection. It is now the stable Supabase user ID. Clients that stored `userId` as a local identity key will maintain that identity across reconnects.

---

### Updated: `catchup` Message (Server → Client)

Extended with `currentLanguage` field. All other fields are unchanged from Week 4.

```typescript
interface CatchupMessage {
  type: 'catchup';
  roomId: string;
  userId: string;
  currentLanguage: string;   // NEW — active language for this room, e.g. 'python'
  snapshot: {
    chars: CRDTChar[];
    lastClock: number;
  } | null;
  ops: Array<{
    op_type: 'insert' | 'delete';
    payload: CRDTChar | { charId: string };
    clock: number;
  }>;
}
```

**Client handling addition**: Before rendering the editor, apply `currentLanguage` to set the initial CodeMirror language extension. This ensures a joining client sees the correct language without waiting for any broadcast.

---

### Updated: `user-joined` Message (Server → Client)

Now includes the joining user's identity. Previously only carried `userId`.

```typescript
interface UserJoinedMessage {
  type: 'user-joined';
  userId: string;      // Supabase user ID
  username: string;    // GitHub username
  avatarUrl: string;   // GitHub avatar URL
}
```

---

### Updated: `presence` Message (Client → Server → Peers)

The server enriches outgoing presence broadcasts with auth identity. Clients still send presence without identity fields (the server resolves them from `clientMeta`).

**Client sends**:
```typescript
interface PresenceSendMessage {
  type: 'presence';
  cursor: { line: number; ch: number } | null;
  selection: { anchor: { line: number; ch: number }; head: { line: number; ch: number } } | null;
}
```

**Server broadcasts to peers** (enriched):
```typescript
interface PresenceBroadcastMessage {
  type: 'presence';
  userId: string;
  username: string;    // NEW — added by server from clientMeta
  avatarUrl: string;   // NEW — added by server from clientMeta
  cursor: { line: number; ch: number } | null;
  selection: { anchor: { line: number; ch: number }; head: { line: number; ch: number } } | null;
}
```

---

## New WebSocket Message: `language`

### `language` — Language Change (Client → Server → Peers)

Broadcast when any user changes the room's editor language via the toolbar dropdown.

**Client sends**:
```typescript
interface LanguageChangeMessage {
  type: 'language';
  lang: string;   // One of: 'javascript' | 'typescript' | 'python' | 'java' | 'go' | 'html' | 'css' | 'json'
}
```

**Server behavior**:
1. Validate `lang` is one of the 8 supported values. Reject silently if invalid.
2. Update `rooms.language = lang` in Supabase (persist for future joiners).
3. Broadcast to all room members including the sender:
```typescript
interface LanguageBroadcastMessage {
  type: 'language';
  lang: string;
  changedBy: string;   // userId of the user who made the change
}
```

**Client handling**:
```
on receive 'language':
  setLanguage(msg.lang)   // update CodeMirror language extension via reconfigure()
```

---

## REST API Endpoints

The server gains a set of HTTP REST endpoints for room management. These are called by the client before establishing a WebSocket connection.

### `POST /rooms` — Create Room

**Auth**: `Authorization: Bearer <access_token>` header required.

**Request**:
```typescript
{
  name?: string;       // Optional; defaults to "Untitled Room"
  language?: string;   // Optional; defaults to "javascript"
}
```

**Response `201 Created`**:
```typescript
{
  id: string;        // Generated nanoid slug
  name: string;
  language: string;
  owner_id: string;  // Supabase user ID of creator
  created_at: string;
}
```

**Response `401 Unauthorized`**: Missing or invalid `Authorization` header.

**Response `422 Unprocessable Entity`**: Invalid `language` value.

---

### `GET /rooms` — List Recent Rooms for Authenticated User

**Auth**: `Authorization: Bearer <access_token>` header required.

**Query params**: None.

**Response `200 OK`**:
```typescript
{
  rooms: Array<{
    id: string;
    name: string;
    language: string;
    owner_id: string;
    last_visited_at: string;  // ISO timestamp from room_members
  }>;
}
```

Returns up to 10 rooms ordered by `last_visited_at DESC`.

**Response `401 Unauthorized`**: Missing or invalid token.

---

### `GET /rooms/:slug` — Get Room Info

**Auth**: `Authorization: Bearer <access_token>` header required.

**Response `200 OK`**:
```typescript
{
  id: string;
  name: string;
  language: string;
  owner_id: string;
  created_at: string;
}
```

**Response `404 Not Found`**: Room slug does not exist.

**Response `401 Unauthorized`**: Missing or invalid token.

---

### `PATCH /rooms/:slug` — Update Room Name

**Auth**: `Authorization: Bearer <access_token>` header required.

**Request**:
```typescript
{
  name: string;   // New room name; must be non-empty
}
```

**Response `200 OK`**:
```typescript
{
  id: string;
  name: string;
}
```

**Server behavior**: Updates `rooms.name` in Supabase, then broadcasts `{ type: 'room-meta', name }` to all connected users in the room.

**Response `401 Unauthorized`**: Missing or invalid token.

**Response `404 Not Found`**: Room slug does not exist.

**Response `400 Bad Request`**: `name` is empty or missing.

---

## New WebSocket Message: `room-meta`

### `room-meta` — Room Metadata Update (Server → All Clients)

Broadcast by the server after a successful `PATCH /rooms/:slug` call. Clients update their displayed room name in real time.

```typescript
interface RoomMetaMessage {
  type: 'room-meta';
  name: string;   // Updated room name
}
```

**Client handling**:
```
on receive 'room-meta':
  setRoomName(msg.name)   // update displayed room name in toolbar
``` — Updated

| Variable                    | Required | Description                                                                              |
|-----------------------------|----------|------------------------------------------------------------------------------------------|
| `SUPABASE_URL`              | Yes      | Supabase project URL (unchanged from Week 4)                                             |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Service role key (unchanged from Week 4)                                                 |
| `SNAPSHOT_INTERVAL`         | No       | Ops between snapshots; defaults to `100` (unchanged)                                     |
| `PORT`                      | No       | HTTP/WS port; defaults to `3001` (unchanged)                                             |
| `ALLOWED_ORIGIN`            | Yes      | Deployed frontend origin for CORS, e.g. `https://my-crdt.vercel.app`                    |
| `VITE_WS_URL`               | Yes      | (client env) WebSocket server URL, e.g. `wss://my-crdt.up.railway.app`                  |
| `VITE_API_URL`              | Yes      | (client env) HTTP REST base URL for REST calls, e.g. `https://my-crdt.up.railway.app` — **separate from `VITE_WS_URL`**; locally `http://localhost:3001` |
| `VITE_SUPABASE_URL`         | Yes      | (client env) Supabase project URL                                                        |
| `VITE_SUPABASE_ANON_KEY`    | Yes      | (client env) Supabase anon key for client-side auth                                      |

---

## Backward Compatibility Summary

| Message Type    | Change                                          | Breaking? |
|----------------|-------------------------------------------------|-----------|
| WS URL          | `token` query param required                   | Yes — clients without token are rejected |
| `welcome`       | Added `username`, `avatarUrl`; `userId` changed | Soft — clients must handle new fields |
| `catchup`       | Added `currentLanguage`                         | Soft — clients should read new field |
| `user-joined`   | Added `username`, `avatarUrl`                   | Soft — clients must handle new fields |
| `presence`      | Server-enriched with `username`, `avatarUrl`    | Soft — clients should read new fields |
| `language`      | New message type                                | Additive — old clients ignore unknown types |
| `room-meta`     | New message type (server → clients on rename)   | Additive — old clients ignore unknown types |
