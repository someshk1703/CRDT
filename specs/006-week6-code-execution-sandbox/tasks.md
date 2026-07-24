# Tasks: Week 6 — Code Execution Sandbox

**Feature Branch**: `006-week6-code-execution-sandbox`  
**Created**: 2026-07-24  
**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

---

## Phase 1 — Execution Microservice Scaffold

### TASK-001: Initialize executor service structure
- [ ] Create `executor/` directory
- [ ] Create `executor/package.json` with dependencies: `express`, `@types/express`, `typescript`, `ts-node`
- [ ] Create `executor/tsconfig.json` extending `tsconfig.base.json`
- [ ] Create `executor/src/index.ts` with Express app, `POST /execute`, `GET /health`
- [ ] Add `executor` to root `package.json` workspaces array
- [ ] Add `dev:executor` and `build:executor` scripts to root `package.json`
- **Acceptance**: `cd executor && npm run dev` starts without errors; `GET /health` returns `{"status":"ok"}`

### TASK-002: Implement input validation in executor
- [ ] Validate `language` is one of `"javascript" | "python" | "java"`
- [ ] Validate `code` is a non-empty string, max 65536 bytes
- [ ] Return HTTP 400 with descriptive error for invalid input
- **Acceptance**: POSTing `{"language":"ruby","code":"puts 1"}` returns 400

### TASK-003: Create executor Dockerfile
- [ ] Write `executor/Dockerfile` using `node:20-alpine` base
- [ ] Install Docker CLI inside the image (needed to spawn sibling containers)
- [ ] Add `executor` service to `docker-compose.yml` (or create one if absent)
- **Acceptance**: `docker build -t crdt-executor executor/` succeeds

---

## Phase 2 — Docker Sandboxing

### TASK-004: Implement `languages.ts` config
- [ ] Create `executor/src/languages.ts`
- [ ] Define per-language config: Docker image name, command template, file extension
  ```typescript
  export const LANGUAGES = {
    javascript: { image: "node:20-alpine", cmd: (code: string) => ["node", "-e", code] },
    python:     { image: "python:3.12-slim", cmd: (code: string) => ["python3", "-c", code] },
    java:       { image: "openjdk:17-alpine", twoStep: true }
  }
  ```
- **Acceptance**: Config exports are importable and fully typed

### TASK-005: Implement `docker-runner.ts` for JavaScript
- [ ] Create `executor/src/docker-runner.ts`
- [ ] Implement `runInDocker(language, code)` that spawns `docker run` with flags:
  - `--network=none`
  - `--memory=64m`
  - `--cpus=0.5`
  - `--read-only`
  - `--user=nobody`
  - `--rm`
- [ ] Stream `stdout` and `stderr` from the child process
- [ ] Wire `POST /execute` to call `runInDocker` and pipe output as chunked HTTP response
- **Acceptance**: `curl -N http://localhost:3002/execute -d '{"language":"javascript","code":"console.log(42)"}'` prints `42`

### TASK-006: Verify network isolation
- [ ] Write a test script: JS code that does `const https = require('https'); https.get('https://example.com', ...)`
- [ ] Run it through the executor and confirm the network call fails with a connection error
- [ ] Document the result in `specs/006-week6-code-execution-sandbox/security-test.md`
- **Acceptance**: Network request from inside container fails; no external connection established

---

## Phase 3 — Timeout & Resource Enforcement

### TASK-007: Implement 10-second hard timeout
- [ ] In `docker-runner.ts`, start a `setTimeout` of 10,000ms after spawning the container
- [ ] On timeout: call `child.kill('SIGKILL')` to send SIGKILL to the docker process
- [ ] Set a `timedOut` flag; when `child` closes after SIGKILL, emit `exec-error` with `reason: "timeout"`
- [ ] Clear the timeout when the process exits normally
- **Acceptance**: Submitting `while(true){}` produces a timeout error message within 11 seconds

