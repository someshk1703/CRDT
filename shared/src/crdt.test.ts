import { describe, it, expect } from 'vitest';
import { LamportClock, RGADocument } from './crdt.js';

// ─── LamportClock ────────────────────────────────────────────────────────────

describe('LamportClock', () => {
  it('starts at 0 and increments on tick', () => {
    const c = new LamportClock();
    expect(c.tick()).toBe(1);
    expect(c.tick()).toBe(2);
    expect(c.tick()).toBe(3);
  });

  it('update sets clock to max(local, received) + 1', () => {
    const c = new LamportClock();
    c.tick(); // time = 1
    c.tick(); // time = 2
    c.tick(); // time = 3
    c.update(7); // max(3, 7) + 1 = 8
    expect(c.tick()).toBe(9);
  });

  it('update with smaller value does not go backwards', () => {
    const c = new LamportClock();
    c.tick(); // 1
    c.tick(); // 2
    c.tick(); // 3
    c.update(1); // max(3,1)+1 = 4
    expect(c.tick()).toBe(5);
  });

  it('now() returns current time without incrementing', () => {
    const c = new LamportClock();
    c.tick();
    c.tick();
    expect(c.now()).toBe(2);
    expect(c.now()).toBe(2);
  });
});

// ─── RGADocument — basic operations ─────────────────────────────────────────

describe('RGADocument — basic operations', () => {
  it('starts empty', () => {
    const doc = new RGADocument('c1');
    expect(doc.getText()).toBe('');
    expect(doc.getVisibleLength()).toBe(0);
  });

  it('localInsert at position 0 in empty doc', () => {
    const doc = new RGADocument('c1');
    const char = doc.localInsert(0, 'A', 'c1');
    expect(char.value).toBe('A');
    expect(char.originId).toBeNull();
    expect(char.deleted).toBe(false);
    expect(doc.getText()).toBe('A');
  });

  it('sequential inserts build correct string', () => {
    const doc = new RGADocument('c1');
    doc.localInsert(0, 'H', 'c1');
    doc.localInsert(1, 'i', 'c1');
    doc.localInsert(2, '!', 'c1');
    expect(doc.getText()).toBe('Hi!');
  });

  it('insert in the middle', () => {
    const doc = new RGADocument('c1');
    doc.localInsert(0, 'A', 'c1');
    doc.localInsert(1, 'C', 'c1');
    doc.localInsert(1, 'B', 'c1'); // insert between A and C
    expect(doc.getText()).toBe('ABC');
  });

  it('localDelete marks tombstone but keeps char in array', () => {
    const doc = new RGADocument('c1');
    doc.localInsert(0, 'H', 'c1');
    doc.localInsert(1, 'i', 'c1');
    const deleted = doc.localDelete(1); // delete 'i'
    expect(deleted.value).toBe('i');
    expect(deleted.deleted).toBe(true);
    expect(doc.getText()).toBe('H');
    expect(doc.getVisibleLength()).toBe(1);
  });

  it('localDelete on single-char doc leaves empty visible text', () => {
    const doc = new RGADocument('c1');
    doc.localInsert(0, 'X', 'c1');
    doc.localDelete(0);
    expect(doc.getText()).toBe('');
  });
});

// ─── RGADocument — remote operations ────────────────────────────────────────

describe('RGADocument — remote operations', () => {
  it('remoteInsert applies a char from another client', () => {
    const doc = new RGADocument('c1');
    doc.remoteInsert({ id: 'c2:1', value: 'X', originId: null, deleted: false });
    expect(doc.getText()).toBe('X');
  });

  it('remoteInsert is idempotent — duplicate id is ignored', () => {
    const doc = new RGADocument('c1');
    const char = { id: 'c2:1', value: 'X', originId: null, deleted: false };
    doc.remoteInsert(char);
    doc.remoteInsert(char); // second call should be no-op
    expect(doc.getText()).toBe('X');
    expect(doc.getVisibleLength()).toBe(1);
  });

  it('remoteDelete marks existing char as tombstone', () => {
    const doc = new RGADocument('c1');
    const char = doc.localInsert(0, 'A', 'c1');
    doc.remoteDelete(char.id);
    expect(doc.getText()).toBe('');
    expect(doc.getVisibleLength()).toBe(0);
  });

  it('remoteDelete is idempotent — already deleted char stays deleted', () => {
    const doc = new RGADocument('c1');
    const char = doc.localInsert(0, 'A', 'c1');
    doc.remoteDelete(char.id);
    doc.remoteDelete(char.id); // second call is a no-op
    expect(doc.getText()).toBe('');
  });

  it('remoteDelete on unknown charId is a no-op', () => {
    const doc = new RGADocument('c1');
    doc.localInsert(0, 'A', 'c1');
    doc.remoteDelete('nonexistent:999'); // should not throw
    expect(doc.getText()).toBe('A');
  });
});

