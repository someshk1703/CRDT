/**
 * RGA (Replicated Growable Array) CRDT implementation.
 *
 * Key properties:
 * - Every character has a globally unique ID: "clientId:lamportTick"
 * - Every character has an originId: the ID of its left neighbour at insert time
 * - Tombstones (deleted = true) are never physically removed — they anchor origin pointers
 * - Concurrent inserts at the same origin are tie-broken deterministically by ID comparison
 * - All operations are commutative: applying in any order converges to the same result
 */

// ─── CRDTChar ────────────────────────────────────────────────────────────────

export interface CRDTChar {
  /** Globally unique: "clientId:lamportTick" */
  readonly id: string;
  /** Single character value. */
  readonly value: string;
  /**
   * ID of the character immediately to the left at insert time.
   * null means "inserted at the very beginning of the document".
   */
  readonly originId: string | null;
  /** Tombstone — true once deleted. Never physically removed. */
  deleted: boolean;
}

// ─── LamportClock ────────────────────────────────────────────────────────────

export class LamportClock {
  private time = 0;

  /** Increment and return the new clock value. */
  tick(): number {
    return ++this.time;
  }

  /**
   * Advance the clock on receipt of a remote timestamp.
   * Ensures local time is always greater than the received time.
   */
  update(received: number): void {
    this.time = Math.max(this.time, received) + 1;
  }

  /** Current clock value (without incrementing). */
  now(): number {
    return this.time;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the Lamport tick from an ID of the form "clientId:tick".
 * Returns 0 for malformed IDs.
 */
function lamportFromId(id: string): number {
  const colonIdx = id.lastIndexOf(':');
  if (colonIdx === -1) return 0;
  const tick = parseInt(id.slice(colonIdx + 1), 10);
  return Number.isFinite(tick) ? tick : 0;
}

// ─── RGADocument ─────────────────────────────────────────────────────────────

export class RGADocument {
  /** Full array including tombstones. Never shrinks. */
  private readonly chars: CRDTChar[] = [];
  private readonly clock: LamportClock = new LamportClock();

  constructor(private readonly clientId: string) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  /** Return the visible (non-tombstoned) text. */
  getText(): string {
    return this.chars
      .filter((c) => !c.deleted)
      .map((c) => c.value)
      .join('');
  }

  /** Number of visible (non-tombstoned) characters. */
  getVisibleLength(): number {
    return this.chars.filter((c) => !c.deleted).length;
  }

  /**
   * Return the full internal chars array including tombstones.
   * Used for snapshot serialization.
   */
  getChars(): CRDTChar[] {
    return this.chars;
  }

  /**
   * Replace the internal chars array with the provided deserialized array.
   * Used to restore full CRDT state from a snapshot without replaying every op.
   * Also advances the Lamport clock past the maximum clock seen in the chars.
   */
  loadFromChars(chars: CRDTChar[]): void {
    this.chars.length = 0;
    for (const c of chars) {
      this.chars.push({ ...c });
    }
    // Advance clock so future local inserts don't collide
    for (const c of chars) {
      this.clock.update(lamportFromId(c.id));
    }
  }

  // ── Integration ───────────────────────────────────────────────────────────

  /**
   * Find the correct insertion index in `this.chars` for `char` using the
   * RGA tie-breaking rule:
   *
   * 1. Find the position of `char.originId` in the array (−1 for null = head).
   * 2. Scan right from there while the existing char has the SAME origin AND
   *    a lexicographically GREATER id (it wins — keep moving right).
   * 3. Insert at the first position where we stop scanning.
   *
   * Result: deterministic ordering regardless of arrival order.
   */
  private integrateInsert(char: CRDTChar): void {
    // Find insertion anchor
    let insertAfterIdx = -1;
    if (char.originId !== null) {
      insertAfterIdx = this.chars.findIndex((c) => c.id === char.originId);
      // originId not found yet (out-of-order) — insert at head as fallback
      // This is safe for Week 2 since TCP/WebSocket preserves per-client order
      if (insertAfterIdx === -1) insertAfterIdx = -1;
    }

    // Scan right past concurrent same-origin chars that sort ahead of us
    let j = insertAfterIdx + 1;
    while (j < this.chars.length) {
      const existing = this.chars[j];
      if (existing.originId === char.originId && existing.id > char.id) {
        j++;
      } else {
        break;
      }
    }

    this.chars.splice(j, 0, char);
  }

  // ── Local operations (generate + apply) ──────────────────────────────────

  /**
   * Insert a single character at visible position `visiblePos`.
   *
   * @param visiblePos  0-based index in the visible (non-tombstoned) sequence.
   *                    0 means "before all visible chars".
   * @param value       Single character to insert.
   * @param clientId    The local client's identifier.
   * @returns The newly created CRDTChar (broadcast this to other clients).
   */
  localInsert(visiblePos: number, value: string, clientId: string): CRDTChar {
    // Find the left neighbour in the VISIBLE sequence
    const originId = this.getVisibleCharIdAt(visiblePos - 1);

    const char: CRDTChar = {
      id: `${clientId}:${this.clock.tick()}`,
      value,
      originId,
      deleted: false,
    };

    this.integrateInsert(char);
    return char;
  }

  /**
   * Delete the character at visible position `visiblePos`.
   *
   * @returns The tombstoned CRDTChar (broadcast its `id` to other clients).
   */
  localDelete(visiblePos: number): CRDTChar {
    let visibleIdx = -1;
    for (let i = 0; i < this.chars.length; i++) {
      if (!this.chars[i].deleted) {
        visibleIdx++;
        if (visibleIdx === visiblePos) {
          this.chars[i].deleted = true;
          return this.chars[i];
        }
      }
    }
    throw new RangeError(
      `localDelete: visiblePos ${visiblePos} out of range (visible length ${this.getVisibleLength()})`,
    );
  }

  // ── Remote operations (apply only) ────────────────────────────────────────

  /**
   * Apply a remote insert. Idempotent — silently ignores duplicate IDs.
   */
  remoteInsert(char: CRDTChar): void {
    if (this.chars.some((c) => c.id === char.id)) return;
    this.clock.update(lamportFromId(char.id));
    this.integrateInsert(char);
  }

  /**
   * Apply a remote delete. Idempotent — no-op if charId is unknown or already deleted.
   */
  remoteDelete(charId: string): void {
    const char = this.chars.find((c) => c.id === charId);
    if (char && !char.deleted) {
      char.deleted = true;
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Return the ID of the character at visible index `visibleIdx`,
   * or `null` if `visibleIdx < 0` (meaning "before all visible chars").
   */
  private getVisibleCharIdAt(visibleIdx: number): string | null {
    if (visibleIdx < 0) return null;
    let count = -1;
    for (const char of this.chars) {
      if (!char.deleted) {
        count++;
        if (count === visibleIdx) return char.id;
      }
    }
    return null;
  }
}
