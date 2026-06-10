import { createContext } from 'react';
import type { Player } from './api';

// status reflects the bootstrap state of the auth check.
//   'loading'         — initial /me request in flight
//   'unauthenticated' — /me returned 401 OR user logged out
//   'authenticated'   — /me returned a player
type Status = 'loading' | 'unauthenticated' | 'authenticated';

export type AuthState = {
  status: Status;
  player: Player | null;
  // login/register throw on failure so the LoginPage can show kind-specific
  // messages. Successful calls update state and resolve void.
  login: (login: string, password: string) => Promise<void>;
  register: (login: string, password: string, race: number) => Promise<void>;
  logout: () => Promise<void>;
};

// Lives in its own file to satisfy react-refresh: a file may export only
// components or only non-components, not both.
export const AuthContext = createContext<AuthState | null>(null);
