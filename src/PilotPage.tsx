import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReputationPanel } from './ReputationPanel';
import { fetchMyClan, type ClanDetail } from './clans/clansApi';
import { FleetList } from './fleet/FleetList';
import { useFleet } from './fleet/useFleet';
import { shipDisplayName, useGameContext } from './gameContext';
import { useGalaxy } from './useGalaxy';

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
  const { player, races, world, ownShip, riding, refreshPlayer } = useGameContext();
  const docked = Boolean(ownShip?.docked) && !riding;

  const [clan, setClan] = useState<ClanDetail | null>(null);
  const [clanLoaded, setClanLoaded] = useState(false);

  // The fleet roster reuses the shared FleetPanel data logic (TASK-127.1): while
  // this page is mounted the hook polls GET /api/player/ships and drives the
  // activate/sell actions, feeding the same FleetList the floating panel renders.
  const fleet = useFleet(true, () => void refreshPlayer());
  const galaxy = useGalaxy();
  const resolveSectorName = useCallback(
    (id: number): string | null =>
      galaxy.status === 'ready' ? (galaxy.world.sectors.find((s) => s.id === id)?.name ?? null) : null,
    [galaxy],
  );

  const load = useCallback(() => {
    void fetchMyClan()
      .then((c) => setClan(c))
      .catch((err: unknown) => {
        console.error('fetchMyClan', err);
        setClan(null);
      })
      .finally(() => setClanLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const myRole = clan && player ? clan.members.find((m) => m.playerId === player.playerID)?.role : undefined;
  // activeShipID marks the flown ship in the roster regardless of docked state
  // (mirrors the floating panel: ownShip is the active ship, docked or not); the
  // «Активный» summary reads the same ship so it stays consistent with the list.
  const activeShipID = ownShip?.id ?? null;
  const activeShip = ownShip;

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
              <span className="meta">{fleet.loading && fleet.ships.length === 0 ? '' : fleet.ships.length}</span>
            </div>
            <div className="sw-panel-body">
              <div className="sw-col" style={{ gap: 10 }}>
                <div className="sw-kv">
                  <span className="k">Кораблей</span>
                  <span className="v sw-mono">{fleet.ships.length}</span>
                  <span className="k">Активный</span>
                  <span className="v sw-mono">
                    {activeShip ? shipDisplayName(activeShip, races) : '—'}
                  </span>
                </div>
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  <FleetList
                    ships={fleet.ships}
                    loading={fleet.loading}
                    error={fleet.error}
                    busy={fleet.busy}
                    races={races}
                    activeShipID={activeShipID}
                    sectorName={resolveSectorName}
                    onActivate={(id) => void fleet.onActivate(id)}
                    onSell={(shipyardID, id) => void fleet.onSell(shipyardID, id)}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* --- Репутация (перенесена из левой колонки сектора) --- */}
          <ReputationPanel races={races} refreshSeq={world.policeScanSeq} />
        </div>
      </div>
    </div>
  );
}
