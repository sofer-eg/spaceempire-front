import { useState } from 'react';
import { sendMove } from './api';

type Props = {
  px: number;
  py: number;
  wx: number;
  wy: number;
  shipID: number;
  onClose: () => void;
};

// SpacePointMenu appears when the player clicks empty space on the sector
// canvas (no object hit). Mirrors the original StarWind #lbSCP popup:
// shows coordinates and a "Лететь" action. Closes on mouseleave — no ×
// button, no outside-click — per the original's mouseleave behaviour.
export function SpacePointMenu({ px, py, wx, wy, shipID, onClose }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doMove = () => {
    setPending(true);
    setError(null);
    sendMove(shipID, wx, wy)
      .then(() => {
        setPending(false);
        onClose();
      })
      .catch((err: unknown) => {
        setPending(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <div
      className="sw-menu sw-canvas-menu"
      style={{ left: px + 8, top: py + 8 }}
      onMouseLeave={onClose}
      role="menu"
    >
      <div className="sw-menu__head">
        Точка пространства ({Math.round(wx)}, {Math.round(wy)})
      </div>
      <button
        type="button"
        role="menuitem"
        className="sw-menu__item"
        onClick={doMove}
        disabled={pending || shipID === 0}
      >
        ▶ Лететь
      </button>
      {error && <div className="sw-menu__error">{error}</div>}
    </div>
  );
}
