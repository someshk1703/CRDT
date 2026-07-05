/**
 * Week 1 automated validation script.
 * Covers: US3 broadcast isolation, US4 reconnect backoff, US5 two-client round-trip.
 *
 * Run: node validate-week1.mjs
 * Requires: server running on ws://localhost:3001
 */

import { createConnection } from 'net';
import http from 'http';
import { WebSocket } from 'ws';

const WS = 'ws://localhost:3001';
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36m·\x1b[0m';

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3001${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function connectWS(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}

function nextMessage(ws, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(t);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function closeAll(...sockets) {
  sockets.forEach((ws) => { try { ws.close(); } catch {} });
}

// ──────────────────────────────────────────────────────────────────────────────

async function testServerReachable() {
  console.log('\n[Test 0] Server reachability');
  try {
    const { status, body } = await httpGet('/health');
    assert('GET /health returns 200', status === 200);
    assert('status field is "ok"', body.status === 'ok');
    assert('connections field present', typeof body.connections === 'number');
    assert('rooms field present', typeof body.rooms === 'number');
  } catch (e) {
    assert('Server is reachable', false, e.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

async function testRoomIdValidation() {
  console.log('\n[Test 1] roomId validation (NFR-004)');

  // Invalid roomId should close with 1008
  const invalidCases = [
    { url: `${WS}/room/../secret`, label: 'path traversal' },
    { url: `${WS}/room/${'a'.repeat(65)}`, label: '>64 chars' },
    { url: `${WS}/room/<script>`, label: 'special chars' },
  ];

  for (const { url, label } of invalidCases) {
    await new Promise((resolve) => {
      const ws = new WebSocket(url);
      let timer;
      ws.once('close', (code) => {
        clearTimeout(timer);
        assert(`Invalid roomId "${label}" rejected with 1008`, code === 1008, `got ${code}`);
        resolve();
      });
      timer = setTimeout(() => {
        assert(`Invalid roomId "${label}" close event received`, false, 'timed out');
        resolve();
      }, 2000);
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────

async function testBroadcast() {
  console.log('\n[Test 2] US3 broadcast — sender excluded, receiver gets message');
  let wsA, wsB;
  try {
    wsA = await connectWS(`${WS}/room/test-room-1`);
    wsB = await connectWS(`${WS}/room/test-room-1`);

    // Drain user-joined events
    await sleep(200);

    const payload = { type: 'op', userId: 'user-a', roomId: 'test-room-1', payload: { from: 0, to: 0, insert: 'hello' } };
    const receivedByB = nextMessage(wsB, 2000);

    // Ensure wsA doesn't receive its own message
    let aSawOwnMessage = false;
    wsA.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'op') aSawOwnMessage = true;
    });

    wsA.send(JSON.stringify(payload));

    const msg = await receivedByB;
    assert('Tab B received the broadcast', msg.type === 'op', JSON.stringify(msg));
    assert('Broadcast payload matches sent payload', msg.payload?.insert === 'hello');
    await sleep(100);
    assert('Tab A did NOT receive its own message', !aSawOwnMessage);
  } catch (e) {
    assert('Broadcast test completed', false, e.message);
  } finally {
    closeAll(wsA, wsB);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

async function testRoomIsolation() {
  console.log('\n[Test 3] US5 room isolation — cross-room leakage PROHIBITED');
  let wsA, wsB;
  try {
    wsA = await connectWS(`${WS}/room/room-aaa`);
    wsB = await connectWS(`${WS}/room/room-bbb`);
    await sleep(200);

    let bReceivedMessage = false;
    wsB.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'op') bReceivedMessage = true;
    });

    wsA.send(JSON.stringify({ type: 'op', userId: 'u1', roomId: 'room-aaa', payload: { from: 0, to: 0, insert: 'secret' } }));

    await sleep(500);
    assert('Message in room-aaa NOT received by room-bbb client', !bReceivedMessage);
  } catch (e) {
    assert('Room isolation test completed', false, e.message);
  } finally {
    closeAll(wsA, wsB);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

async function testRoomCleanup() {
  console.log('\n[Test 4] US3 RoomManager cleanup on disconnect');
  let ws;
  try {
    const before = (await httpGet('/health')).body;
    ws = await connectWS(`${WS}/room/cleanup-test`);
    await sleep(200);
    const during = (await httpGet('/health')).body;
    assert('Connection count increases on join', during.connections > before.connections,
      `before=${before.connections} during=${during.connections}`);
    ws.close();
    await sleep(300);
    const after = (await httpGet('/health')).body;
    assert('Connection count decreases after close', after.connections <= before.connections,
      `expected ≤${before.connections} got ${after.connections}`);
  } catch (e) {
    assert('Cleanup test completed', false, e.message);
  } finally {
    closeAll(ws);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

async function testUserJoinedBroadcast() {
  console.log('\n[Test 5] user-joined event broadcast to existing peers');
  let wsA, wsB;
  try {
    wsA = await connectWS(`${WS}/room/join-test`);
    await sleep(100);

    const joinEvent = nextMessage(wsA, 2000);
    wsB = await connectWS(`${WS}/room/join-test`);
    const msg = await joinEvent;

    assert('Existing peer receives user-joined event', msg.type === 'user-joined',
      `got type="${msg.type}"`);
    assert('user-joined has userId', typeof msg.userId === 'string');
    assert('user-joined has color', typeof msg.color === 'string');
  } catch (e) {
    assert('user-joined test completed', false, e.message);
  } finally {
    closeAll(wsA, wsB);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

async function testUserLeftBroadcast() {
  console.log('\n[Test 6] user-left event broadcast on disconnect');
  let wsA, wsB;
  try {
    wsA = await connectWS(`${WS}/room/left-test`);
    wsB = await connectWS(`${WS}/room/left-test`);
    await sleep(200);

    const leftEvent = nextMessage(wsA, 2000);
    wsB.close();
    const msg = await leftEvent;

    assert('Remaining peer receives user-left event', msg.type === 'user-left',
      `got type="${msg.type}"`);
    assert('user-left has userId', typeof msg.userId === 'string');
  } catch (e) {
    assert('user-left test completed', false, e.message);
  } finally {
    closeAll(wsA, wsB);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

async function testMessageSizeGuard() {
  console.log('\n[Test 7] 64 KB message size guard (NFR security)');
  let ws1, ws2;
  try {
    ws1 = await connectWS(`${WS}/room/size-test`);
    ws2 = await connectWS(`${WS}/room/size-test`);
    await sleep(200);

    let receivedOversized = false;
    ws2.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'oversized') receivedOversized = true;
    });

    // Send 65KB message — should be discarded, not broadcast
    const big = JSON.stringify({ type: 'oversized', data: 'x'.repeat(65 * 1024) });
    ws1.send(big);
    await sleep(500);
    assert('Oversized message (65KB) NOT broadcast to peers', !receivedOversized);
  } catch (e) {
    assert('Size guard test completed', false, e.message);
  } finally {
    closeAll(ws1, ws2);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\x1b[1mWeek 1 — Automated Validation\x1b[0m');
  console.log('='.repeat(40));

  await testServerReachable();
  await testRoomIdValidation();
  await testBroadcast();
  await testRoomIsolation();
  await testRoomCleanup();
  await testUserJoinedBroadcast();
  await testUserLeftBroadcast();
  await testMessageSizeGuard();

  console.log('\n' + '='.repeat(40));
  console.log(`\x1b[1mResults: ${PASS} ${passed} passed  ${FAIL} ${failed} failed\x1b[0m`);

  if (failed === 0) {
    console.log('\n\x1b[32m✓ All automated Week 1 checks pass.\x1b[0m');
    console.log('\x1b[33mRemaining manual items (browser required):\x1b[0m');
    console.log('  · Open two tabs on localhost:5173/room/abc123 → type in tab A → check tab B log');
    console.log('  · Kill server → confirm retry backoff in console → error badge after 5 attempts');
    console.log('  · Restart server → confirm hook reconnects → badge returns to open');
    console.log('  · Write EditorState/Transaction learning checkpoint note');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