### TASK-008: Handle OOM-kill (exit code 137)
- [ ] In the process `close` handler, check if `exitCode === 137` (OOM-kill)
- [ ] If so, emit `exec-error` with `reason: "oom"` and message "Memory limit exceeded"
- [ ] Write a test: allocate a large buffer in a loop until process is killed
- **Acceptance**: Memory bomb script triggers OOM-kill; `reason: "oom"` is returned

### TASK-009: Write executor unit tests
- [ ] Create `executor/src/executor.test.ts`
- [ ] Test: normal JS execution returns correct output
- [ ] Test: timeout produces `reason: "timeout"` within 11 seconds
- [ ] Test: invalid language returns 400
- [ ] Test: output >50 KB is truncated with a truncation notice
- **Acceptance**: All tests pass via `npm test` in `executor/`

---

## Phase 4 — WebSocket Output Streaming

### TASK-010: Create `executor-client.ts` in server
- [ ] Create `server/src/executor-client.ts`
- [ ] Implement `streamExecution(language, code, onChunk, onDone, onError)` function
  - POSTs to `http://localhost:3002/execute` (URL from env var `EXECUTOR_URL`)
  - Calls `onChunk(chunk, stream)` for each streamed line/chunk
  - Calls `onDone(exitCode)` when HTTP response ends
  - Calls `onError(reason, message)` when HTTP request fails or executor is down
- [ ] Add `EXECUTOR_URL` to server's env configuration with default `http://localhost:3002`
- **Acceptance**: Unit test that mocks the executor HTTP response confirms callbacks fire correctly

### TASK-011: Add `exec-run` WebSocket message handler
- [ ] In `server/src/rooms.ts`, add handler for incoming message type `"exec-run"`
- [ ] Extract `{ roomId, language, code }` from the message
- [ ] Validate `code` length ≤ 65536 bytes server-side
- [ ] Call `streamExecution()` from `executor-client.ts`
- [ ] In `onChunk`: broadcast `{ type: "exec-output", chunk, stream }` to all clients in the room
- [ ] In `onDone`: broadcast `{ type: "exec-done", exitCode }` to all clients in the room
- [ ] In `onError`: broadcast `{ type: "exec-error", reason, message }` to all clients in the room
- **Acceptance**: WebSocket message triggers execution; all room clients receive streamed output

### TASK-012: Implement 50 KB output truncation
- [ ] In `executor-client.ts`, track accumulated byte count across chunks
- [ ] Once total exceeds 50,000 bytes, stop forwarding chunks and call `onChunk("...[output truncated at 50KB]", "stdout")`
- [ ] Then call `onDone(-1)` to signal completion
- **Acceptance**: Submitting code that prints 100 KB of output produces truncation notice at ≤50 KB

---

## Phase 5 — Java Multi-Language & Client UI

### TASK-013: Implement Python execution
- [ ] Add Python support in `docker-runner.ts` using `python:3.12-slim`
- [ ] Run Python code with `python3 -c "<code>"`
- [ ] Test: `print("hello from python")` returns correct output
- **Acceptance**: Python Hello World executes and streams output

### TASK-014: Implement Java two-step execution
- [ ] In `docker-runner.ts`, add special path for `language === "java"`:
  1. Write code to a temp file on the host (or use stdin piping)
  2. Spawn `docker run ... openjdk:17-alpine sh -c "mkdir -p /tmp/exec && cat > /tmp/exec/Main.java && javac /tmp/exec/Main.java -d /tmp/exec && java -cp /tmp/exec Main"`
  3. Pipe code via stdin to the container
- [ ] If `javac` exits non-zero, emit `exec-error` with `reason: "compile-error"` and stderr as message
- [ ] If `java` exits non-zero after a successful compile, emit the stderr as `exec-output` (runtime error, not compile error)
- **Acceptance**: Java Hello World runs; syntax error returns compile-error; `NullPointerException` returns runtime stack trace

### TASK-015: Add Run button to client Toolbar
- [ ] In `client/src/components/Toolbar.tsx`, add a "Run ▶" button
- [ ] Button sends `{ type: "exec-run", roomId, language, code }` via WebSocket
- [ ] Button shows loading state while execution is in progress (disabled until `exec-done` or `exec-error`)
- [ ] Language comes from current room language state
- [ ] Code comes from the current CodeMirror editor content
- **Acceptance**: Clicking Run sends the correct WebSocket message with current editor content

