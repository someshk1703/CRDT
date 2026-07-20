import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase client ─────────────────────────────────────────────────────
// vi.mock is hoisted — use vi.hoisted to initialise mocks at hoist time.

const { mockFrom, mockUpsert, mockInsert } = vi.hoisted(() => {
  const mockInsert = vi.fn();
  const mockUpsert = vi.fn();
  const mockFrom = vi.fn();
  return { mockFrom, mockUpsert, mockInsert };
});

vi.mock('../db/supabase.js', () => ({
  supabase: { from: mockFrom },
}));

// ─── Import after mock is set up ──────────────────────────────────────────────

import { persistOp, loadOpsForRoom, maybeSaveSnapshot } from '../db/operations.js';
import { RGADocument } from '@crdt/shared/crdt';

// ─── persistOp ───────────────────────────────────────────────────────────────

describe('persistOp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeChain(upsertResult: object, insertResult: object) {
    const insertFn = vi.fn().mockResolvedValue(insertResult);
    const upsertFn = vi.fn().mockResolvedValue(upsertResult);
    mockFrom.mockReturnValue({ upsert: upsertFn, insert: insertFn } as unknown as ReturnType<typeof mockFrom>);
    return { insertFn, upsertFn };
  }

  it('inserts an insert op with correct clock extracted from char.id', async () => {
    const { insertFn } = makeChain({ error: null }, { error: null });

    const msg = {
      type: 'crdt-insert',
      char: { id: 'client1:7', value: 'A', originId: null, deleted: false },
    };

    await persistOp('room1', 'client1', msg);

    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        room_id: 'room1',
        client_id: 'client1',
        op_type: 'insert',
        clock: 7,
      }),
    );
  });

  it('inserts a delete op with clock extracted from charId', async () => {
    const { insertFn } = makeChain({ error: null }, { error: null });

    const msg = {
      type: 'crdt-delete',
      charId: 'client2:42',
    };

    await persistOp('room1', 'client1', msg);

    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        op_type: 'delete',
        payload: { charId: 'client2:42' },
        clock: 42,
      }),
    );
  });

  it('throws if Supabase insert returns an error', async () => {
    makeChain({ error: null }, { error: { message: 'DB error' } });

    const msg = {
      type: 'crdt-insert',
      char: { id: 'c1:1', value: 'X', originId: null, deleted: false },
    };

    await expect(persistOp('room1', 'c1', msg)).rejects.toBeDefined();
  });
});

// ─── loadOpsForRoom ───────────────────────────────────────────────────────────

describe('loadOpsForRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null snapshot and all ops when no snapshot exists', async () => {
    // Snapshot query returns empty array
    const snapChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const opsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          { op_type: 'insert', payload: { id: 'c1:1', value: 'A', originId: null, deleted: false }, clock: 1 },
          { op_type: 'delete', payload: { charId: 'c1:1' }, clock: 1 },
        ],
        error: null,
      }),
    };

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return (callCount === 1 ? snapChain : opsChain) as unknown as ReturnType<typeof mockFrom>;
    });

    const result = await loadOpsForRoom('room1');

    expect(result.snapshot).toBeNull();
    expect(result.ops).toHaveLength(2);
  });

  it('returns snapshot and only delta ops when snapshot exists', async () => {
    const snapshotChars = [{ id: 'c1:1', value: 'A', originId: null, deleted: false }];
    const snapChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ serialized_chars: snapshotChars, last_clock: 100 }],
        error: null,
      }),
    };
    const opsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: Array.from({ length: 50 }, (_, i) => ({
          op_type: 'insert',
          payload: { id: `c1:${101 + i}`, value: 'X', originId: null, deleted: false },
          clock: 101 + i,
        })),
        error: null,
      }),
    };

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return (callCount === 1 ? snapChain : opsChain) as unknown as ReturnType<typeof mockFrom>;
    });

    const result = await loadOpsForRoom('room2');

    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot!.lastClock).toBe(100);
    expect(result.snapshot!.chars).toEqual(snapshotChars);
    expect(result.ops).toHaveLength(50);
    // Verify gt was called with the snapshot's lastClock
    expect(opsChain.gt).toHaveBeenCalledWith('clock', 100);
  });
});

// ─── maybeSaveSnapshot ───────────────────────────────────────────────────────

describe('maybeSaveSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SNAPSHOT_INTERVAL'];
  });

  it('does not insert when opCount % 100 !== 0', async () => {
    const snapChain = { insert: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom.mockReturnValue(snapChain as unknown as ReturnType<typeof mockFrom>);

    const doc = new RGADocument('c1');
    doc.localInsert(0, 'A', 'c1');

    await maybeSaveSnapshot('room1', doc, 99);

    expect(snapChain.insert).not.toHaveBeenCalled();
  });

  it('inserts with non-empty serialized_chars when opCount % 100 === 0', async () => {
    const snapChain = { insert: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom.mockReturnValue(snapChain as unknown as ReturnType<typeof mockFrom>);

    const doc = new RGADocument('c1');
    doc.localInsert(0, 'A', 'c1');

    await maybeSaveSnapshot('room1', doc, 100);

    expect(snapChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        room_id: 'room1',
        serialized_chars: expect.arrayContaining([
          expect.objectContaining({ value: 'A' }),
        ]),
        op_count: 100,
      }),
    );
  });

  it('inserts when opCount === 200', async () => {
    const snapChain = { insert: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom.mockReturnValue(snapChain as unknown as ReturnType<typeof mockFrom>);

    const doc = new RGADocument('c1');
    doc.localInsert(0, 'B', 'c1');

    await maybeSaveSnapshot('room1', doc, 200);

    expect(snapChain.insert).toHaveBeenCalled();
  });

  it('respects custom SNAPSHOT_INTERVAL env var', async () => {
    process.env['SNAPSHOT_INTERVAL'] = '50';
    const snapChain = { insert: vi.fn().mockResolvedValue({ error: null }) };
    mockFrom.mockReturnValue(snapChain as unknown as ReturnType<typeof mockFrom>);

    const doc = new RGADocument('c1');
    doc.localInsert(0, 'C', 'c1');

    await maybeSaveSnapshot('room1', doc, 50);
    expect(snapChain.insert).toHaveBeenCalled();

    snapChain.insert.mockClear();
    mockFrom.mockReturnValue(snapChain as unknown as ReturnType<typeof mockFrom>);
    await maybeSaveSnapshot('room1', doc, 99);
    expect(snapChain.insert).not.toHaveBeenCalled();
  });
});
