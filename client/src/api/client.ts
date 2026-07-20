import { ApiError, NetworkError, type ApiErrorPayload } from './errors';

const API_BASE = '/api';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * The single fetch wrapper for the whole app.
 *
 * - Always sends the session cookie (`credentials: 'include'`).
 * - Uses relative `/api` paths (Vite proxies them in dev; same-origin in prod).
 * - Parses the backend's `{ error: { code, message } }` shape into an ApiError.
 * - Treats a dropped connection as a NetworkError, never as a logged-out state.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    // fetch rejects only on a network-level failure or abort.
    throw new NetworkError();
  }

  // Read as text first so an empty body (e.g. 204) parses safely.
  const raw = await response.text();
  let parsed: unknown;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const payload = parsed as ApiErrorPayload | undefined;
    if (payload?.error) {
      throw new ApiError(
        payload.error.code,
        payload.error.message,
        response.status,
        payload.error.details,
      );
    }
    throw new ApiError('UNKNOWN', 'Đã xảy ra lỗi không mong muốn.', response.status);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
};
