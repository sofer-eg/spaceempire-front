import { useMemo, useState } from 'react';
import { sendSetCourse } from './api';
import { useGalaxy } from './useGalaxy';

type Props = {
  shipID: number;
  // currentSectorID is what the SPA last observed for the player's ship.
  // The destination dropdown excludes it so the player cannot "set course"
  // to the sector they're already in (the autopilot handles that case
  // anyway, but the UI is clearer this way).
  currentSectorID: number;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; hops: number }
  | { kind: 'error'; message: string };

export function SetCoursePanel({ shipID, currentSectorID }: Props) {
  const galaxy = useGalaxy();
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
      setStatus({ kind: 'error', message: String(err) });
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
          <label>
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
            disabled={shipID === 0 || destSector === 0 || status.kind === 'pending'}
          >
            Задать курс
          </button>
          <span
            className={`sw-form__status ${
              status.kind === 'ok' ? 'ok' : status.kind === 'error' ? 'error' : ''
            }`}
          >
            {status.kind === 'ok' && `Курс задан, ${status.hops} прыжков`}
            {status.kind === 'error' && status.message}
            {status.kind === 'pending' && 'Отправка…'}
          </span>
        </form>
      </div>
    </div>
  );
}
