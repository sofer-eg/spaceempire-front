// Typed client for /api/auth/*. The session cookie is HttpOnly + Set by the
// server, so we never touch document.cookie — the browser carries it on
// same-origin fetches by default.

export type Player = {
  playerID: number;
  login: string;
};

// Sentinel thrown by the client so callers (useAuth, LoginPage) can switch
// on the kind without parsing message strings.
export type AuthErrorKind =
  | 'invalid_credentials'
  | 'login_taken'
  | 'validation'
  | 'unauthenticated'
  | 'network';

export class AuthError extends Error {
  kind: AuthErrorKind;
  status: number;
  constructor(kind: AuthErrorKind, status: number, message: string) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
    this.status = status;
  }
}

type ErrorBody = { error?: string };

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ErrorBody;
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

async function postJSON(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// register creates an account. race is the player's chosen faction (1..5
// playable — Argon/Boron/Paranid/Split/Teladi); it decides where the starter
// ship spawns and its race/name (phase 10.10).
export async function register(login: string, password: string, race: number): Promise<Player> {
  const res = await postJSON('/api/auth/register', { login, password, race });
  if (res.status === 409) {
    throw new AuthError('login_taken', 409, await parseErrorBody(res));
  }
  if (res.status === 400) {
    throw new AuthError('validation', 400, await parseErrorBody(res));
  }
  if (!res.ok) {
    throw new AuthError('network', res.status, await parseErrorBody(res));
  }
  return (await res.json()) as Player;
}

export async function login(loginValue: string, password: string): Promise<Player> {
  const res = await postJSON('/api/auth/login', { login: loginValue, password });
  if (res.status === 401) {
    throw new AuthError('invalid_credentials', 401, await parseErrorBody(res));
  }
  if (res.status === 400) {
    throw new AuthError('validation', 400, await parseErrorBody(res));
  }
  if (!res.ok) {
    throw new AuthError('network', res.status, await parseErrorBody(res));
  }
  return (await res.json()) as Player;
}

export async function logout(): Promise<void> {
  const res = await fetch('/api/auth/logout', { method: 'POST' });
  if (!res.ok && res.status !== 204) {
    throw new AuthError('network', res.status, await parseErrorBody(res));
  }
}

// me returns the current player, or null when no valid session cookie is
// present. Callers use the null result to switch into "show login" mode.
export async function me(): Promise<Player | null> {
  const res = await fetch('/api/auth/me');
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new AuthError('network', res.status, await parseErrorBody(res));
  }
  return (await res.json()) as Player;
}
