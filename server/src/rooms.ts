import type { IncomingMessage, ServerResponse } from 'http';
import { nanoid } from 'nanoid';
import { validateToken } from './auth.js';
import {
  createRoom,
  getRoomBySlug,
  upsertRoom,
  getRecentRoomsForUser,
  updateRoomName,
  type RoomRow,
} from './db/operations.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SLUG_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SLUG_LENGTH = 10;

const SUPPORTED_LANGUAGES = new Set([
  'javascript', 'typescript', 'python', 'java', 'go', 'html', 'css', 'json',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function customNanoid(): string {
  const chars = SLUG_ALPHABET;
  let id = '';
  const crypto = globalThis.crypto;
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_LENGTH));
  for (const b of bytes) {
    id += chars[b % chars.length];
  }
  return id;
}

/** Generate a slug that does not yet exist in the rooms table. */
export async function generateUniqueSlug(): Promise<string> {
  // nanoid with custom alphabet for URL-safe lowercase alphanumeric
  const slug = nanoid(SLUG_LENGTH)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, () => customNanoid()[0]);

  const existing = await getRoomBySlug(slug);
  if (!existing) return slug;

  // Single retry on collision (astronomically unlikely at demo scale)
  const retry = customNanoid();
  return retry;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function authenticate(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers['authorization'] ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await validateToken(token);
  if (!user) {
    jsonResponse(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return user;
}

// ─── POST /rooms ──────────────────────────────────────────────────────────────

export async function createRoomHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = await authenticate(req, res);
  if (!user) return;

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const name = (typeof body['name'] === 'string' && body['name'].trim())
    ? body['name'].trim()
    : 'Untitled Room';

  const language = typeof body['language'] === 'string' ? body['language'] : 'javascript';
  if (!SUPPORTED_LANGUAGES.has(language)) {
    jsonResponse(res, 422, { error: `Unsupported language: ${language}` });
    return;
  }

  const slug = await generateUniqueSlug();
  const room = await createRoom(slug, name, language, user.id);
  jsonResponse(res, 201, room);
}

// ─── GET /rooms ───────────────────────────────────────────────────────────────

export async function listRoomsHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = await authenticate(req, res);
  if (!user) return;

  const rooms = await getRecentRoomsForUser(user.id);
  jsonResponse(res, 200, { rooms });
}

// ─── GET /rooms/:slug ─────────────────────────────────────────────────────────

export async function getRoomHandler(
  req: IncomingMessage,
  res: ServerResponse,
  slug: string,
): Promise<void> {
  const user = await authenticate(req, res);
  if (!user) return;

  const room = await getRoomBySlug(slug);
  if (!room) {
    jsonResponse(res, 404, { error: 'Room not found' });
    return;
  }
  jsonResponse(res, 200, room);
}

// ─── PATCH /rooms/:slug ───────────────────────────────────────────────────────

export async function patchRoomHandler(
  req: IncomingMessage,
  res: ServerResponse,
  slug: string,
  broadcastRoomMeta: (roomId: string, name: string) => void,
): Promise<void> {
  const user = await authenticate(req, res);
  if (!user) return;

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
  if (!name) {
    jsonResponse(res, 400, { error: 'name must be a non-empty string' });
    return;
  }

  const room = await getRoomBySlug(slug);
  if (!room) {
    jsonResponse(res, 404, { error: 'Room not found' });
    return;
  }

  const updated = await updateRoomName(slug, name);
  broadcastRoomMeta(slug, updated.name);
  jsonResponse(res, 200, updated);
}

export { upsertRoom, SUPPORTED_LANGUAGES, getRoomBySlug };
export type { RoomRow };
