import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchFleet, type Ship } from './api';
import { ReputationPanel } from './ReputationPanel';
import { fetchMyClan, type ClanDetail } from './clans/clansApi';
import { shipDisplayName, useGameContext } from './gameContext';

// PilotPage is the full-center «ПИЛОТ» view: the pilot dossier that replaces
// the sector map when the rail's «пилот» button is on (mirrors StationView
// swapping in while docked). It gathers everything tied to the player rather
// than the ship: identity + wallet, clan membership, a fleet summary, and the
// race-reputation panel that used to crowd the sector's left column.
type Props = {
  // onClose returns the centre to the map/station (rail «сектор»/«станция» and
  // the page's own «назад» button share it).
  onClose: () => void;
};

function roleLabel(role: ClanDetail['members'][number]['role']): string {
  switch (role) {
    case 'leader':
      return 'Лидер';
    case 'officer':
      return 'Офицер';
    default:
      return 'Участник';
  }
}

export function PilotPage({ onClose }: Props) {
  const { player, races, world, ownShip, riding } = useGameContext();
  const docked = Boolean(ownShip?.docked) && !riding;

  const [clan, setClan] = useState<ClanDetail | null>(null);
  const [clanLoaded, setClanLoaded] = useState(false);
  const [fleet, setFleet] = useState<Ship[] | null>(null);

  const load = useCallback(() => {
    void fetchMyClan()
      .then((c) => setClan(c))
      .catch((err: unknown) => {
        console.error('fetchMyClan', err);
        setClan(null);
      })
      .finally(() => setClanLoaded(true));
    void fetchFleet()
      .then((list) => setFleet(list))
      .catch((err: unknown) => {
        console.error('fetchFleet', err);
        setFleet([]);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const myRole = clan && player ? clan.members.find((m) => m.playerId === player.playerID)?.role : undefined;
  const activeShip = ownShip && !docked ? ownShip : null;

  return (
    <div className="sw-panel sw-pilot">
      <div className="sw-panel-head">
        <span className="title">Пилот</span>
        <div className="sw-row" style={{ gap: 6 }}>
          <span className="sw-chip">{player ? player.login : '—'}</span>
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
        <div className="sw-pilot__grid">
          {/* --- Профиль --- */}
          <section className="sw-panel sw-pilot__card">
            <div className="sw-panel-head">
              <span className="title">Профиль</span>
              <span className="meta">{player ? `#${player.playerID}` : ''}</span>
            </div>
            <div className="sw-panel-body">
              {player === null ? (
                <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
                  Загрузка профиля…
                </span>
              ) : (
                <div className="sw-col" style={{ gap: 10 }}>
                  <div className="sw-pilot__callsign sw-mono">{player.login}</div>
                  <div className="sw-kv">
                    <span className="k">Кредиты</span>
                    <span className="v accent sw-mono">{player.cash.toLocaleString('ru-RU')} cr</span>
                    <span className="k">ID пилота</span>
                    <span className="v sw-mono">#{player.playerID}</span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* --- Клан --- */}
          <section className="sw-panel sw-pilot__card">
            <div className="sw-panel-head">
              <span className="title">Клан</span>
              <Link
                to="/clans"
                className="sw-chip"
                style={{ textDecoration: 'none' }}
                onClick={onClose}
                title="Открыть экран кланов"
              >
                {clan ? 'Открыть' : 'Кланы'}
              </Link>
            </div>
            <div className="sw-panel-body">
              {!clanLoaded ? (
                <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
                  Загрузка…
                </span>
              ) : clan ? (
                <div className="sw-col" style={{ gap: 10 }}>
                  <div className="sw-row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span className="sw-chip dot good">[{clan.tag}]</span>
                    <span className="sw-mono" style={{ fontSize: 14, fontWeight: 600 }}>
                      {clan.name}
                    </span>
                    {myRole && <span className="meta" style={{ marginLeft: 'auto' }}>{roleLabel(myRole)}</span>}
                  </div>
                  <div className="sw-kv">
                    <span className="k">Участников</span>
                    <span className="v sw-mono">{clan.members.length}</span>
                    <span className="k">Казна</span>
                    <span className="v sw-mono">{clan.treasury.toLocaleString('ru-RU')} cr</span>
                  </div>
                </div>
              ) : (
                <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
                  Без клана.
                </span>
              )}
            </div>
          </section>

          {/* --- Флот --- */}
          <section className="sw-panel sw-pilot__card">
            <div className="sw-panel-head">
              <span className="title">Флот</span>
              <span className="meta">{fleet ? `${fleet.length}` : ''}</span>
            </div>
            <div className="sw-panel-body">
              {fleet === null ? (
                <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
                  Загрузка…
                </span>
              ) : (
                <div className="sw-col" style={{ gap: 10 }}>
                  <div className="sw-kv">
                    <span className="k">Кораблей</span>
                    <span className="v sw-mono">{fleet.length}</span>
                    <span className="k">Активный</span>
                    <span className="v sw-mono">
                      {activeShip ? shipDisplayName(activeShip, races) : '—'}
                    </span>
                  </div>
                  <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 10 }}>
                    Управление — в меню «Корабль».
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* --- Репутация (перенесена из левой колонки сектора) --- */}
          <ReputationPanel races={races} refreshSeq={world.policeScanSeq} />
        </div>
      </div>
    </div>
  );
}
