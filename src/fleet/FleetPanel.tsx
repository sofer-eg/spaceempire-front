import { useCallback, useEffect, useState } from 'react';
import { activateShip, EntityKind, fetchFleet, sellShip, type Race, type Ship } from '../api';
import { shipDisplayName } from '../gameContext';

// FleetPanel lists every ship the player owns across all sectors (10.14a) and
// lets them switch the active ship. Floating panel toggled from the rail's
// "корабль" button (GameLayout owns `open`), mirroring QuestPanel. activeShipID
// is the ship the player currently controls (ownShip — explicit active_ship_id
// or the min-id fallback), so the flown ship is always marked. After a switch
// the panel calls onActivated (refreshPlayer) so the HUD/own-ship follow, then
// re-fetches.

const POLL_MS = 4000;

type Props = {
  open: boolean;
  onClose: () => void;
  races: Race[];
  activeShipID: number | null;
  // onActivated runs after a successful switch so the layout refreshes
  // PlayerSelf (and therefore ownShip / WS subscription).
  onActivated: () => void;
  // sectorName resolves a sector id to its display name (null when unknown).
  sectorName: (id: number) => string | null;
};

export function FleetPanel({ open, onClose, races, activeShipID, onActivated, sectorName }: Props) {
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
    if (!open) return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [open, load]);

  const onActivate = async (shipID: number) => {
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
  };

  const onSell = async (shipyardID: number, shipID: number) => {
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
  };

  if (!open) return null;

  return (
    <div
      className="sw-panel"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 320,
        zIndex: 50,
        maxHeight: 'calc(100vh - 96px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="sw-panel-head">
        <span className="title">Флот</span>
        <button
          type="button"
          className="sw-btn ghost"
          onClick={onClose}
          title="Скрыть панель"
          aria-label="Скрыть панель флота"
          style={{ padding: '2px 9px', letterSpacing: 0, fontSize: 14, lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      <div
        className="sw-panel-body"
        style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}
      >
        {loading && ships.length === 0 && (
          <span style={{ color: 'var(--muted, #7a8a99)' }}>Загрузка…</span>
        )}
        {error && <span style={{ color: 'var(--danger, #e06c75)' }}>{error}</span>}
        {!loading && !error && ships.length === 0 && (
          <span style={{ color: 'var(--muted, #7a8a99)' }}>Нет кораблей.</span>
        )}
        {ships.map((s) => {
          const isActive = s.id === activeShipID;
          const sName = sectorName(s.sectorID);
          const loc = s.docked
            ? `пристыкован · ${sName ?? `сектор #${s.sectorID}`}`
            : sName
              ? `сектор «${sName}»`
              : `сектор #${s.sectorID}`;
          return (
            <div
              key={s.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                borderLeft: isActive ? '2px solid var(--cyan, #56b6c2)' : '2px solid transparent',
                paddingLeft: 8,
              }}
            >
              <div className="sw-row" style={{ gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600 }}>{shipDisplayName(s, races)}</span>
                <div className="sw-spacer" />
                {isActive && <span className="sw-chip active">активный</span>}
                {s.isSpacesuit && <span className="sw-chip dot danger">СКАФАНДР</span>}
              </div>
              <div className="sw-row" style={{ gap: 6, alignItems: 'center' }}>
                <span style={{ color: 'var(--muted, #7a8a99)', fontSize: 12 }}>{loc}</span>
                <div className="sw-spacer" />
                {!isActive && s.docked?.kind === EntityKind.Shipyard && (
                  <button
                    type="button"
                    className="sw-btn ghost"
                    disabled={busy === s.id}
                    title="Продать на этой верфи"
                    onClick={() => void onSell(s.docked!.id, s.id)}
                  >
                    Продать
                  </button>
                )}
                <button
                  type="button"
                  className="sw-btn"
                  disabled={isActive || busy === s.id}
                  title={isActive ? 'Это активный корабль' : 'Сделать активным'}
                  onClick={() => void onActivate(s.id)}
                >
                  {isActive ? 'Активен' : 'Сделать активным'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
