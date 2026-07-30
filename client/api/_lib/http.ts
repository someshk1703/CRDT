import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Minimal shape of the request/response objects Vercel's Node runtime passes
 * to a default-exported handler. Declared locally instead of depending on
 * `@vercel/node` so these functions have no extra install-time dependency.
 */
export interface ApiRequest extends IncomingMessage {
  query: Record<string, string | string[]>;
  body: unknown;
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse;
}
