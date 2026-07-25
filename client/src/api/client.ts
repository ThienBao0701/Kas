import { ApiError, NetworkError, type ApiErrorPayload } from './errors';

const API_BASE = '/api';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * True for a multipart body (FormData). Such a body is passed to fetch as-is and
 * the browser sets the multipart Content-Type (with boundary) itself — we must
 * not stringify it or set a JSON header.
 */
function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
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

  const form = isFormData(body);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      // JSON header only for JSON bodies; FormData sets its own multipart header.
      headers: body !== undefined && !form ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? (form ? (body as FormData) : JSON.stringify(body)) : undefined,
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
  postForm: <T>(path: string, form: FormData) => apiRequest<T>(path, { method: 'POST', body: form }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  del: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
};
