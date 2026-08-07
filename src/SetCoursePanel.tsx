import { useMemo, useState } from 'react';
import { friendlyError, sendSetCourse, type InstalledEquipment } from './api';
import { useGalaxy } from './useGalaxy';

type Props = {
  shipID: number;
  // currentSectorID is what the SPA last observed for the player's ship.
  // The destination dropdown excludes it so the player cannot "set course"
  // to the sector they're already in (the autopilot handles that case
  // anyway, but the UI is clearer this way).
  currentSectorID: number;
  // equipment is the active ship's installed-module list. The autopilot is
  // gated server-side on up_autopilot (phase 10.3.11, 422); mirroring the
  // gate here disables the form so the click never fails.
  equipment?: InstalledEquipment[];
};

type Status =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; hops: number }
  | { kind: 'error'; message: string };

export function SetCoursePanel({ shipID, currentSectorID, equipment }: Props) {
  const galaxy = useGalaxy();
  // shipUnknown: SectorView renders this panel before the WS has delivered the
  // player's ship (GameLayout's ownShip is null → shipID 0 → equipment
  // undefined). Without this split the missing list read as a missing module and
  // the panel asserted «Нужен модуль автопилота» about a ship it had not seen
  // yet — the TASK-140/166 class of false statement (TASK-187).
  //
  // An undefined `equipment` on a ship that IS here is NOT that case and needs no
  // guard: every WS frame carries the whole Ship DTO (buildSnapshotDTO →
  // dto.ShipsFromDomain for both the first frame's Added and later Updated) and
  // useWorldState's upsert overwrites the field from each one, so undefined means
  // exactly `len(Ship.Equipment) == 0` server-side — no modules fitted, and
  // «нужен автопилот» is then true. There is no partial ship frame to be caught
  // half-loaded by.
  const shipUnknown = shipID === 0;
  const hasAutopilot = !!equipment?.some((e) => e.type === 'up_autopilot');
  const [destSectorChoice, setDestSectorChoice] = useState<number>(0);
  const [destX, setDestX] = useState<string>('0');
  const [destY, setDestY] = useState<string>('0');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Effective destination: explicit user choice wins; otherwise default to the
  // first sector that isn't the player's current one. Computed in render so we
  // don't need a setState-in-effect — react-hooks lint forbids that.
  const destSector = useMemo<number>(() => {
    if (destSectorChoice !== 0) return destSectorChoice;
    if (galaxy.status !== 'ready') return 0;
    const first = galaxy.world.sectors.find((s) => s.id !== currentSectorID);
    return first ? first.id : 0;
  }, [destSectorChoice, galaxy, currentSectorID]);

  const onSubmit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (shipID === 0 || destSector === 0) return;
    setStatus({ kind: 'pending' });
    try {
      const x = Number.parseFloat(destX);
      const y = Number.parseFloat(destY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        setStatus({ kind: 'error', message: 'Координаты должны быть числами' });
        return;
      }
      const res = await sendSetCourse(shipID, destSector, x, y);
      setStatus({ kind: 'ok', hops: res.hops });
    } catch (err) {
      // friendlyError, not String(err) (which prefixed the class name) and not
      // commandErrorText — see the note on commandErrorText: laying a course
      // spends nothing, so the in-doubt wording would be false (TASK-168).
      setStatus({ kind: 'error', message: friendlyError(err) });
    }
  };

  const sectors = galaxy.status === 'ready' ? galaxy.world.sectors : [];

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <span className="title">Автопилот</span>
        <span className="meta">SET COURSE</span>
      </div>
      <div className="sw-panel-body">
        <form className="sw-form" onSubmit={(ev) => void onSubmit(ev)}>
          {/* --stacked: the caption sits above this control, not in the shared
              70px column. A sector name is the whole point of the field and
              the ship column is 240px at its narrowest, so those 78px decide
              whether the select is readable or clipped (TASK-139). */}
          <label className="sw-form__stacked">
            <span>Сектор</span>
            <select
              value={destSector}
              onChange={(ev) => setDestSectorChoice(Number.parseInt(ev.target.value, 10))}
            >
              <option value={0} disabled>
                — выбрать —
              </option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id} disabled={s.id === currentSectorID}>
                  {s.name} (#{s.id}){s.id === currentSectorID ? ' — текущий' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>X</span>
            <input
              type="number"
              value={destX}
              onChange={(ev) => setDestX(ev.target.value)}
              step="any"
            />
          </label>
          <label>
            <span>Y</span>
            <input
              type="number"
              value={destY}
              onChange={(ev) => setDestY(ev.target.value)}
              step="any"
            />
          </label>
          <button
            type="submit"
            className="sw-btn"
            disabled={shipUnknown || destSector === 0 || status.kind === 'pending' || !hasAutopilot}
            title={shipUnknown ? 'Корабль ещё не загружен' : !hasAutopilot ? 'Нужен модуль автопилота (up_autopilot)' : undefined}
          >
            Задать курс
          </button>
          <span
            className={`sw-form__status ${
              status.kind === 'ok' ? 'ok' : status.kind === 'error' ? 'error' : ''
            }`}
          >
            {shipUnknown && 'Корабль ещё не загружен'}
            {!shipUnknown && !hasAutopilot && 'Нужен модуль автопилота (up_autopilot)'}
            {hasAutopilot && status.kind === 'ok' && `Курс задан, ${status.hops} прыжков`}
            {hasAutopilot && status.kind === 'error' && status.message}
            {hasAutopilot && status.kind === 'pending' && 'Отправка…'}
          </span>
        </form>
      </div>
    </div>
  );
}
