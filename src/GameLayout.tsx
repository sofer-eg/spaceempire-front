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
import { dockedStationLabel, type GameOutletContext } from './gameContext';
import type { TrackedShip } from './useWorldState';
import { useWorldState } from './useWorldState';
import { useGalaxy } from './useGalaxy';
import { Rail } from './Rail';
import { QuestPanel } from './quest/QuestPanel';

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

  // Two mutually-exclusive full-center screens replace the sector map: the
  // «ПИЛОТ» page (profile + clan + fleet + reputation) and the «ДЕТАЛИ КОРАБЛЯ»
  // screen (TASK-127.2; the fleet roster the ship button used to toggle moved
  // onto the pilot page in TASK-127.1). Both are hidden by default and owned
  // here — SectorView reads pilotPageOpen / shipPageOpen from ctx to pick what
  // fills the map cell. Opening one routes to /sector (the screens live there
  // only) and closes the other. Both state atoms are declared before the toggle
  // callbacks so each toggle may close the other without a use-before-declare.
  const [pilotOpen, setPilotOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const togglePilot = useCallback(() => {
    // Navigate from the event handler (not inside the setState updater — that
    // runs during render and triggers a "setState in render" router warning).
    if (!pilotOpen) {
      navigate('/sector');
      setShipOpen(false); // ship and pilot pages are mutually exclusive
    }
    setPilotOpen((v) => !v);
  }, [pilotOpen, navigate]);
  const closePilot = useCallback(() => setPilotOpen(false), []);
  const toggleShip = useCallback(() => {
    if (!shipOpen) {
      navigate('/sector');
      setPilotOpen(false); // ship and pilot pages are mutually exclusive
    }
    setShipOpen((v) => !v);
  }, [shipOpen, navigate]);
  const closeShip = useCallback(() => setShipOpen(false), []);

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

  // Human title of the static the ship is docked at (null in space / while
  // riding). Resolved here — not in the rail — because the rail renders outside
  // <Outlet> and can't call the useStation() hook. Feeds the «станция» tooltip.
  const dockedLabel = dockedStationLabel(ownShip, world.statics, stationTypes);

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
    shipPageOpen: shipOpen,
    closeShipPage: closeShip,
  };

  const sectorName = useMemo<string | null>(() => {
    if (galaxy.status !== 'ready' || !ownShip) return null;
    return galaxy.world.sectors.find((s) => s.id === ownShip.sectorID)?.name ?? null;
  }, [galaxy, ownShip]);
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
            docked={Boolean(ownShip?.docked) && !riding}
            stationLabel={dockedLabel}
            questsOpen={questsOpen}
            onToggleQuests={toggleQuests}
            questBadge={questCount}
            shipOpen={shipOpen}
            onToggleShip={toggleShip}
            onLeaveShip={closeShip}
            pilotOpen={pilotOpen}
            onTogglePilot={togglePilot}
            onLeavePilot={closePilot}
          />
          <main className="sw-main">
            <Outlet context={ctx} />
          </main>
          <QuestPanel open={questsOpen} onClose={closeQuests} onCountsChange={setQuestCount} />
        </div>
      </div>
    </div>
  );
}

function formatClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
