import { EntityKind, type Race, type Ship } from '../api';
import { shipDisplayName } from '../gameContext';

// FleetList is the presentational fleet roster the Pilot page's «Флот» card
// renders (TASK-127.1). It renders one row per ship — name/class, human-readable
// location (sector name + docked marker), the active marker, a «СКАФАНДР» chip,
// and the activate/sell actions. All data + mutations come from props (see
// useFleet); this component keeps no state.
type Props = {
  ships: Ship[];
  loading: boolean;
  error: string | null;
  // busy is the id of the ship whose action is in flight (0 = none).
  busy: number;
  races: Race[];
  // activeShipID marks the ship the player currently controls (ownShip).
  activeShipID: number | null;
  // sectorName resolves a sector id to its display name (null when unknown).
  sectorName: (id: number) => string | null;
  onActivate: (shipID: number) => void;
  onSell: (shipyardID: number, shipID: number) => void;
};

export function FleetList({
  ships,
  loading,
  error,
  busy,
  races,
  activeShipID,
  sectorName,
  onActivate,
  onSell,
}: Props) {
  return (
    <div className="sw-col" style={{ gap: 10 }}>
      {loading && ships.length === 0 && <span style={{ color: 'var(--muted, #7a8a99)' }}>Загрузка…</span>}
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
                  onClick={() => onSell(s.docked!.id, s.id)}
                >
                  Продать
                </button>
              )}
              <button
                type="button"
                className="sw-btn"
                disabled={isActive || busy === s.id}
                title={isActive ? 'Это активный корабль' : 'Сделать активным'}
                onClick={() => onActivate(s.id)}
              >
                {isActive ? 'Активен' : 'Сделать активным'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
