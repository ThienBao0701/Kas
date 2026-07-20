import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';
import { ApiError, NetworkError } from './errors';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('sends credentials: "include", a relative /api URL and a JSON body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/login', { method: 'POST', body: { username: 'a', password: 'b' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe('/api/auth/login');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'a', password: 'b' });
  });

  it('parses the backend error shape into an ApiError with code and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'sai' } }),
          { status: 401 },
        ),
      ),
    );

    await expect(apiRequest('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 401,
    });
  });

  it('throws a NetworkError when the request never reaches the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));

    await expect(apiRequest('/auth/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('falls back to a generic ApiError when the error body is not the known shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('gateway down', { status: 502 })),
    );

    const error = await apiRequest('/auth/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
  });

  it('handles an empty response body safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const result = await apiRequest('/auth/logout', { method: 'POST' });
    expect(result).toBeUndefined();
  });
});
