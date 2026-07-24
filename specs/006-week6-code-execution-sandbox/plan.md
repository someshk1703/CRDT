# Implementation Plan: Week 6 — Code Execution Sandbox

**Feature Branch**: `006-week6-code-execution-sandbox`  
**Created**: 2026-07-24  
**Spec**: [spec.md](./spec.md)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser Client                                                  │
│  - Run button in Toolbar                                         │
│  - OutputPanel component (streams chunks)                        │
│  - WebSocket sends { type: "exec-run", roomId, language, code }  │
└──────────────────────┬──────────────────────────────────────────┘
                       │ WebSocket (existing connection)
┌──────────────────────▼──────────────────────────────────────────┐
│  WebSocket Collaboration Server (existing, server/)             │
│  - Receives exec-run message                                     │
│  - Forwards to Execution Service via HTTP                        │
│  - Broadcasts exec-output / exec-done / exec-error to room       │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP (private, same network)
┌──────────────────────▼──────────────────────────────────────────┐
│  Execution Microservice (new, executor/)                         │
│  - POST /execute { language, code }                              │
│  - Spawns docker run per request                                 │
│  - Streams stdout/stderr back via chunked HTTP response          │
│  - Enforces 10s timeout, 64MB memory, --network=none             │
└──────────────────────┬──────────────────────────────────────────┘
                       │ docker run (per request)
┌──────────────────────▼──────────────────────────────────────────┐
│  Isolated Container                                              │
│  - node:20-alpine / python:3.12-slim / openjdk:17-alpine         │
│  - --network=none --memory=64m --cpus=0.5 --read-only            │
│  - --user=nobody --rm                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Execution Microservice Scaffold (Day 1)

**Goal**: Standalone HTTP service that accepts `{language, code}` and returns streamed output.

### Tasks
1. Create `executor/` directory with `package.json`, `tsconfig.json`, `src/index.ts`
2. Implement `POST /execute` endpoint accepting `{language, code}`
3. Add input validation: only `javascript | python | java`, code max 64 KB
4. Implement basic health check: `GET /health`
5. Add `Dockerfile` for the executor service itself
6. Wire into root `package.json` scripts

**Deliverable**: `curl -X POST http://localhost:3002/execute -d '{"language":"javascript","code":"console.log(42)"}' --no-buffer` returns streamed output.

---

## Phase 2 — Docker Sandboxing (Day 2)

**Goal**: Each execution spawns a locked-down Docker container.

### Tasks
1. Implement `executeInDocker(language, code)` function in executor service
2. Write code to a temporary directory before mounting (read-only tmpfs approach)
3. Spawn `docker run` with all security flags:
   - `--network=none`
   - `--memory=64m`
   - `--cpus=0.5`
   - `--read-only`
   - `--user=nobody`
   - `--rm`
4. Get JavaScript working end-to-end first, then generalize
5. Stream stdout/stderr from the spawned process back through the HTTP response
6. Confirm `--network=none` actually blocks outbound access (test script)

**Docker invocation per language**:
```
javascript: docker run --network=none --memory=64m --cpus=0.5 --read-only --user=nobody --rm node:20-alpine node -e "<code>"
python:     docker run ... python:3.12-slim python3 -c "<code>"
java:       docker run ... openjdk:17-alpine sh -c "echo '<code>' > /tmp/Main.java && javac /tmp/Main.java -d /tmp && java -cp /tmp Main"
```

**Deliverable**: `console.log("hello")` runs inside a container and streams "hello". Network attempt from inside container fails.

---

## Phase 3 — Timeout & Resource Enforcement (Day 3)

**Goal**: Hard kill at 10 seconds; verify memory cap triggers OOM-kill.

### Tasks
1. Implement 10-second timeout: `setTimeout(() => child.kill('SIGKILL'), 10_000)`
2. Capture the timeout event and emit `exec-error` with `reason: "timeout"`
3. Capture OOM-kill (`exitCode === 137`) and emit `exec-error` with `reason: "oom"`
4. Test: submit deliberately looping code, confirm kill at 10s
5. Test: submit memory bomb (allocate >64MB), confirm OOM-kill triggers

