// Single fetch wrapper for the hub. Same-origin (dev uses Vite's proxy), always sends
// the session cookie, and funnels every unexpected 401 to a global handler so protected
// screens drop back to the unlock gate instead of showing broken/empty UI.

// Paths that legitimately return 401 as data (not "session expired") — never trip the gate.
const AUTH_PATHS = new Set(['/auth', '/auth/me', '/logout']);

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Register the app-level "session is gone" handler (App wires this to its state machine). */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`api ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  // A 401 on a protected endpoint means the session lapsed — kick back to unlock.
  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    onUnauthorized?.();
  }
  return res;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export type LoginResult =
  | { kind: 'ok' }
  | { kind: 'bad_pin' }
  | { kind: 'locked'; retryAfter: number }
  | { kind: 'no_pin' }
  | { kind: 'unreachable' };

export async function login(pin: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await apiFetch('/auth', { method: 'POST', body: JSON.stringify({ pin }) });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.ok) return { kind: 'ok' };
  const body = await readJson(res);
  if (res.status === 429) {
    const retryAfter = Number(body.retryAfter) || 60;
    return { kind: 'locked', retryAfter };
  }
  if (res.status === 503) return { kind: 'no_pin' };
  return { kind: 'bad_pin' };
}

/** Is there a live session? Used on boot to skip the unlock screen. */
export async function checkAuth(): Promise<boolean> {
  try {
    const res = await apiFetch('/auth/me');
    return res.ok;
  } catch {
    throw new ApiError(0, 'unreachable');
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/logout', { method: 'POST' });
  } catch {
    /* best-effort; the state machine clears locally regardless */
  }
}

// ── Health ──────────────────────────────────────────────────────────────────
export type Health = { ok: boolean; version?: string };

export async function getHealth(): Promise<Health> {
  try {
    const res = await apiFetch('/healthz');
    if (!res.ok) return { ok: false };
    const body = await readJson(res);
    return { ok: Boolean(body.ok), version: typeof body.version === 'string' ? body.version : undefined };
  } catch {
    return { ok: false };
  }
}
