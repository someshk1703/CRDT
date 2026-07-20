# Tasks 003 — Week 3: Presence (Live Cursors & Awareness)

Status legend: ☐ not started · ⏳ in-progress · ✅ done

---

## Day 1 — Presence Protocol

### T-001 ✅ Add `WelcomeMessage` to shared types
- File: `shared/src/index.ts`
- Add `WelcomeMessage { type: 'welcome'; userId: string; roomId: string; color: string }`
- Add `'welcome'` to `MessageType` union
- Add `WelcomeMessage` to `AppMessage` union

### T-002 ✅ Server: send `welcome` message on connect
- File: `server/src/index.ts`
- After `roomManager.join(...)`, send `{type:'welcome', userId: client.userId, roomId, color: client.color}` to the connecting socket only

### T-003 ✅ Server: track client's self-reported userId for `user-left`
- File: `server/src/room-manager.ts`
- Add `presenceUserId?: string` to `Client` interface
- File: `server/src/index.ts`
- When a message with `msg.userId` arrives, set `client.presenceUserId = msg.userId`
- In `ws.on('close')`, use `client.presenceUserId ?? client.userId` in `user-left` broadcast

### T-004 ✅ Server: validate & relay `presence` messages
- File: `server/src/index.ts`
- Add validation: `cursor.from/to` must be numbers, `name` must be a non-empty string ≤ 64 chars
- Allow the message to fall through to the existing broadcast (no special routing needed)

---

## Day 2 — Cursor Rendering

### T-005 ✅ Create `presenceCursors` CodeMirror extension
- File: `client/src/extensions/presenceCursors.ts` (NEW)
- Export `PresenceState` interface `{ cursor: {from,to}; name: string; color: string }`
- Export `updatePresenceEffect` (StateEffect)
- Export `presenceField` (StateField holding `ReadonlyMap<string, PresenceState>`)
- Export `presenceCursors` (Extension = [presenceField, presencePlugin])
- `CursorWidget`: coloured 2px caret + floating name label (no DOM event handling)
- `buildDecorations`: clamp positions to `[0, doc.length]`; mark for ranges, widget for caret

### T-006 ✅ Create `usePresence` hook
- File: `client/src/hooks/usePresence.ts` (NEW)
- Parameters: `userId`, `roomId`, `send`
- Returns: `handleMessage`, `sendPresence`, `setView`, `extensions`, `reconcileCursors`
- `handleMessage`: routes `welcome` (stores color), `presence` (dispatch effect), `user-left` (dispatch null effect)
- `sendPresence`: debounced 50 ms; sends `{type:'presence', userId, roomId, cursor, name, color}`
- `reconcileCursors(from, removed, inserted)`: walks all tracked cursors through the adjustment formula and dispatches updated effects

---

## Day 3 — Throttling & Offline Cleanup

### T-007 ✅ Debounce outgoing presence at 50 ms
- Already built into `usePresence.sendPresence` (T-006)
- The cursor extension fires `sendPresence` on `selectionSet`; debounce ensures ≤1 message per 50 ms

### T-008 ✅ `user-left` cleanup
- Already built into `usePresence.handleMessage` (T-006) and server T-003

---

## Day 4 — Selection Highlighting

### T-009 ✅ Selection range highlight in `presenceCursors`
- Already built into `buildDecorations` (T-005)
- `Decoration.mark` applied when `from !== to`; background at 25% opacity, bottom border at 60%

---

## Day 5 — Cursor Reconciliation

### T-010 ✅ Extend `useCRDT` with `onRemoteChange` callback
- File: `client/src/hooks/useCRDT.ts`
- Add optional `options?: { onRemoteChange?: (from, removed, inserted) => void }` parameter
- After `applyTextDiff`, compute diff info and call `options.onRemoteChange` if set
- Refactor `applyTextDiff` → extract `computeDiff` to expose `{from, prevEnd, newEnd}`

### T-011 ✅ Wire cursor reconciliation in `Room.tsx`
- Pass `reconcileCursors` from `usePresence` as `onRemoteChange` to `useCRDT`
- Combine `applyRemoteOp` + `usePresence.handleMessage` into single `handleMessage` passed to `useWebSocket`
- Register `setView` for both `useCRDT` and `usePresence` after editor mount
- Include presence extensions in `EditorView` constructor

---

## Integration

### T-012 ✅ Update `Room.tsx` to integrate full Week 3
- File: `client/src/pages/Room.tsx`
- Add presence extensions to editor
- Show user's own colour dot in the header

---

## Acceptance Tests (manual, two tabs)

- [ ] Tab A and Tab B see each other's carets with correct name and colour
- [ ] Tab A selects a range → Tab B sees the highlighted range in Tab A's colour
- [ ] Tab B types before Tab A's cursor → Tab A's cursor shifts correctly
- [ ] Close Tab A → Tab B's view of A's cursor disappears immediately
- [ ] Network throttle to slow 3G, type 10 chars fast → at most ~200 ms of presence messages (50ms × 4 messages), not one per char
