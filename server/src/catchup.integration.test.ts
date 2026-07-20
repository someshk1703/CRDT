/**
 * SC-004: Catch-up / live-stream boundary integration test.
 *
 * Verifies that a client which starts a catch-up fetch while a concurrent
 * live op is in-flight ends up with the same document as the source.
 * CRDT idempotency prevents double-application of any op that appears in
 * both the catch-up batch and the live stream.
 */
import { describe, it, expect } from 'vitest';
import { RGADocument } from '@crdt/shared/crdt';
import type { PersistedOp } from './db/operations.js';

describe('SC-004: catch-up / live-stream boundary', () => {
  it('client reconstructed from catch-up + live op equals source doc with no duplicates', () => {
    // ── Build source document with N ops ──────────────────────────────────
    const sourceDoc = new RGADocument('source');
    const persistedOps: PersistedOp[] = [];

    for (let i = 0; i < 10; i++) {
      const char = sourceDoc.localInsert(i, String.fromCharCode(65 + i), 'source');
      persistedOps.push({ op_type: 'insert', payload: char, clock: i + 1 });
    }

    // ── Simulate: catch-up query starts here (reads ops 1-10) ─────────────
    const catchupOps = [...persistedOps]; // snapshot of ops at query time

    // ── Simulate: one more live op arrives while query is in-flight ────────
    const liveChar = sourceDoc.localInsert(10, 'K', 'source');
    const liveOp: PersistedOp = { op_type: 'insert', payload: liveChar, clock: 11 };

    // ── Client B: reconstruct from catch-up batch ──────────────────────────
    const clientDoc = new RGADocument('client');
    for (const op of catchupOps) {
      clientDoc.remoteInsert(op.payload as import('@crdt/shared/crdt').CRDTChar);
    }

    // ── Client B: apply live op (may overlap with catch-up — idempotent) ───
    clientDoc.remoteInsert(liveOp.payload as import('@crdt/shared/crdt').CRDTChar);

    // ── Assertions: no missing, no duplicates ──────────────────────────────
    expect(clientDoc.getText()).toBe(sourceDoc.getText());
    expect(clientDoc.getVisibleLength()).toBe(sourceDoc.getVisibleLength());
  });

  it('live op already in catch-up batch is not duplicated (idempotency)', () => {
    const sourceDoc = new RGADocument('source');
    const char = sourceDoc.localInsert(0, 'X', 'source');
    const op: PersistedOp = { op_type: 'insert', payload: char, clock: 1 };

    // Catch-up includes the op
    const clientDoc = new RGADocument('client');
    clientDoc.remoteInsert(char);

    // Live stream also delivers same op
    clientDoc.remoteInsert(char); // idempotent — no-op

    expect(clientDoc.getText()).toBe('X');
    expect(clientDoc.getVisibleLength()).toBe(1);
  });
});