// ─── RGADocument — convergence ───────────────────────────────────────────────

describe('RGADocument — convergence', () => {
  it('two clients apply each other ops in opposite order and converge', () => {
    // Both clients start from the same empty document
    const docA = new RGADocument('clientA');
    const docB = new RGADocument('clientB');

    // Client A inserts 'X' at position 0
    const charA = docA.localInsert(0, 'X', 'clientA');
    // Client B inserts 'Y' at position 0 concurrently
    const charB = docB.localInsert(0, 'Y', 'clientB');

    // Cross-apply in opposite orders
    docA.remoteInsert(charB);
    docB.remoteInsert(charA);

    // Both must converge to the same text
    expect(docA.getText()).toBe(docB.getText());
    // And it must contain both characters
    expect(docA.getText()).toHaveLength(2);
    expect(docA.getText()).toContain('X');
    expect(docA.getText()).toContain('Y');
  });

  it('concurrent inserts after the same origin converge deterministically', () => {
    const docA = new RGADocument('aaa');
    const docB = new RGADocument('bbb');

    // Both clients have the same single character 'H'
    const h = { id: 'origin:1', value: 'H', originId: null, deleted: false };
    docA.remoteInsert(h);
    docB.remoteInsert(h);

    // Client A inserts 'i' after 'H'
    const charA = docA.localInsert(1, 'i', 'aaa');
    // Client B inserts '!' after 'H' concurrently
    const charB = docB.localInsert(1, '!', 'bbb');

    // Cross-apply
    docA.remoteInsert(charB);
    docB.remoteInsert(charA);

    expect(docA.getText()).toBe(docB.getText());
    expect(docA.getText()).toHaveLength(3); // H + i + !
  });

  it('concurrent insert and delete do not corrupt the document', () => {
    const docA = new RGADocument('clientA');
    const docB = new RGADocument('clientB');

    // Both start with 'AB'
    const a = { id: 'shared:1', value: 'A', originId: null, deleted: false };
    const b = { id: 'shared:2', value: 'B', originId: 'shared:1', deleted: false };
    docA.remoteInsert(a);
    docA.remoteInsert(b);
    docB.remoteInsert(a);
    docB.remoteInsert(b);

    expect(docA.getText()).toBe('AB');
    expect(docB.getText()).toBe('AB');

    // Client A deletes 'B' (visible pos 1)
    const deletedB = docA.localDelete(1);

    // Client B concurrently inserts 'X' after 'B' (visible pos 2 = after B)
    const insertedX = docB.localInsert(2, 'X', 'clientB');

    // Cross-apply
    docA.remoteInsert(insertedX);
    docB.remoteDelete(deletedB.id);

    expect(docA.getText()).toBe(docB.getText());
    // A deleted B; B inserted X after B. Final: A + X (B tombstoned, X still present)
    expect(docA.getText()).toBe('AX');
  });

  it('three sequential inserts from different clients converge', () => {
    const docs = [
      new RGADocument('c1'),
      new RGADocument('c2'),
      new RGADocument('c3'),
    ];

    const chars = [
      docs[0].localInsert(0, 'A', 'c1'),
      docs[1].localInsert(0, 'B', 'c2'),
      docs[2].localInsert(0, 'C', 'c3'),
    ];

    // Apply all ops to all docs (every permutation effectively)
    for (const doc of docs) {
      for (const char of chars) {
        doc.remoteInsert(char); // idempotent for the doc that generated it
      }
    }

    const texts = docs.map((d) => d.getText());
    expect(texts[0]).toBe(texts[1]);
    expect(texts[1]).toBe(texts[2]);
    expect(texts[0]).toHaveLength(3);
  });
});
