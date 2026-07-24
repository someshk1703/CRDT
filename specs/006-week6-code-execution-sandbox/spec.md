# Feature Specification: Week 6 — Code Execution Sandbox

**Feature Branch**: `006-week6-code-execution-sandbox`  
**Created**: 2026-07-24  
**Status**: Draft  
**Input**: Week 6 context — Run button, Docker sandboxing, output streaming over WebSocket

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Run Code in a Collaborative Session (Priority: P1)

Any user in a room clicks the "Run" button. The current contents of the shared editor are sent for execution, and output streams live to **every** connected user in the room — not just the person who clicked Run. This turns the collaboration tool into a shared IDE.

**Why this priority**: This is the defining feature of Week 6. All other stories (sandboxing, multi-language, streaming) exist to support this one interaction safely.

**Independent Test**: Open the same room in two browser windows. In window A, click Run on a JavaScript `console.log("hello")` snippet. Confirm window B also sees `hello` appear in the output panel without refreshing.

**Acceptance Scenarios**:

1. **Given** a room with code in the editor, **When** any connected user clicks Run, **Then** an execution request is submitted and an output panel appears for all connected users.
2. **Given** a running execution, **When** the program produces stdout/stderr, **Then** each output chunk streams to all connected users' output panels incrementally — not as a single batch at the end.
3. **Given** a successfully completed execution, **When** the process exits, **Then** all users see the final output and the output panel indicates the run has completed.
4. **Given** a run in progress, **When** Run is clicked again, **Then** the prior execution is terminated and a new one begins.

---

### User Story 2 — Sandboxed Execution with Hard Limits (Priority: P1)

A user submits code that contains an infinite loop, a network request, or attempts to exhaust memory. The sandbox enforces a 10-second timeout, blocks all outbound network access, and caps memory. The execution is terminated cleanly, with an appropriate error streamed to the output panel. The main collaboration server is completely unaffected.

**Why this priority**: Without enforced limits, a single malicious or buggy submission can take down the entire service. Safety gates are non-negotiable before any code runs.

**Independent Test**: Submit `while(true){}` (JavaScript). Confirm the execution is killed after 10 seconds and a timeout error is shown. Submit code that attempts a network fetch — confirm it fails.

**Acceptance Scenarios**:

1. **Given** code containing an infinite loop, **When** Run is clicked, **Then** the execution is forcibly terminated after 10 seconds and a timeout message is streamed to the output panel.
2. **Given** code that attempts outbound network access, **When** the code runs inside the sandbox, **Then** the network call fails and no real outbound connection is established.
3. **Given** code designed to allocate memory beyond the 64 MB cap, **When** it runs in the sandbox, **Then** the process is OOM-killed and an out-of-memory error is streamed.
4. **Given** a sandbox crash inside the execution container, **When** it occurs, **Then** the collaboration WebSocket server continues operating normally.

---

### User Story 3 — Multi-Language Execution (Priority: P2)

The room's current language setting (JavaScript, Python, or Java) determines which runtime is used when Run is clicked. A Python room runs Python code; a Java room compiles and then runs Java. Compile-time errors in Java are reported distinctly from runtime errors.

**Why this priority**: Language selection was delivered in Week 5. Multi-language is not a prerequisite to prove the sandbox works (P1 does that for JS), but it dramatically raises the value of the feature.

**Independent Test**: Create three rooms with different language settings. In each, write a Hello World. Click Run. Confirm correct output. In the Java room, introduce a syntax error and confirm a compile-time error (not a runtime crash) is returned.

**Acceptance Scenarios**:

1. **Given** a room with JavaScript selected, **When** Run is clicked, **Then** the code is executed using a Node.js runtime and output is streamed.
2. **Given** a room with Python selected, **When** Run is clicked, **Then** the code is executed using a Python 3 runtime and output is streamed.
3. **Given** a room with Java selected, **When** Run is clicked, **Then** the code is first compiled, then executed using a Java runtime, and both compile output and run output are streamed.
4. **Given** a Java room with a syntax error, **When** Run is clicked, **Then** a compile-time error message is streamed and no execution is attempted.
5. **Given** a Java room with valid code that throws a runtime exception, **When** it runs, **Then** the stack trace is streamed as stderr output.

---

### User Story 4 — Execution Service Isolation (Priority: P1)

The code execution logic runs as a separate microservice, physically decoupled from the main WebSocket collaboration server. The execution service receives only `{language, code}` — no user identity, no room state, no WebSocket connections.

**Why this priority**: Physical separation is the architectural guarantee that a sandbox failure cannot cascade to the collaboration layer.

**Independent Test**: Kill the execution service while a WebSocket collaboration session is active. Confirm document edits continue to sync normally, and Run returns a "service unavailable" error rather than crashing the room.

