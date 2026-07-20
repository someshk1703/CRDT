# Tasks: Week 2 — RGA CRDT Core

**Feature**: `002-rga-crdt-core`
**Generated**: 2026-07-14
**Source**: spec.md + plan.md
**Tech Stack**: TypeScript 5 (strict) · Vitest · CodeMirror 6 · Node.js ws

---

## Summary

| Phase | Scope | Tasks |
|-------|-------|-------|
| 1 — CRDT Core | `shared/src/crdt.ts` | T001–T007 |
| 2 — Wire Protocol | `shared/src/index.ts` + server | T008–T010 |
| 3 — Client Integration | `useCRDT` hook + Room.tsx | T011–T015 |
| 4 — Tests | Unit tests + checklist | T016–T018 |

**Total tasks**: 18

---

## Phase 1 — CRDT Core Library

> Goal: `RGADocument` as pure TypeScript, no UI deps, fully unit-testable.
> MUST complete before Phase 2 and 3.

- [ ] **T001** Create `shared/src/crdt.ts` and export the `CRDTChar` interface:
  ```ts
  export interface CRDTChar {
    readonly id: string;          // "clientId:lamportTick"
    readonly value: string;
    readonly originId: string | null;
    deleted: boolean;
  }
  ```

- [ ] **T002** Add `LamportClock` class to `shared/src/crdt.ts`:
  - `private time = 0`
  - `tick(): number` → `return ++this.time`
  - `update(received: number): void` → `this.time = Math.max(this.time, received) + 1`
  - `now(): number` → `return this.time`

- [ ] **T003** Add `RGADocument` class skeleton to `shared/src/crdt.ts`:
  - `private chars: CRDTChar[] = []`
  - `private clock: LamportClock`
  - Constructor accepts `private readonly clientId: string`

- [ ] **T004** Implement `RGADocument.getText()` and `RGADocument.getVisibleLength()`:
  - `getText()`: join `value` of all non-tombstoned chars
  - `getVisibleLength()`: count non-tombstoned chars

