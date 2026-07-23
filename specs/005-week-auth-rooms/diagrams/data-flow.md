# Data Flow: Week 5 — Auth, Rooms, and Polished UX

**Feature**: [spec.md](../spec.md)
**Branch**: `005-week-auth-rooms`
**Created**: 2026-07-22

---

## Data Flow 1: GitHub OAuth Login

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant App as React App
    participant SA as Supabase Auth
    participant GH as GitHub OAuth

    U->>App: Visit app (unauthenticated)
    App->>U: Render login screen
    U->>App: Click "Sign in with GitHub"
    App->>SA: supabase.auth.signInWithOAuth({ provider: 'github' })
    SA->>U: Redirect to GitHub authorization page
    U->>GH: Authorize app
    GH->>SA: Callback with authorization code
    SA->>SA: Exchange code for tokens, create/update user row
    SA->>U: Redirect back to app (with session in URL hash)
    App->>SA: supabase.auth.getSession() → { access_token, user }
    App->>U: Render home page with GitHub username + avatar
```

---

## Data Flow 2: Create Room and Connect

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant App as React App
    participant Server as WS Server
    participant DB as Supabase DB

    U->>App: Click "Create room"
    App->>Server: POST /rooms { name?, language? }\nAuthorization: Bearer {access_token}
    Server->>Server: Validate JWT via supabase.auth.getUser()
    Server->>Server: Generate nanoid slug (check uniqueness)
    Server->>DB: INSERT INTO rooms (id, name, language, owner_id)
    DB-->>Server: Room row created
    Server-->>App: 201 { id: "a3f9x7k2mq", name, language }
    App->>U: Redirect to /room/a3f9x7k2mq
    App->>Server: WebSocket connect wss://host/room/a3f9x7k2mq?token={jwt}
    Server->>Server: Validate JWT → extract userId, username, avatarUrl
    Server->>DB: UPSERT room_members (userId, roomId)
    Server->>DB: loadOpsForRoom(roomId) → snapshot + delta ops
    Server-->>App: welcome { userId, username, avatarUrl }
    Server-->>App: catchup { currentLanguage, snapshot, ops }
    App->>App: Restore CRDT state, set editor language
    App->>U: Editor ready
```

---

## Data Flow 3: Language Switch

```mermaid
sequenceDiagram
    participant U1 as User A (changer)
    participant Server as WS Server
    participant DB as Supabase DB
    participant U2 as User B (peer)
    participant U3 as User C (joining later)

    U1->>Server: { type: 'language', lang: 'python' }
    Server->>Server: Validate lang is in allowed set
    Server->>DB: UPDATE rooms SET language = 'python' WHERE id = roomId
    Server-->>U1: { type: 'language', lang: 'python', changedBy: userId }
    Server-->>U2: { type: 'language', lang: 'python', changedBy: userId }
    U1->>U1: setLanguage('python')
    U2->>U2: setLanguage('python')

    Note over U3: User C joins after the switch
    U3->>Server: WebSocket connect + token
    Server->>DB: loadOpsForRoom → snapshot + ops
    Server-->>U3: catchup { currentLanguage: 'python', snapshot, ops }
    U3->>U3: Initialize editor with Python language
```

---

## Data Flow 4: Home Page — Recent Rooms

```mermaid
sequenceDiagram
    participant App as React App
    participant Server as WS Server
    participant DB as Supabase DB

    App->>Server: GET /rooms\nAuthorization: Bearer {access_token}
    Server->>Server: Validate JWT → userId
    Server->>DB: SELECT rooms JOIN room_members WHERE user_id = userId\n  ORDER BY last_visited_at DESC LIMIT 10
    DB-->>Server: [ { id, name, language, last_visited_at }, ... ]
    Server-->>App: 200 { rooms: [...] }
    App->>App: Render room list
```
