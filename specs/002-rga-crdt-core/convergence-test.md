# Week 2 — Two-Tab Convergence Test Results

**Date**: (complete when running the app)
**Branch**: `002-rga-crdt-core`

## Instructions

1. Start the server: `npm run dev:server` (from repo root)
2. Start the client: `npm run dev:client`
3. Open `http://localhost:5173` in two browser windows
4. Create a room and open the same room URL in both windows
5. Run each test below

---

## Test Results

### Test 1 — Basic simultaneous type

- [ ] Both tabs open in same room
- [ ] Type "X" in tab A and "Y" in tab B at the same time (position 0)
- [ ] Both tabs show the same 2-character string within 500ms

**Result**: ___  
**Both showed**: ___

---

### Test 2 — Sequential edit propagation

- [ ] Type "Hello" in tab A
- [ ] Tab B shows "Hello" within 1 second

**Result**: ___

---

### Test 3 — Delete propagation

- [ ] Type "AB" in tab A (both tabs should show "AB")
- [ ] Delete "B" in tab A
- [ ] Tab B shows "A" within 1 second

**Result**: ___

---

### Test 4 — Concurrent delete + insert

- [ ] Both tabs show "AB"
- [ ] Delete "B" in tab A simultaneously with typing "X" after "B" in tab B
- [ ] Both tabs show the same final text (no corruption)

**Result**: ___  
**Both showed**: ___

---

### Test 5 — Paste propagation

- [ ] Paste 50 characters into tab A
- [ ] Tab B shows all 50 characters correctly within 1 second

**Result**: ___

---

### Test 6 — Reconnect after server restart

- [ ] Both tabs connected and in sync
- [ ] Kill the server (Ctrl+C)
- [ ] UI shows "connecting" or "error" badge
- [ ] Restart the server
- [ ] Both tabs reconnect and edits propagate again

**Result**: ___

---

## Sign-off

- [ ] All 6 tests pass
- [ ] No document corruption observed
- [ ] Ready for Week 3 (Presence)
