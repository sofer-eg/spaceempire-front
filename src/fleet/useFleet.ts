import { useCallback, useEffect, useState } from 'react';
import { activateShip, commandErrorText, fetchFleet, friendlyError, sellShip, type Ship } from '../api';

// useFleet owns the fleet state the Pilot page's «Флот» card renders (TASK-127.1;
// the floating panel was retired in TASK-127.2). It fetches every ship the player
// owns across sectors (GET /api/player/ships), polls while active, and exposes
// the activate/sell mutations. Keeping the data logic here separates it from the
// presentational FleetList. onActivated runs after a successful switch/sell so
// the layout refreshes PlayerSelf (ownShip / wallet).
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
  // Two error slots, one shown. They used to be one, and the poll below owned it:
  // load() clears the slot on every success, so an activate/sell failure was wiped
  // within POLL_MS whether or not anyone had read it — and once the mutations began
  // calling load() themselves (see onSell) it would have been wiped in the same
  // breath as it was set. loadError is the roster's own trouble, actionError is the
  // last mutation's, and the mutation wins while it stands: it is the one the player
  // just caused and the one that may need acting on.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number>(0);

  const load = useCallback(() => {
    void fetchFleet()
      .then((list) => {
        setShips(list);
        setLoadError(null);
      })
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? friendlyError(err) : 'Не удалось загрузить флот'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [active, load]);

  // Both mutations re-read the roster and the layout in `finally`, not on success:
  // on a 502 or a dropped connection the command may already have applied, and the
  // card would otherwise go on showing a ship that is sold and a wallet that is
  // stale — while the text tells the player to go and check exactly that. Same
  // reasoning as CombatHUD.run's unconditional hold re-read (TASK-149); before this
  // the refresh sat inside the try, so the one outcome that needed it most was the
  // one that skipped it.
  const onActivate = useCallback(
    async (shipID: number) => {
      setBusy(shipID);
      setActionError(null);
      try {
        await activateShip(shipID);
      } catch (err) {
        // friendlyError: switching the active ship moves no credits, and re-sending
        // it sets the same field again (TASK-168 AC #3).
        setActionError(err instanceof Error ? friendlyError(err) : 'Не удалось переключить корабль');
      } finally {
        onActivated();
        load();
        setBusy(0);
      }
    },
    [onActivated, load],
  );

  const onSell = useCallback(
    async (shipyardID: number, shipID: number) => {
      setBusy(shipID);
      setActionError(null);
      try {
        await sellShip(shipyardID, shipID);
      } catch (err) {
        // commandErrorText (TASK-168 AC #3): app/sell_ship.go credits the wallet and
        // DELETEs the hull in one transaction, so a lost ack leaves the outcome in
        // doubt — the ship may already be sold and paid for, and «Сервер не ответил»
        // must not read as a refusal.
        setActionError(err instanceof Error ? commandErrorText(err) : 'Не удалось продать корабль');
      } finally {
        onActivated(); // refresh wallet
        load();
        setBusy(0);
      }
    },
    [onActivated, load],
  );

  return { ships, loading, error: actionError ?? loadError, busy, onActivate, onSell };
}
