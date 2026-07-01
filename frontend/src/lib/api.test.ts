import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, login, setUnauthorizedHandler } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiFetch 401 gate', () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.restoreAllMocks();
  });

  it('fires the unauthorized handler on a protected 401', async () => {
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));

    await apiFetch('/api/rollup');
    expect(onUnauth).toHaveBeenCalledOnce();
  });

  it('does NOT fire the gate for /auth/me (401 there is normal "not logged in")', async () => {
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));

    await apiFetch('/auth/me');
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it('sends credentials so the session cookie rides along', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/healthz');
    expect(fetchMock).toHaveBeenCalledWith('/healthz', expect.objectContaining({ credentials: 'include' }));
  });
});

describe('login', () => {
  beforeEach(() => setUnauthorizedHandler(null));
  afterEach(() => vi.restoreAllMocks());

  it('maps 200 → ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));
    expect(await login('1234')).toEqual({ kind: 'ok' });
  });

  it('maps 401 → bad_pin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'bad_pin' })));
    expect(await login('0000')).toEqual({ kind: 'bad_pin' });
  });

  it('maps 429 → locked with retryAfter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { retryAfter: 42 })));
    expect(await login('0000')).toEqual({ kind: 'locked', retryAfter: 42 });
  });

  it('maps 503 → no_pin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, {})));
    expect(await login('0000')).toEqual({ kind: 'no_pin' });
  });

  it('maps a network failure → unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await login('0000')).toEqual({ kind: 'unreachable' });
  });
});
