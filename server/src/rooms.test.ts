import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateUniqueSlug } from './rooms.js';

// ─── Mock DB operations ───────────────────────────────────────────────────────

vi.mock('./db/operations.js', () => ({
  getRoomBySlug: vi.fn(),
  createRoom: vi.fn(),
  getRecentRoomsForUser: vi.fn(),
  updateRoomName: vi.fn(),
  upsertRoom: vi.fn(),
}));

import { getRoomBySlug } from './db/operations.js';

const mockGetRoomBySlug = vi.mocked(getRoomBySlug);

describe('generateUniqueSlug', () => {
  beforeEach(() => {
    mockGetRoomBySlug.mockReset();
  });

  it('returns a 10-character lowercase alphanumeric slug when no collision', async () => {
    // Given the room table has no existing slug
    mockGetRoomBySlug.mockResolvedValue(null);

    const slug = await generateUniqueSlug();

    // Then slug is 10 chars, lowercase alphanumeric
    expect(slug).toMatch(/^[a-z0-9]{10}$/);
  });

  it('retries and returns a different slug on first-attempt collision', async () => {
    // Given the first slug already exists but the second does not
    mockGetRoomBySlug
      .mockResolvedValueOnce({ id: 'existing', name: 'Existing Room', language: 'javascript', owner_id: null, created_at: '' })
      .mockResolvedValueOnce(null);

    const slug = await generateUniqueSlug();

    // Then a valid slug is returned
    expect(slug).toBeTruthy();
    expect(slug.length).toBeGreaterThanOrEqual(10);
  });
});
