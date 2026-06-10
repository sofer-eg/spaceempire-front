import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as authAPI from './api';
import type { Player } from './api';
import { AuthContext, type AuthState } from './authContext';

type Status = AuthState['status'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  // One-shot bootstrap: hit /me to learn whether the cookie is still valid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await authAPI.me();
        if (cancelled) return;
        if (p) {
          setPlayer(p);
          setStatus('authenticated');
        } else {
          setStatus('unauthenticated');
        }
      } catch {
        if (cancelled) return;
        // Network/other errors during bootstrap → treat as unauthenticated
        // so the user gets the login form rather than a stuck loader.
        setStatus('unauthenticated');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (loginValue: string, password: string) => {
    const p = await authAPI.login(loginValue, password);
    setPlayer(p);
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (loginValue: string, password: string, race: number) => {
    const p = await authAPI.register(loginValue, password, race);
    setPlayer(p);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await authAPI.logout();
    setPlayer(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, player, login, register, logout }),
    [status, player, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
