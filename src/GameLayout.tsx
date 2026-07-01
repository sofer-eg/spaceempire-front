import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import {
  EntityKind,
  fetchCargo,
  fetchGoodsCatalog,
  fetchPlayerSelf,
  fetchPlayers,
  fetchRaces,
  fetchStationTypes,
  type CargoInventory,
  type GoodsRow,
  type PlayerSelf,
  type PlayerSummary,
  type Race,
  type StationType,
} from './api';
import { useAuth } from './auth/useAuth';
import type { GameOutletContext } from './gameContext';
import type { TrackedShip } from './useWorldState';
import { useWorldState } from './useWorldState';
import { useGalaxy } from './useGalaxy';
import { Rail } from './Rail';
import { QuestPanel } from './quest/QuestPanel';
import { FleetPanel } from './fleet/FleetPanel';

// WIKI_URL points to the player wiki (docs/wiki). Hosted statically (GitHub
// Pages / Docusaurus) at deploy time; until then it links to the repo docs.
// Override via VITE_WIKI_URL at build time.
const WIKI_URL = import.meta.env.VITE_WIKI_URL ?? 'https://github.com/spaceempire/spaceempire/tree/main/docs/wiki';

export function GameLayout() {
  const { player, logout } = useAuth();
  const navigate = useNavigate();
  const world = useWorldState();
  const galaxy = useGalaxy();
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [clock, setClock] = useState<string>(() => formatClock(new Date()));
  const [self, setSelf] = useState<PlayerSelf | null>(null);
  const [goods, setGoods] = useState<GoodsRow[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [stationTypes, setStationTypes] = useState<StationType[]>([]);
  const [ownCargo, setOwnCargo] = useState<CargoInventory | null>(null);
  // The quest panel is hidden by default; the rail's "задания" button toggles
  // it. questCount feeds the rail badge so the panel isn't lost while hidden.
  const [questsOpen, setQuestsOpen] = useState(false);
  const [questCount, setQuestCount] = useState(0);
  const toggleQuests = useCallback(() => setQuestsOpen((v) => !v), []);
  const closeQuests = useCallback(() => setQuestsOpen(false), []);

  // The fleet panel (10.14a) is hidden by default; the rail's "корабль" button
  // toggles it. It lists the player's ships across sectors and switches the
  // active one.
  const [fleetOpen, setFleetOpen] = useState(false);
  const toggleFleet = useCallback(() => setFleetOpen((v) => !v), []);
  const closeFleet = useCallback(() => setFleetOpen(false), []);

  // The full-center «ПИЛОТ» page (profile + clan + fleet + reputation) is
  // hidden by default; the rail's "пилот" button toggles it. It replaces the
  // sector map (SectorView reads pilotPageOpen from ctx), so opening it also
  // routes to /sector — the page only lives there. Reputation used to sit in
  // the sector's left column; it moved onto this page to declutter it.
  const [pilotOpen, setPilotOpen] = useState(false);
  const togglePilot = useCallback(() => {
    // Navigate from the event handler (not inside the setState updater — that
    // runs during render and triggers a "setState in render" router warning).
    if (!pilotOpen) navigate('/sector');
    setPilotOpen((v) => !v);
  }, [pilotOpen, navigate]);
  const closePilot = useCallback(() => setPilotOpen(false), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchPlayers();
        if (!cancelled) setPlayers(list);
      } catch (err) {
        console.error('fetchPlayers', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // refreshTick lets imperative callers (StationView, MarketView ack) ask
  // the layout to re-fetch the wallet without each one wiring its own
  // fetch. Bumping the tick triggers the effect below.
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshPlayer = useCallback(async () => {
    setRefreshTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await fetchPlayerSelf();
        if (!cancelled) setSelf(p);
      } catch (err) {
        console.error('fetchPlayerSelf', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalog = await fetchGoodsCatalog();
        if (!cancelled) setGoods(catalog);
      } catch (err) {
        console.error('fetchGoodsCatalog', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalog = await fetchRaces();
        if (!cancelled) setRaces(catalog);
      } catch (err) {
        console.error('fetchRaces', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalog = await fetchStationTypes();
        if (!cancelled) setStationTypes(catalog);
      } catch (err) {
        console.error('fetchStationTypes', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCash = useCallback((newCash: number) => {
    setSelf((prev) => (prev ? { ...prev, cash: newCash } : prev));
  }, []);

  // Tick the on-screen clock every second so the HUD feels live.
  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  const logins = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of players) m.set(p.playerID, p.login);
    return m;
  }, [players]);

  // riding: the player is a passenger aboard another ship (10.23). The HUD/
  // camera follow the host (ownShip = host), but controls are disabled.
  const ridingHost = self?.passengerOfShipID
    ? world.ships.get(self.passengerOfShipID) ?? null
    : null;
  const riding = ridingHost !== null;

  const ownShip = useMemo<TrackedShip | null>(() => {
    if (!player) return null;
    // Passenger (10.23): follow the host ship read-only.
    if (ridingHost) return ridingHost;
    // Explicit active ship (10.14a, from /api/player/me) wins when it is
    // present in the subscribed sector and owned by us; otherwise fall back to
    // the lowest-id owned ship.
    if (self?.activeShipID) {
      const active = world.ships.get(self.activeShipID);
      if (active && active.playerID === player.playerID) return active;
    }
    let candidate: TrackedShip | null = null;
    for (const s of world.ships.values()) {
      if (s.playerID === player.playerID && (candidate === null || s.id < candidate.id)) {
        candidate = s;
      }
    }
    return candidate;
  }, [world.ships, player, self, ridingHost]);

  // Own-ship cargo for the ship HUD's ГРУЗ bar. Re-fetched when the ship
  // changes or refreshPlayer fires (after a buy/sell/cargo move). Cleared
  // when the player has no ship.
  const ownShipID = ownShip?.id ?? 0;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (ownShipID === 0) {
        if (!cancelled) setOwnCargo(null);
        return;
      }
      try {
        const c = await fetchCargo({ kind: EntityKind.Ship, id: ownShipID });
        if (!cancelled) setOwnCargo(c);
      } catch (err) {
        console.error('fetchCargo own', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownShipID, refreshTick]);

  const ctx: GameOutletContext = {
    world,
    ships: world.ships,
    statics: world.statics,
    ownPlayerID: player?.playerID ?? 0,
    ownShip,
    riding,
    logins,
    player: self,
    setCash,
    refreshPlayer,
    goods,
    races,
    stationTypes,
    ownCargo,
    pilotPageOpen: pilotOpen,
    closePilotPage: closePilot,
  };

  const sectorName = useMemo<string | null>(() => {
    if (galaxy.status !== 'ready' || !ownShip) return null;
    return galaxy.world.sectors.find((s) => s.id === ownShip.sectorID)?.name ?? null;
  }, [galaxy, ownShip]);
  const resolveSectorName = useCallback(
    (id: number): string | null =>
      galaxy.status === 'ready'
        ? (galaxy.world.sectors.find((s) => s.id === id)?.name ?? null)
        : null,
    [galaxy],
  );
  const sectorLabel = ownShip
    ? `SECTOR · #${ownShip.sectorID}${sectorName ? ` · «${sectorName}»` : ''}`
    : 'SECTOR · —';
  const connChip = world.connection === 'open' ? 'good' : world.connection === 'closed' ? 'danger' : 'warn';

  return (
    <div className="sw-app">
      <div className="sw-stars" />
      <div className="sw-shell">
        <header className="sw-shell__header">
          <div className="sw-panel sw-topbar">
            <Link to="/sector" className="sw-row" style={{ gap: 10, textDecoration: 'none' }}>
              <div className="sw-topbar__brandbox" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <ellipse cx="8" cy="8" rx="7" ry="2.4" stroke="currentColor" strokeWidth="1.1" />
                  <circle cx="8" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.2" fill="var(--bg-1)" />
                  <circle cx="8" cy="8" r="1.1" fill="currentColor" />
                </svg>
              </div>
              <span className="sw-topbar__brand">SPACE · EMPIRE</span>
            </Link>
            <span className="sw-topbar__subtitle">{sectorLabel}</span>
            <div className="sw-spacer" />
            <span className={`sw-chip dot ${connChip}`}>{world.connection.toUpperCase()}</span>
            {world.timeScale < 1 && (
              <span
                className="sw-chip dot warn"
                title="Сервер перегружен — игровое время замедлено (TiDi)"
              >
                ⏳ замедление {Math.round(world.timeScale * 100)}%
              </span>
            )}
            <span className="sw-chip">tick {world.tick}</span>
            <span className="sw-chip">{player?.login ?? '—'}</span>
            <span className="sw-chip sw-mono" title="Кредиты">
              {self ? `${self.cash.toLocaleString('ru-RU')} cr` : '—'}
            </span>
            <span className="sw-topbar__clock sw-mono">{clock}</span>
            <a
              className="sw-chip"
              href={WIKI_URL}
              target="_blank"
              rel="noreferrer"
              title="Вики — механики игры"
            >
              ? Вики
            </a>
            <button type="button" className="sw-btn danger" onClick={() => { void logout(); }}>
              Выйти
            </button>
          </div>
        </header>
        <div className="sw-shell__body">
          <Rail
            docked={Boolean(ownShip?.docked)}
            questsOpen={questsOpen}
            onToggleQuests={toggleQuests}
            questBadge={questCount}
            fleetOpen={fleetOpen}
            onToggleFleet={toggleFleet}
            pilotOpen={pilotOpen}
            onTogglePilot={togglePilot}
            onLeavePilot={closePilot}
          />
          <main className="sw-main">
            <Outlet context={ctx} />
          </main>
          <QuestPanel open={questsOpen} onClose={closeQuests} onCountsChange={setQuestCount} />
          <FleetPanel
            open={fleetOpen}
            onClose={closeFleet}
            races={races}
            activeShipID={ownShip?.id ?? null}
            onActivated={() => { void refreshPlayer(); }}
            sectorName={resolveSectorName}
          />
        </div>
      </div>
    </div>
  );
}

function formatClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
