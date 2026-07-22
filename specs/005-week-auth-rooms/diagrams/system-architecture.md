# System Architecture: Week 5 — Auth, Rooms, and Polished UX

**Feature**: [spec.md](../spec.md)
**Branch**: `005-week-auth-rooms`
**Created**: 2026-07-22

---

## System Architecture Diagram

```mermaid
graph TB
    subgraph Client["Browser Client (Vercel)"]
        React["React + Vite App"]
        CM["CodeMirror 6 Editor"]
        SupabaseClient["Supabase JS Client\n(auth, anon key)"]
        WSClient["WebSocket Client\n(wss:// + JWT token)"]
        React --> CM
        React --> SupabaseClient
        React --> WSClient
    end

    subgraph Auth["Supabase Auth"]
        GHOAuth["GitHub OAuth Provider"]
        JWTIssuer["JWT Issuer\n(RS256)"]
        GHOAuth --> JWTIssuer
    end

    subgraph Server["WebSocket Server (Railway)"]
        HTTPServer["HTTP Server\n(Express-style)"]
        WSSUpgrade["WS Upgrade Handler\n(JWT validated here)"]
        RoomManager["RoomManager\n(in-memory room state)"]
        DBOps["DB Operations\n(persistOp, upsertRoom,\nupsertMember, updateLanguage)"]
        HTTPServer --> WSSUpgrade
        WSSUpgrade --> RoomManager
        RoomManager --> DBOps
    end

    subgraph Supabase["Supabase (managed)"]
        SupabaseAuth["Auth\n(auth.users)"]
        PostgresDB["PostgreSQL\n(rooms, operations,\nsnapshots, room_members)"]
        SupabaseAuth --> JWTIssuer
    end

    subgraph GitHub["GitHub"]
        GHOAuthApp["OAuth App"]
    end

    SupabaseClient -- "1. initiate OAuth" --> GHOAuth
    GHOAuth -- "2. redirect to GitHub" --> GHOAuthApp
    GHOAuthApp -- "3. callback with code" --> GHOAuth
    GHOAuth -- "4. issue JWT session" --> SupabaseClient
    WSClient -- "5. wss:// + ?token=JWT" --> WSSUpgrade
    WSSUpgrade -- "6. getUser(token)" --> SupabaseAuth
    DBOps -- "DB reads/writes\n(service role)" --> PostgresDB
    RoomManager -- "broadcast ops" --> WSClient
```

**Deployment topology**:
- Frontend: Vercel (static + CDN, auto HTTPS, GitHub push-to-deploy)
- WebSocket server: Railway (persistent Node.js container, WSS via Railway's proxy)
- Database + Auth: Supabase (managed Postgres + Auth, no separate deployment)

---

## What's New in Week 5

| Component | Week 4 State | Week 5 Change |
|-----------|-------------|----------------|
| WebSocket URL | `ws://localhost:3001/room/{id}` | `wss://{host}/room/{id}?token={jwt}` |
| Identity | Anonymous server-assigned UUID | Supabase user ID + GitHub username + avatar |
| Room creation | Auto-created on first WS connect | Explicit `POST /rooms` before connecting |
| Language | Hardcoded JavaScript | Per-room, broadcast live, persisted in DB |
| Deployment | localhost only | Public HTTPS/WSS on Vercel + Railway |
