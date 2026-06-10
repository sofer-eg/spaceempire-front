import { useEffect, useState } from 'react';
import { fetchWorld, type WorldResponse } from './api';

// Module-level cache: /api/world is static topology — every component that
// calls this hook gets the same object. First caller triggers the request;
// subsequent callers (e.g. GalaxyMap and SectorView mounted at the same
// time) reuse the in-flight promise.
let cached: WorldResponse | null = null;
let inflight: Promise<WorldResponse> | null = null;

export type GalaxyState =
  | { status: 'loading' }
  | { status: 'ready'; world: WorldResponse }
  | { status: 'error'; message: string };

export function useGalaxy(): GalaxyState {
  const [state, setState] = useState<GalaxyState>(() =>
    cached ? { status: 'ready', world: cached } : { status: 'loading' },
  );

  useEffect(() => {
    let cancelled = false;
    if (!cached && !inflight) {
      inflight = fetchWorld()
        .then((w) => {
          cached = w;
          return w;
        })
        .finally(() => {
          inflight = null;
        });
    }
    // Always resolve through a promise (never an early return) so the ready
    // state is set even when `cached` was populated between StrictMode's first
    // cleanup and this run — otherwise the galaxy (gates, sector names) would
    // silently stay 'loading'. Using Promise.resolve keeps setState async (off
    // the effect body), satisfying the no-sync-setState-in-effect rule.
    const pending = cached ? Promise.resolve(cached) : inflight;
    if (pending) {
      pending
        .then((world) => {
          if (!cancelled) setState({ status: 'ready', world });
        })
        .catch((err: unknown) => {
          if (!cancelled) setState({ status: 'error', message: String(err) });
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
