# Quickstart: Week 5 — Auth, Rooms, and Polished UX

**Feature**: [spec.md](./spec.md)
**Branch**: `005-week-auth-rooms`
**Created**: 2026-07-22

---

## Prerequisites

- Week 4 complete and running locally (Supabase project exists with `rooms`, `operations`, `snapshots` tables)
- Node.js 20+
- A GitHub account (for OAuth)

---

## Step 1: Configure GitHub OAuth in Supabase

1. Go to your Supabase project → **Authentication → Providers → GitHub**
2. Enable the GitHub provider
3. Copy the **Callback URL** shown (looks like `https://xxxx.supabase.co/auth/v1/callback`)
4. In GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:
   - Application name: `CRDT Editor (local)`
   - Homepage URL: `http://localhost:5173`
   - Authorization callback URL: paste the Supabase callback URL from step 3
5. Copy the **Client ID** and generate a **Client Secret**
6. Back in Supabase, paste the Client ID and Client Secret → **Save**

---

## Step 2: Run the Database Migration

In your Supabase project → **SQL Editor**, run the migration script from [data-model.md](./data-model.md):

```sql
-- Week 5 migration
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'javascript',
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS room_members (
  user_id         TEXT        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id         TEXT        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  last_visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS room_members_user_visited_idx
  ON room_members (user_id, last_visited_at DESC);

ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own room memberships"
  ON room_members FOR SELECT
  USING (auth.uid()::text = user_id);
```

---

## Step 3: Update Environment Variables

### `server/.env`

```env
# Existing from Week 4
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# New in Week 5
ALLOWED_ORIGIN=http://localhost:5173
PORT=3001
```

### `client/.env.local`

```env
# New in Week 5
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...         # anon/public key (NOT service role)
VITE_WS_URL=ws://localhost:3001       # WebSocket URL
VITE_API_URL=http://localhost:3001    # HTTP REST base URL (same host, different protocol)
```

> `VITE_SUPABASE_ANON_KEY` is the **anon** key (safe to expose in client code). Never put the service role key in the client.
> `VITE_API_URL` and `VITE_WS_URL` point at the same server but use different protocols. In production these become `https://` and `wss://` respectively.

---

## Step 4: Install New Dependencies

```bash
# Server
cd server && npm install nanoid

# Client
cd client && npm install @supabase/supabase-js \
  @codemirror/lang-python @codemirror/lang-java \
  @codemirror/lang-go @codemirror/lang-html \
  @codemirror/lang-css @codemirror/lang-json
# Note: @codemirror/lang-javascript is already installed from Week 1
```

---

## Step 5: Run Locally

```bash
# Terminal 1 — server
cd server && npm run dev

# Terminal 2 — client
cd client && npm run dev
```

Open `http://localhost:5173` — you should see the login screen. Click "Sign in with GitHub".

---

## Step 6: Smoke Test

1. **Auth**: Sign in with GitHub → see your username + avatar in the top right
2. **Create room**: Click "Create room" → get redirected to `/room/{slug}`
3. **Share link**: Open the same URL in an incognito window, sign in as a different GitHub account → both editors are live-synced
4. **Language switch**: Change language from the dropdown → both windows update instantly
5. **Rejoin**: Close the incognito window, reopen → language and document state preserved
6. **Recent rooms**: Go home → room appears in "Recent rooms" list

---

## Deployment

### Frontend — Vercel

```bash
# From project root
npx vercel --cwd client
```

Set environment variables in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_WS_URL` → your Railway WebSocket URL (e.g. `wss://my-crdt.up.railway.app`)
- `VITE_API_URL` → your Railway HTTP URL (e.g. `https://my-crdt.up.railway.app`)

Update the Supabase GitHub OAuth app's Homepage URL and the Supabase **Site URL** (Authentication → URL Configuration) to your Vercel deployment URL.

### WebSocket Server — Railway

1. Push the repo to GitHub
2. In Railway → New Project → Deploy from GitHub repo → select `server/` as the root directory
3. Set environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ALLOWED_ORIGIN` → your Vercel URL (e.g. `https://my-crdt.vercel.app`)
4. Railway auto-detects Node.js and runs `npm start`

After deploy, update `VITE_WS_URL` in Vercel to point to the Railway WSS URL and redeploy the client.

---

## Why WebSocket Server Can't Run on Vercel

Vercel's compute model executes code in AWS Lambda functions. Lambda is stateless and ephemeral — each invocation starts fresh, runs for a maximum time limit (30s on Hobby, 60s on Pro), then terminates. A WebSocket connection that must stay open for the duration of a collaborative editing session (potentially 30+ minutes) fundamentally cannot be served by a function that terminates after 30–60 seconds. Additionally, the `RoomManager` holds in-memory room state (connected clients, op counts, presence data) — this state would be wiped on every cold start, making real-time collaboration impossible. Persistent, stateful services require a container runtime (Railway, Render, Fly.io) where the process runs continuously.