### TASK-016: Create `OutputPanel` React component
- [ ] Create `client/src/components/OutputPanel.tsx`
- [ ] Renders a scrollable panel showing execution output
- [ ] Appends chunks as they arrive (does not batch)
- [ ] Distinguishes stdout (default text) and stderr (red/orange text)
- [ ] Displays "Execution complete (exit 0)" on `exec-done`
- [ ] Displays timeout/OOM/compile error in a distinct error style on `exec-error`
- [ ] Has a "Clear" button to reset the output panel
- **Acceptance**: Output panel shows incremental chunks; does not wait for full execution to display

### TASK-017: Wire execution messages in `useWebSocket.ts`
- [ ] Add state: `outputLines: OutputLine[]`, `isRunning: boolean`
- [ ] On `exec-output`: append `{ chunk, stream }` to `outputLines`
- [ ] On `exec-done`: set `isRunning = false`
- [ ] On `exec-error`: append error message to `outputLines`, set `isRunning = false`
- [ ] Expose `sendRun(code: string)` helper from the hook
- **Acceptance**: Receiving mocked WebSocket messages updates state correctly

### TASK-018: Integrate OutputPanel into Room page
- [ ] In `client/src/pages/Room.tsx`, mount `<OutputPanel />` below the editor
- [ ] Pass `outputLines` and `isRunning` as props
- [ ] Wire `Toolbar` Run button to call `sendRun(editorContent)`
- [ ] Add vertical layout to accommodate editor + output panel
- **Acceptance**: Full end-to-end: click Run → output streams live in panel below editor

---

## Phase 6 — Documentation & Final Verification

### TASK-019: Update server Dockerfile and docker-compose
- [ ] Ensure `docker-compose.yml` includes both `server` and `executor` services
- [ ] Executor service has access to Docker socket (volume mount `/var/run/docker.sock`)
- [ ] Add `EXECUTOR_URL` env var to `server` service pointing to executor
- [ ] Add health check for executor in compose config
- **Acceptance**: `docker compose up` starts both services; health checks pass

### TASK-020: End-to-end verification
- [ ] Run all five Week 6 success criteria checks:
  - [ ] SC-001: JS, Python, Java Hello World each produce output within 5s
  - [ ] SC-002: Infinite loop killed at 10s with timeout message
  - [ ] SC-003: Network access attempt from sandbox fails
  - [ ] SC-004: Output visible on all connected clients (test with 2 windows)
  - [ ] SC-005: Collaboration works normally during active execution
  - [ ] SC-006: Executor down → Run returns error, collaboration unaffected
  - [ ] SC-007: Java syntax error produces readable compile-error message
- [ ] Document results in `specs/006-week6-code-execution-sandbox/verification.md`

### TASK-021: Update README
- [ ] Add "Week 6: Code Execution Sandbox" section to root `README.md`
- [ ] Document how to run the executor service locally
- [ ] Document Docker image pre-pull commands
- [ ] Add note about the Java `public class Main` convention
- [ ] Update the "Week 7 — hardening" known gaps section

---

## Task Summary

| Phase | Tasks | Priority |
|-------|-------|----------|
| 1 — Microservice scaffold | TASK-001, TASK-002, TASK-003 | P1 |
| 2 — Docker sandboxing | TASK-004, TASK-005, TASK-006 | P1 |
| 3 — Timeout & resource limits | TASK-007, TASK-008, TASK-009 | P1 |
| 4 — WebSocket streaming | TASK-010, TASK-011, TASK-012 | P1 |
| 5 — Multi-language & client UI | TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018 | P1/P2 |
| 6 — Docs & verification | TASK-019, TASK-020, TASK-021 | P2 |

**Critical path**: TASK-001 → TASK-005 → TASK-007 → TASK-010 → TASK-011 → TASK-015 → TASK-016 → TASK-018
