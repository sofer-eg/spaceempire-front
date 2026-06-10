import { disembark, exitShip, sendUndock, setShipAccess, type CargoInventory, type Race } from './api';
import { shipDisplayName } from './gameContext';
import type { TrackedShip } from './useWorldState';

type Props = {
  ownShip: TrackedShip | null;
  // maxHP / maxShield from the WS welcome — denominators for the hull/shield
  // bars. Combat (damage, charge) is phase 4, so hp/shield currently sit at
  // the max and the bars read full.
  maxHP: number;
  maxShield: number;
  // ownCargo backs the ГРУЗ bar (used/capacity). Null until the first fetch
  // or when the player has no ship.
  ownCargo: CargoInventory | null;
  // races backs shipDisplayName's NPC fallback (phase 10.6); the player's own
  // ship is named after its M5 model, so this is mostly a safety net here.
  races: Race[];
  // onExit refreshes PlayerSelf after the player leaves the ship into a
  // spacesuit (10.23), so ownShip re-resolves to the new active suit. It is
  // reused after disembark for the same reason.
  onExit: () => void;
  // riding marks passenger mode (10.23): ownShip is the HOST, shown read-only —
  // controls are hidden and only «Высадиться» is offered.
  riding: boolean;
};

// PilotPanel is the "КОРАБЛЬ" HUD: identity + vital bars (hull, shield,
// speed, cargo) + the flight telemetry that the mockup omits but is useful
// in-flight (sector, position, heading, turn rate, target, route).
export function PilotPanel({ ownShip, maxHP, maxShield, ownCargo, races, onExit, riding }: Props) {
  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <span className="title">
          {ownShip
            ? riding
              ? `ПАССАЖИР · ${shipDisplayName(ownShip, races)}`
              : ownShip.isSpacesuit
                ? 'СКАФАНДР'
                : shipDisplayName(ownShip, races)
            : 'Корабль'}
        </span>
        <span className="meta">{ownShip ? `#${ownShip.id}` : ''}</span>
      </div>
      <div className="sw-panel-body">
        {ownShip === null ? (
          <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
            Корабль не назначен.
          </span>
        ) : (
          <div className="sw-col" style={{ gap: 12 }}>
            <div className="sw-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
              {ownShip.isHidden &&
                (ownShip.attackTarget ? (
                  <span className="sw-chip dot warn" title="Стелс снят — корабль ведёт огонь">
                    СТЕЛС СНЯТ
                  </span>
                ) : (
                  <span className="sw-chip dot good" title="Маскировка активна — корабль скрыт от чужих радаров">
                    СТЕЛС
                  </span>
                ))}
              {riding ? (
                <span className="sw-chip dot warn">ПАССАЖИР</span>
              ) : ownShip.isSpacesuit ? (
                <span className="sw-chip dot danger">СКАФАНДР</span>
              ) : (
                <span className="sw-chip dot good">ON-LINE</span>
              )}
            </div>
            <div className="sw-row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span className="sw-mono" style={{ fontSize: 10, color: 'var(--ink-mute)', letterSpacing: '0.06em' }}>
                #{ownShip.id} · сектор #{ownShip.sectorID}
              </span>
              <span className="sw-row" style={{ gap: 6 }}>
                {riding && (
                  <button
                    type="button"
                    className="sw-btn"
                    style={{ padding: '3px 8px', fontSize: 9 }}
                    title="Сойти с корабля в скафандре"
                    onClick={() => {
                      void disembark()
                        .then(onExit)
                        .catch((err: unknown) => console.error('disembark', err));
                    }}
                  >
                    Высадиться
                  </button>
                )}
                {!riding && ownShip.docked && (
                  <>
                    <span className="sw-chip dot warn">ПРИСТЫКОВАН</span>
                    <button
                      type="button"
                      className="sw-btn ghost"
                      style={{ padding: '3px 8px', fontSize: 9 }}
                      onClick={() => {
                        void sendUndock(ownShip.id).catch((err: unknown) =>
                          console.error('sendUndock', err),
                        );
                      }}
                    >
                      Расстыковка
                    </button>
                  </>
                )}
                {!riding && !ownShip.isSpacesuit && (
                  <>
                    <button
                      type="button"
                      className={`sw-btn ghost${ownShip.isOpen ? ' active' : ''}`}
                      style={{ padding: '3px 8px', fontSize: 9 }}
                      title={
                        ownShip.isOpen
                          ? 'Вход разрешён другим игрокам — нажмите, чтобы закрыть'
                          : 'Вход закрыт — нажмите, чтобы разрешить другим садиться пассажиром'
                      }
                      onClick={() => {
                        void setShipAccess(ownShip.id, !ownShip.isOpen).catch((err: unknown) =>
                          console.error('setShipAccess', err),
                        );
                      }}
                    >
                      {ownShip.isOpen ? 'Вход открыт' : 'Вход закрыт'}
                    </button>
                    <button
                      type="button"
                      className="sw-btn ghost"
                      style={{ padding: '3px 8px', fontSize: 9 }}
                      title="Выйти в скафандре (на станции — в ангар, в космосе — наружу)"
                      onClick={() => {
                        void exitShip(ownShip.id)
                          .then(onExit)
                          .catch((err: unknown) => console.error('exitShip', err));
                      }}
                    >
                      Покинуть корабль
                    </button>
                  </>
                )}
              </span>
            </div>

            <div className="sw-col" style={{ gap: 8 }}>
              <Vital label="Корпус" value={ownShip.hp} max={maxHP} unit="" variant={hullVariant(ownShip.hp, maxHP)} />
              <Vital label="Щиты" value={ownShip.shield} max={maxShield} unit="" variant="" />
              <Vital label="Энергия" value={ownShip.energy} max={ownShip.maxEnergy} unit="" variant="" />
              <Vital
                label="Скорость"
                value={Math.round(Math.hypot(ownShip.vx, ownShip.vy))}
                max={Math.round(ownShip.maxSpeed)}
                unit=" u/s"
                variant=""
              />
              <Vital
                label="Груз"
                value={ownCargo ? ownCargo.used : 0}
                max={ownCargo ? ownCargo.capacity : 0}
                unit=""
                variant=""
                unknown={ownCargo === null}
              />
            </div>

            <div className="sw-div" />
            <div className="sw-kv">
              <span className="k">X</span>
              <span className="v">{fmt(ownShip.x)}</span>
              <span className="k">Y</span>
              <span className="v">{fmt(ownShip.y)}</span>
              <span className="k">Курс</span>
              <span className="v">{fmtCourse(ownShip)}</span>
              <span className="k">Поворот</span>
              <span className="v">{fmtScalar((ownShip.turnRate * 180) / Math.PI)}°/тик</span>
              <span className="k">Ускорение</span>
              <span className="v">{fmtScalar(ownShip.acceleration)} u/s²</span>
              <span className="k">Цель</span>
              <span className="v">
                {ownShip.targetX !== undefined && ownShip.targetY !== undefined
                  ? `${fmt(ownShip.targetX)}, ${fmt(ownShip.targetY)}`
                  : '—'}
              </span>
              <span className="k">Маршрут</span>
              <span className="v accent">
                {ownShip.finalTarget ? `→ #${ownShip.finalTarget.sectorID}` : '—'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Vital renders one labelled stat (value / max) above a fill bar. The bar
// width is value/max clamped to [0,100]%. unknown=true (cargo not loaded)
// shows "—" and an empty bar.
function Vital({
  label,
  value,
  max,
  unit,
  variant,
  unknown,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  variant: string;
  unknown?: boolean;
}) {
  const pct = !unknown && max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="sw-vital">
      <div className="sw-vital__head">
        <span className="sw-vital__label">{label}</span>
        <span className="sw-vital__value sw-mono">
          {unknown ? '—' : `${value} / ${max}${unit}`}
        </span>
      </div>
      <div className={`sw-bar ${variant}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// hullVariant colours the hull bar by remaining fraction: green ≥50%,
// amber 25–50%, red below. Shield/speed/cargo stay on the default accent.
function hullVariant(hp: number, max: number): string {
  if (max <= 0) return '';
  const r = hp / max;
  if (r >= 0.5) return 'good';
  if (r >= 0.25) return 'warn';
  return 'danger';
}

function fmt(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}${Math.abs(n).toFixed(0).padStart(4, '0')}`;
}

function fmtScalar(n: number): string {
  return n.toFixed(1);
}

// fmtCourse renders the ship's heading as degrees (0..360). The delta to
// target is shown when target is set so the player can judge how much
// further they need to turn before thrust gives meaningful progress.
function fmtCourse(s: TrackedShip): string {
  const facing = Math.atan2(s.directionY, s.directionX);
  const deg = ((facing * 180) / Math.PI + 360) % 360;
  if (s.targetX === undefined || s.targetY === undefined) {
    return `${deg.toFixed(0)}°`;
  }
  const desired = Math.atan2(s.targetY - s.y, s.targetX - s.x);
  let diff = desired - facing;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const diffDeg = (diff * 180) / Math.PI;
  const sign = diffDeg >= 0 ? '+' : '−';
  return `${deg.toFixed(0)}° (Δ${sign}${Math.abs(diffDeg).toFixed(0)}°)`;
}