- [ ] **T005** Implement `RGADocument.integrateInsert(char: CRDTChar): void`:
  - Find the index of `char.originId` in `this.chars` (−1 for `null` = head)
  - Starting from `originIndex + 1`, scan right while:
    - `this.chars[j].originId === char.originId` (same origin = concurrent)
    - AND `this.chars[j].id > char.id` (existing char's ID is lexicographically greater — it "wins")
  - Splice `char` into `this.chars` at index `j`
  - **This is the core tie-breaking step — review carefully against the plan**

- [ ] **T006** Implement `RGADocument.localInsert(visiblePos, value, clientId)`:
  - Scan visible chars to find left neighbour at `visiblePos` (null for position 0 / head insert)
  - Generate `id = clientId + ':' + this.clock.tick()`
  - Create `CRDTChar` with `originId` set to left neighbour's `id` (or `null`)
  - Call `this.integrateInsert(char)`
  - Return the new char (caller broadcasts it)

- [ ] **T007** Implement `RGADocument.localDelete(visiblePos)`, `remoteInsert(char)`, `remoteDelete(charId)`:
  - `localDelete(visiblePos)`: find the nth visible char, set `deleted = true`, return it
  - `remoteInsert(char)`: if `char.id` already in `chars` → no-op; else update clock via `this.clock.update(lamportFromId(char.id))`, then `integrateInsert(char)`
  - `remoteDelete(charId)`: find char by `id`; if found and not deleted, set `deleted = true`; else no-op
  - Helper `lamportFromId(id: string): number` extracts the tick from `"clientId:tick"` format

---

## Phase 2 — Wire Protocol

> Goal: Shared types carry CRDT ops; server broadcasts them to room members.
> Depends on T001 (CRDTChar type must exist).

- [ ] **T008** Update `shared/src/index.ts`:
  - Add `'crdt-insert'` and `'crdt-delete'` to `MessageType` union
  - Export `CRDTChar` (re-export from `./crdt.js`)
  - Add `CRDTInsertMessage` interface:
    ```ts
    export interface CRDTInsertMessage extends BaseMessage {
      type: 'crdt-insert';
      char: CRDTChar;
    }
    ```
  - Add `CRDTDeleteMessage` interface:
    ```ts
    export interface CRDTDeleteMessage extends BaseMessage {
      type: 'crdt-delete';
      charId: string;
    }
    ```
  - Add both to `AppMessage` union

- [ ] **T009** Update `server/src/index.ts` message handler — add routing for new types:
  ```ts
  case 'crdt-insert':
  case 'crdt-delete':
    roomManager.broadcast(client.roomId, data, client.id);
    break;
  ```
  - For `crdt-delete`: validate `typeof data.charId === 'string' && data.charId.length > 0`; if invalid, log and skip without crashing

- [ ] **T010** Verify TypeScript compiles cleanly across all three workspaces after T008–T009:
  ```bash
  npm run typecheck -w shared && npm run typecheck -w server && npm run typecheck -w client
  ```
  (Add `"typecheck": "tsc --noEmit"` scripts if missing)

---

## Phase 3 — Client Integration

> Goal: `useCRDT` hook bridges `RGADocument` to CodeMirror and `useWebSocket`.
> Depends on Phase 1 + Phase 2.

- [ ] **T011** Create `client/src/hooks/useCRDT.ts`:
  - Import `RGADocument`, `LamportClock`, `CRDTChar` from `@crdt/shared`
  - Import `CRDTInsertMessage`, `CRDTDeleteMessage`, `AppMessage` from `@crdt/shared`
  - Export `useCRDT(send, userId)` returning `{ extensions, applyRemoteOp }`
  - Internal refs: `docRef = useRef(new RGADocument(userId))`, `viewRef = useRef<EditorView|null>(null)`

- [ ] **T012** Implement local change → CRDT op in `useCRDT`:
  - Create a `EditorView.updateListener.of(update => { ... })` extension
  - On `update.docChanged`, iterate `update.transactions` → `tr.changes.iterChanges`
  - For each inserted character range: call `doc.localInsert(visiblePos, char, userId)` and `send({ type:'crdt-insert', userId, roomId, char })`
  - For each deleted range: call `doc.localDelete(visiblePos)` per character and `send({ type:'crdt-delete', userId, roomId, charId })`
  - Store `viewRef` via a `ViewPlugin` that sets `viewRef.current = view` on `create`

- [ ] **T013** Implement `applyRemoteOp` in `useCRDT`:
  - If `msg.type === 'crdt-insert'`: snapshot `prevText = doc.getText()`, `doc.remoteInsert(msg.char)`, compute diff, dispatch CodeMirror transaction
  - If `msg.type === 'crdt-delete'`: snapshot, `doc.remoteDelete(msg.charId)`, compute diff, dispatch
  - Diff strategy for Week 2: if `newText !== prevText`, find first differing position (`from`) and last differing position (`to`), dispatch `{ from, to, insert: newText.slice(from, newText.length - (prevText.length - to)) }`
  - Guard: if `viewRef.current` is null, no-op

- [ ] **T014** Update `client/src/pages/Room.tsx`:
  - Add `userId` ref: `const userIdRef = useRef(crypto.randomUUID())`
  - Call `const { extensions, applyRemoteOp } = useCRDT(send, userIdRef.current)`
  - In `useWebSocket` options, set `onMessage: applyRemoteOp`
  - In `EditorView` constructor, spread `extensions` into the extensions array
  - Remove the Week 1 `EditorView.updateListener` raw-op broadcaster block
  - Remove `broadcastLog` state and its render (replaced by actual sync)

- [ ] **T015** Add `roomId` to CRDT messages in `useCRDT`:
  - `useCRDT` needs access to `roomId`; thread it as a parameter: `useCRDT(send, userId, roomId)`
  - Update `Room.tsx` to pass `roomId` (already available from `useParams`)

---

## Phase 4 — Tests

> Goal: Unit tests for RGADocument; manual convergence checklist.

- [ ] **T016** Create `shared/src/crdt.test.ts` with Vitest:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { LamportClock, RGADocument } from './crdt.js';
  ```
  Tests to include:
  - `LamportClock`: tick sequence (1,2,3), `update` sets clock correctly
  - `RGADocument`: single insert, multiple sequential inserts, `getText` result
  - `localDelete`: tombstone set, getText excludes deleted, physical char remains
  - Concurrent same-origin inserts → both docs converge (apply ops in opposite order)
  - Concurrent insert+delete → no corruption
  - `remoteInsert` idempotency (apply same char twice → no duplicate)
  - `remoteDelete` idempotency + unknown-charId no-op

- [ ] **T017** Add Vitest `test` script to `shared/package.json` if not present:
  ```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
  ```
  Run `npm test -w shared` and confirm all tests pass.

- [ ] **T018** Manual two-tab convergence checklist (document results in `specs/002-rga-crdt-core/convergence-test.md`):
  - [ ] Tab A types "Hello", Tab B types " World" at end — both show "Hello World"
  - [ ] Both tabs type at position 0 simultaneously — both show same 2-char result
  - [ ] Delete char in tab A while tab B inserts at same position — no corruption
  - [ ] Paste 50 chars in tab A — tab B shows all 50 chars
  - [ ] Kill and restart server — after reconnect, edits propagate again (Week 1 backoff still works)

---

## Dependency Order

```
T001 → T002 → T003 → T004 → T005 → T006 → T007
                                              ↓
                                    T008 (add types)
                                              ↓
                                    T009 (server routing)
                                              ↓
                                    T010 (typecheck)
                                              ↓
                               T011 → T012 → T013 → T015 → T014
                                              ↓
                                    T016 → T017
                                              ↓
                                           T018
```

T016 (unit tests) can be written in parallel with T011–T015 once T007 is done.
