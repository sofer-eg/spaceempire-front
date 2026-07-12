import { type Race } from '../api';
import { FleetList } from './FleetList';
import { useFleet } from './useFleet';

// FleetPanel is the floating roster toggled from the rail's "корабль" button
// (GameLayout owns `open`), mirroring QuestPanel. It lists every ship the player
// owns across sectors and switches the active one. Since TASK-127.1 the data +
// mutations live in useFleet and the rows in FleetList — the same pair the Pilot
// page's «Флот» card renders — so this component is just the floating chrome.
// activeShipID is the ship the player currently controls (ownShip); onActivated
// (refreshPlayer) runs after a switch so the HUD/own-ship follow.

type Props = {
  open: boolean;
  onClose: () => void;
  races: Race[];
  activeShipID: number | null;
  onActivated: () => void;
  // sectorName resolves a sector id to its display name (null when unknown).
  sectorName: (id: number) => string | null;
};

export function FleetPanel({ open, onClose, races, activeShipID, onActivated, sectorName }: Props) {
  const { ships, loading, error, busy, onActivate, onSell } = useFleet(open, onActivated);

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
      <div className="sw-panel-body" style={{ overflowY: 'auto' }}>
        <FleetList
          ships={ships}
          loading={loading}
          error={error}
          busy={busy}
          races={races}
          activeShipID={activeShipID}
          sectorName={sectorName}
          onActivate={(id) => void onActivate(id)}
          onSell={(shipyardID, id) => void onSell(shipyardID, id)}
        />
      </div>
    </div>
  );
}