**Deliverable**: Infinite loop is killed at 10s. Memory bomb triggers OOM-kill. Both produce appropriate error responses, not hangs.

---

## Phase 4 — WebSocket Output Streaming (Day 4)

**Goal**: Pipe execution output through the existing WebSocket to all room clients.

### New WebSocket Message Types

```typescript
// Client → Server (trigger execution)
{ type: "exec-run", roomId: string, language: string, code: string }

// Server → All clients in room (streaming output)
{ type: "exec-output", chunk: string, stream: "stdout" | "stderr" }

// Server → All clients in room (execution finished)
{ type: "exec-done", exitCode: number }

// Server → All clients in room (error)
{ type: "exec-error", reason: "timeout" | "oom" | "compile-error" | "service-unavailable", message: string }
```

### Tasks
1. Add `exec-run` message handler in the WebSocket server (`server/src/rooms.ts`)
2. In the handler, HTTP-POST to the executor service with `{language, code}`
3. Pipe each streamed chunk from the executor's HTTP response to all room clients as `exec-output`
4. On HTTP response end, broadcast `exec-done`
5. On HTTP error (executor down), broadcast `exec-error` with `reason: "service-unavailable"`
6. Add output truncation: accumulate byte count; once >50 KB, stop forwarding and send truncation notice

**Deliverable**: Click Run in browser → chunks appear in client output panel as they stream, not all at once after process exits.

---

## Phase 5 — Java Multi-Language + Polish (Day 5)

**Goal**: All three languages work end-to-end; Java handles compile vs runtime errors distinctly.

### Java Execution Flow
```bash
# Write code to temp file
echo '<code>' > /tmp/Main.java

# Compile
javac /tmp/Main.java -d /tmp
# If exit code != 0 → stream compile error as exec-error, STOP

# Run
java -cp /tmp Main
```

### Tasks
1. Implement Java two-step execution (compile, then run) in executor service
2. Distinguish compile errors (`exitCode !== 0` from `javac`) vs runtime errors
3. Stream compile errors as `exec-error` with `reason: "compile-error"`
4. Add `Run` button to client `Toolbar.tsx`
5. Add `OutputPanel` React component (scrollable, renders chunks incrementally)
6. Wire `exec-output`, `exec-done`, `exec-error` messages in the WebSocket client hook (`useWebSocket.ts`)
7. Verify: all three languages, all error types, broadcast to all room members

**Deliverable**: End-of-week check — all five acceptance criteria in spec pass.

---

## File Structure

```
executor/                          ← New microservice
├── Dockerfile
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                   ← HTTP server, POST /execute
    ├── docker-runner.ts           ← Spawns docker run, handles streams
    ├── languages.ts               ← Language config (image, command, timeout)
    └── executor.test.ts           ← Unit tests

server/src/
├── rooms.ts                       ← Add exec-run handler (MODIFIED)
└── executor-client.ts             ← HTTP client for executor service (NEW)

client/src/
├── components/
│   ├── Toolbar.tsx                ← Add Run button (MODIFIED)
│   └── OutputPanel.tsx            ← New streaming output display (NEW)
├── hooks/
│   └── useWebSocket.ts            ← Handle exec-* message types (MODIFIED)
└── pages/
    └── Room.tsx                   ← Wire OutputPanel (MODIFIED)
```

---

## Security Checklist

- [ ] `--network=none` verified to block outbound connections
- [ ] `--read-only` filesystem prevents code from writing to container FS
- [ ] `--user=nobody` prevents root-level container operations
- [ ] `--rm` ensures containers are cleaned up after each run
- [ ] Input validation: language enum enforced server-side before docker invocation
- [ ] Code length capped at 64 KB before reaching executor
- [ ] Executor service port not exposed in production Dockerfile
- [ ] No user identity passed to executor service (minimal attack surface)
- [ ] Timeout SIGKILL ensures no zombie processes
