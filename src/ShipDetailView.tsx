import { useEffect, useState } from 'react';
import { fetchEquipment, type Equipment } from './api';
import { shipDisplayName, useGameContext } from './gameContext';
import { Vital } from './PilotPanel';
import { fmtScalar, hullVariant } from './shipStats';
import { equipName } from './station/shipyardRequirements';

// ShipDetailView is the full-center «ДЕТАЛИ КОРАБЛЯ» screen: the rail's
// «корабль» button swaps it in for the sector map (mirrors PilotPage /
// StationView filling the same map cell). It shows the active ship's vitals,
// characteristics and its installed-equipment list resolved to human names —
// data already on the client (ownShip + ownCargo); the only fetch is the
// equipment catalog for the id→description lookup (TASK-127.2).
type Props = {
  // onClose returns the centre to the map/station (rail «сектор»/«станция» and
  // the screen's own «назад» button share it), mirroring PilotPage.
  onClose: () => void;
};

export function ShipDetailView({ onClose }: Props) {
  const { ownShip, ownCargo, races, riding } = useGameContext();
  const docked = Boolean(ownShip?.docked) && !riding;

  // The equipment catalog resolves each installed module's human name. null
  // while the fetch is in flight (→ «Загрузка…»); on failure it stays [] so
  // equipName falls back to the module type key rather than blanking the list.
  const [catalog, setCatalog] = useState<Equipment[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const eq = await fetchEquipment();
        if (!cancelled) setCatalog(eq);
      } catch (err) {
        console.error('fetchEquipment', err);
        if (!cancelled) setCatalog([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const equipment = ownShip?.equipment ?? [];

  return (
    <div className="sw-panel sw-pilot">
      <div className="sw-panel-head">
        <span className="title">
          {ownShip
            ? ownShip.isSpacesuit
              ? 'Скафандр'
              : shipDisplayName(ownShip, races)
            : 'Детали корабля'}
        </span>
        <div className="sw-row" style={{ gap: 6 }}>
          <span className="sw-chip">{ownShip ? `#${ownShip.id}` : '—'}</span>
          <button
            type="button"
            className="sw-btn ghost"
            onClick={onClose}
            title={docked ? 'Вернуться на станцию' : 'Вернуться к карте сектора'}
          >
            ← {docked ? 'Станция' : 'Карта сектора'}
          </button>
        </div>
      </div>
      <div className="sw-pilot__body">
        {ownShip === null ? (
          <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
            Корабль не назначен.
          </span>
        ) : (
          <div className="sw-pilot__grid">
            {/* --- Состояние (vital bars, same as the left HUD) --- */}
            <section className="sw-panel sw-pilot__card">
              <div className="sw-panel-head">
                <span className="title">Состояние</span>
              </div>
              <div className="sw-panel-body">
                <div className="sw-col" style={{ gap: 8 }}>
                  <Vital label="Корпус" value={ownShip.hp} max={ownShip.maxHP} unit="" variant={hullVariant(ownShip.hp, ownShip.maxHP)} />
                  <Vital label="Щиты" value={ownShip.shield} max={ownShip.maxShield} unit="" variant="" />
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
              </div>
            </section>

            {/* --- ТТХ --- */}
            <section className="sw-panel sw-pilot__card">
              <div className="sw-panel-head">
                <span className="title">Характеристики</span>
              </div>
              <div className="sw-panel-body">
                <div className="sw-kv">
                  <span className="k">Ускорение</span>
                  <span className="v sw-mono">{fmtScalar(ownShip.acceleration)} u/s²</span>
                  <span className="k">Поворот</span>
                  <span className="v sw-mono">{fmtScalar((ownShip.turnRate * 180) / Math.PI)}°/тик</span>
                  <span className="k">Радиус радара</span>
                  <span className="v sw-mono">{ownShip.radarRange ? `${Math.round(ownShip.radarRange)} u` : '—'}</span>
                  <span className="k">Класс корпуса</span>
                  <span className="v sw-mono">{ownShip.hullCategory ?? '—'}</span>
                  <span className="k">ID</span>
                  <span className="v sw-mono">#{ownShip.id}</span>
                  <span className="k">Сектор</span>
                  <span className="v sw-mono">#{ownShip.sectorID}</span>
                </div>
              </div>
            </section>

            {/* --- Оборудование --- */}
            <section className="sw-panel sw-pilot__card">
              <div className="sw-panel-head">
                <span className="title">Оборудование</span>
                <span className="meta">{catalog === null ? '' : equipment.length}</span>
              </div>
              <div className="sw-panel-body">
                {catalog === null ? (
                  <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
                    Загрузка…
                  </span>
                ) : equipment.length === 0 ? (
                  <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
                    Оборудование не установлено.
                  </span>
                ) : (
                  <div className="sw-col" style={{ gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                    {equipment.map((m) => (
                      <div
                        key={m.equipmentID}
                        className="sw-row"
                        style={{ justifyContent: 'space-between', gap: 8 }}
                      >
                        <span className="sw-mono" style={{ fontSize: 12 }}>{equipName(catalog, m)}</span>
                        <span className="sw-chip sw-mono">ур. {m.level}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
