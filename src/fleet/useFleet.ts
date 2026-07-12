import { useCallback, useEffect, useState } from 'react';
import { activateShip, fetchFleet, sellShip, type Ship } from '../api';

// useFleet owns the shared fleet state that both the floating FleetPanel and the
// Pilot page's «Флот» card render (TASK-127.1). It fetches every ship the player
// owns across sectors (GET /api/player/ships), polls while active, and exposes
// the activate/sell mutations. Keeping the data logic here means the two views
// share one implementation — only the chrome differs. onActivated runs after a
// successful switch/sell so the layout refreshes PlayerSelf (ownShip / wallet).
const POLL_MS = 4000;

export type FleetState = {
  ships: Ship[];
  loading: boolean;
  error: string | null;
  // busy is the id of the ship whose activate/sell is in flight (0 = none), so a
  // row can disable its own buttons without freezing the rest of the list.
  busy: number;
  onActivate: (shipID: number) => Promise<void>;
  onSell: (shipyardID: number, shipID: number) => Promise<void>;
};

// active gates the poll: the floating panel passes its `open` flag so it stops
// fetching while hidden; the always-on Pilot card passes true.
export function useFleet(active: boolean, onActivated: () => void): FleetState {
  const [ships, setShips] = useState<Ship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number>(0);

  const load = useCallback(() => {
    void fetchFleet()
      .then((list) => {
        setShips(list);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Не удалось загрузить флот'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [active, load]);

  const onActivate = useCallback(
    async (shipID: number) => {
      setBusy(shipID);
      try {
        await activateShip(shipID);
        onActivated();
        load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось переключить корабль');
      } finally {
        setBusy(0);
      }
    },
    [onActivated, load],
  );

  const onSell = useCallback(
    async (shipyardID: number, shipID: number) => {
      setBusy(shipID);
      try {
        await sellShip(shipyardID, shipID);
        onActivated(); // refresh wallet
        load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось продать корабль');
      } finally {
        setBusy(0);
      }
    },
    [onActivated, load],
  );

  return { ships, loading, error, busy, onActivate, onSell };
}
