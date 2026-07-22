import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateToken } from './auth.js';

// ─── Mock supabase ────────────────────────────────────────────────────────────

vi.mock('./db/supabase.js', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
  },
}));

import { supabase } from './db/supabase.js';

const mockGetUser = vi.mocked(supabase.auth.getUser);

describe('validateToken', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  it('returns null for an empty token', async () => {
    // Given an empty string
    const result = await validateToken('');
    // Then returns null without calling Supabase
    expect(result).toBeNull();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('returns null for a whitespace-only token', async () => {
    const result = await validateToken('   ');
    expect(result).toBeNull();
  });

  it('returns null when Supabase returns an error', async () => {
    // Given Supabase responds with an error
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('invalid JWT'),
    } as never);

    const result = await validateToken('expired-token');
    // Then returns null
    expect(result).toBeNull();
  });

  it('returns null when Supabase returns no user', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    } as never);

    const result = await validateToken('valid-but-no-user');
    expect(result).toBeNull();
  });

  it('returns AuthUser with id, username, avatarUrl for a valid token', async () => {
    // Given a valid Supabase JWT
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-uuid-123',
          user_metadata: {
            user_name: 'octocat',
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
          },
        },
      },
      error: null,
    } as never);

    const result = await validateToken('valid-jwt');

    // Then returns the auth user
    expect(result).toEqual({
      id: 'user-uuid-123',
      username: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    });
  });

  it('falls back to name if user_name is missing', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-uuid-456',
          user_metadata: {
            name: 'The Octocat',
            avatar_url: '',
          },
        },
      },
      error: null,
    } as never);

    const result = await validateToken('valid-jwt-no-user_name');
    expect(result?.username).toBe('The Octocat');
  });

  it('returns null if getUser throws unexpectedly', async () => {
    mockGetUser.mockRejectedValueOnce(new Error('network error'));

    const result = await validateToken('throws-token');
    expect(result).toBeNull();
  });
});