**Acceptance Scenarios**:

1. **Given** the execution service is down, **When** a user clicks Run, **Then** the WebSocket server streams an error message to the output panel and continues operating normally.
2. **Given** a request to the execution service, **When** the service receives it, **Then** it accepts only `{language, code}` fields — any additional fields are ignored.

---

### Edge Cases

- What happens when the Docker daemon is unavailable? → Stream an error to the output panel; do not hang.
- What happens when code produces no output before the timeout? → Stream the timeout message; output panel is not left blank.
- What happens when stdout is extremely large (e.g., 1M lines)? → Truncate at 50 KB and stream a truncation notice.
- What happens when a user disconnects mid-execution? → Execution continues; remaining clients still receive output.
- What happens when Java's class name doesn't match `Main`? → Compile error is streamed; execution is not attempted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a dedicated execution microservice that is physically separate from the WebSocket collaboration server.
- **FR-002**: The execution microservice MUST accept `{language, code}` over HTTP and return streamed output.
- **FR-003**: Each code execution MUST run inside an isolated Docker container with no persistent state between runs.
- **FR-004**: Containers MUST enforce `--network=none` (no outbound internet access).
- **FR-005**: Containers MUST enforce a memory limit of 64 MB.
- **FR-006**: Containers MUST enforce a CPU limit of 0.5 cores.
- **FR-007**: Containers MUST use a read-only filesystem.
- **FR-008**: Containers MUST run as a non-root user (`--user=nobody`).
- **FR-009**: Every execution MUST have a hard 10-second timeout; the container is killed after that interval.
- **FR-010**: Execution output (stdout and stderr) MUST be streamed chunk-by-chunk over the existing WebSocket connection using message type `exec-output`.
- **FR-011**: Execution completion MUST be delivered over WebSocket as message type `exec-done`.
- **FR-012**: Execution timeout MUST be delivered over WebSocket as message type `exec-error` with a timeout reason.
- **FR-013**: Execution output MUST be broadcast to **all** connected users in the room, not only the initiating user.
- **FR-014**: System MUST support JavaScript (Node.js 20), Python 3.12, and Java 17 runtimes.
- **FR-015**: For Java executions, the system MUST perform a compile step (`javac`) before running; compile errors MUST be streamed as `exec-error` without attempting execution.
- **FR-016**: The client MUST render a "Run" button in the editor toolbar.
- **FR-017**: The client MUST display an output panel that renders streaming chunks incrementally as they arrive.
- **FR-018**: If the execution service is unavailable, the WebSocket server MUST stream an `exec-error` message and MUST NOT crash or disconnect any rooms.
- **FR-019**: Stdout output MUST be truncated at 50 KB; if truncated, a truncation notice MUST be appended.

### Key Entities

- **ExecutionRequest**: `{ language: "javascript" | "python" | "java", code: string, roomId: string }`
- **ExecOutputMessage**: `{ type: "exec-output", chunk: string, stream: "stdout" | "stderr" }`
- **ExecDoneMessage**: `{ type: "exec-done", exitCode: number }`
- **ExecErrorMessage**: `{ type: "exec-error", reason: "timeout" | "oom" | "compile-error" | "service-unavailable", message: string }`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A valid JavaScript, Python, and Java Hello World program each produce correct output within 5 seconds of clicking Run.
- **SC-002**: An infinite loop program is forcibly terminated within 11 seconds (10s timeout + 1s grace), and a timeout message is visible in the output panel.
- **SC-003**: A network access attempt from inside the sandbox fails — no outbound connection is established.
- **SC-004**: Output is visible in the output panels of all connected room members, not only the initiating user.
- **SC-005**: The collaboration server remains fully operational while an execution is in progress.
- **SC-006**: Stopping the execution service does not disconnect or degrade any active WebSocket room sessions.
- **SC-007**: Java compile errors produce a user-readable error message rather than a silent failure.

## Dependencies & Assumptions

- **Prior Features**: Auth (Week 5), WebSocket transport (Week 1), language setting per room (Week 5)
- **Infrastructure**: Docker must be installed on the execution service host with daemon running
- **Assumption**: Docker images (`node:20-alpine`, `python:3.12-slim`, `openjdk:17-alpine`) are pre-pulled to avoid cold-start latency
- **Assumption**: The execution microservice runs on the same host or Docker network as the WebSocket server and communicates over HTTP on a private port (not exposed publicly)
- **Assumption**: Java code is expected to define `public class Main` with `public static void main(String[] args)` — documented in the UI
- **Assumption**: The existing WebSocket message protocol is frozen; new message types are additive and backward-compatible
- **Out of scope**: Persistent execution history, user-triggered cancellation, execution quotas per user, languages beyond JS/Python/Java
