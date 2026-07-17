import { useEffect, useMemo, useState } from 'react';
import { useGameContext } from './gameContext';
import { SectorCanvas, type SelectedTargetRef, type ZoomMode } from './SectorCanvas';
import { SetCoursePanel } from './SetCoursePanel';
import { TargetsPanel, type HighlightRef } from './TargetsPanel';
import { PilotPanel } from './PilotPanel';
import { CombatHUD } from './CombatHUD';
import { EventLog } from './EventLog';
import { StationView } from './station/StationView';
import { PilotPage } from './PilotPage';
import { ShipDetailView } from './ShipDetailView';
import { useGalaxy } from './useGalaxy';
import { useCombatLog } from './useCombatLog';
import { usePoliceLog } from './usePoliceLog';
import { useShipCaptureLog } from './useShipCaptureLog';
import { useStationHackedLog } from './useStationHackedLog';
import { EntityKind, type WorldGate } from './api';

const EMPTY_GATES: WorldGate[] = [];
const EMPTY_SECTOR_NAMES = new Map<number, string>();

export function SectorView() {
  const { ships, statics, ownPlayerID, ownShip, riding, logins, world, ownCargo, refreshPlayer, races, goods, stationTypes, pilotPageOpen, closePilotPage, shipPageOpen, closeShipPage } =
    useGameContext();
  // Stable race id → palette colour map for the canvas (phase 8.13). Built
  // once per races-catalog change so SectorCanvas's redraw deps stay stable.
  const raceColors = useMemo<Map<number, string>>(
    () => new Map(races.map((r) => [r.id, r.color])),
    [races],
  );
  const galaxy = useGalaxy();
  const ownShipID = ownShip?.id ?? 0;
  const ownSectorID = ownShip?.sectorID ?? 0;
  // While riding as a passenger (10.23) the player has no controllable ship and
  // sees the host from the sector view (never the station screen of a ship they
  // don't own). controlShipID gates every command the canvas / panels issue.
  const docked = Boolean(ownShip?.docked) && !riding;
  const controlShipID = riding ? 0 : ownShipID;

  // Fold this snapshot's combat effects into the HUD event log (damage
  // dealt/taken, kills). The backend ships no named combat events — see
  // useCombatLog for how the player's perspective is derived.
  useCombatLog({
    tick: world.tick,
    ownShipID,
    laserEffects: world.laserEffects,
    missileImpacts: world.missileImpacts,
    droneImpacts: world.droneImpacts,
    ships,
    logins,
  });

  // Police confiscation events → combat journal (phase 9.4). Watches the
  // police-scan seq bumped by useWorldState; resolves faction/goods names.
  usePoliceLog(world.policeScanSeq, world.lastPoliceScan, races, goods);

  // Ship-capture outcomes → combat journal (phase 10.3.9.5). Watches the
  // capture seq bumped by useWorldState; wording depends on captor/success.
  useShipCaptureLog(world.shipCaptureSeq, world.lastShipCapture);

  // Station-hack outcomes → combat journal (phase 10.3.9.6). Watches the
  // hack seq bumped by useWorldState; resolves the looted good's name.
  useStationHackedLog(world.stationHackedSeq, world.lastStationHacked, goods);

  // Gate topology and sector-name lookup for SectorCanvas. TargetsPanel
  // already pulls the same useGalaxy() cache, so reading it again here is
  // free. Falls back to empty Map/array while the topology fetch is
  // in-flight or errored — the canvas just skips gate drawing in that
  // window.
  const gates = galaxy.status === 'ready' ? galaxy.world.gates : EMPTY_GATES;
  const sectorNames = useMemo<Map<number, string>>(() => {
    if (galaxy.status !== 'ready') return EMPTY_SECTOR_NAMES;
    return new Map(galaxy.world.sectors.map((s) => [s.id, s.name]));
  }, [galaxy]);
  // TargetsPanel needs the live ownShip + range constants to gate the
  // dock/jump menu items. ownSectorID already mirrors ownShip.sectorID
  // (or 0 when ownShip is null), so passing ownShip through directly is
  // sufficient — null when the player has no ship yet.
  const ownShipHere = ownShip ?? null;

  // Zoom toggle state lives in SectorView (not the canvas) so the panel
  // header chips can read it. Default 'max' shows the whole sector; Near
  // is auto-disabled while the player has no ship in this sector, and Radar
  // (TASK-122) additionally needs a class radar (radarRange>0 — a spacesuit
  // has none). We coerce the active mode back to 'max' when its precondition
  // is missing so the canvas's fallback path matches what the chip reflects.
  const [zoomMode, setZoomMode] = useState<ZoomMode>('max');
  const hasOwnShipHere = !riding && ownShip != null && ownShip.sectorID === ownSectorID;
  const hasRadar = hasOwnShipHere && (ownShip?.radarRange ?? 0) > 0;
  const effectiveMode: ZoomMode =
    zoomMode === 'near'
      ? hasOwnShipHere
        ? 'near'
        : 'max'
      : zoomMode === 'radar'
        ? hasRadar
          ? 'radar'
          : 'max'
        : 'max';

  // Hover-on-target highlight: TargetsPanel sets this on row mouse enter,
  // SectorCanvas paints the matching outline. State lives here (not in
  // either child) so the two siblings stay in sync.
  const [highlight, setHighlight] = useState<HighlightRef | null>(null);
  // Drop a stale highlight when the player jumps sectors: the world
  // coords inside the ref belong to the old sector and would paint a
  // phantom outline in the new viewport. The hl.sectorID guard in the
  // canvas covers it too, but clearing here also keeps the panel chip
  // honest.
  const safeHighlight = highlight && highlight.sectorID === ownSectorID ? highlight : null;

  // Selected target highlight: separate from hover, driven by
  // ownShip.currentTargetRef on the server. Maps the EntityRef to the
  // in-sector entity (ship or dockable static) and resolves its world
  // coords so SectorCanvas can paint the persistent orange outline and
  // TargetsPanel can mark the matching row. Returns null when the ref
  // doesn't resolve in this sector (handoff race, cross-sector approach
  // before jump) — the canvas/panel simply render nothing in that case.
  // ownShipAttackTargetID feeds the canvas context menu so it can render
  // "Прекратить огонь" instead of "Атаковать" when the player has already
  // opened fire on the picked ship. Resolves to undefined when the target
  // is not a ship (phase 4.2 only supports ship targets anyway).
  const ownShipAttackTargetID =
    ownShip?.attackTarget?.kind === EntityKind.Ship ? ownShip.attackTarget.id : undefined;
  // ownShipMiningTargetID feeds the canvas context menu so an asteroid's menu
  // renders «Прекратить добычу» instead of «Бурить» when the player is already
  // mining it (phase 10.3.21). A bare asteroid id (asteroids are not an
  // EntityKind), so no kind check unlike attack.
  const ownShipMiningTargetID = ownShip?.miningTarget;

  const selectedTargetRef = useMemo<SelectedTargetRef | null>(() => {
    const ref = ownShip?.currentTargetRef;
    if (!ref) return null;
    if (ref.kind === EntityKind.Ship) {
      const target = ships.get(ref.id);
      if (!target || target.sectorID !== ownSectorID) return null;
      return { kind: 'ship', id: ref.id };
    }
    const list =
      ref.kind === EntityKind.Station
        ? statics.stations
        : ref.kind === EntityKind.Shipyard
          ? statics.shipyards
          : ref.kind === EntityKind.TradeStation
            ? statics.tradeStations
            : ref.kind === EntityKind.Pirbase
              ? statics.pirbases
              : undefined;
    const hit = list?.find((s) => s.id === ref.id && s.sectorID === ownSectorID);
    if (!hit) return null;
    return { kind: 'dock', refKind: ref.kind, id: ref.id };
  }, [ownShip, ships, statics, ownSectorID]);

  // Count of ships visible in the current sector (after the AOI filter the
  // backend already applies). Used for the map header chip.
  let contactsHere = 0;
  for (const s of ships.values()) {
    if (s.sectorID === ownSectorID) contactsHere++;
  }

  // Narrow-viewport panel state (TASK-133). Below the 1024px breakpoint the ship
  // HUD, navigation and journal collapse into off-canvas panels driven by the
  // toolbar; above it the toolbar/scrim are display:none and the asides render
  // as ordinary grid columns, so this state has no visual effect there. A single
  // openPanel makes the three panels mutually exclusive — opening one closes any
  // other, so a side drawer and the journal sheet can never overlap.
  const [openPanel, setOpenPanel] = useState<'ship' | 'nav' | 'log' | null>(null);
  // Escape closes whichever panel is open (listener attached only while one is).
  useEffect(() => {
    if (openPanel === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPanel]);

  return (
    <div className="sw-sector-grid">
      <div className="sw-sector-toolbar" role="toolbar" aria-label="Панели HUD">
        <button
          type="button"
          className="sw-btn"
          data-active={openPanel === 'ship'}
          aria-pressed={openPanel === 'ship'}
          aria-label="Показать панель корабля"
          onClick={() => setOpenPanel((p) => (p === 'ship' ? null : 'ship'))}
        >
          Корабль
        </button>
        <button
          type="button"
          className="sw-btn"
          data-active={openPanel === 'nav'}
          aria-pressed={openPanel === 'nav'}
          aria-label="Показать панель навигации"
          onClick={() => setOpenPanel((p) => (p === 'nav' ? null : 'nav'))}
        >
          Навигация
        </button>
        <button
          type="button"
          className="sw-btn"
          data-active={openPanel === 'log'}
          aria-pressed={openPanel === 'log'}
          aria-label="Показать журнал событий"
          onClick={() => setOpenPanel((p) => (p === 'log' ? null : 'log'))}
        >
          Журнал
        </button>
      </div>
      <aside className={`sw-sector-grid__ship${openPanel === 'ship' ? ' is-open' : ''}`}>
        <PilotPanel
          ownShip={ownShip}
          ownCargo={ownCargo}
          races={races}
          riding={riding}
          onExit={refreshPlayer}
        />
        {!docked && ownShip && !riding && (
          <CombatHUD
            ownShip={ownShip}
            ships={ships}
            logins={logins}
            races={races}
            statics={statics}
            staticCombat={world.staticCombat}
            stationTypes={stationTypes}
            ownCargo={ownCargo}
            ownSectorID={ownSectorID}
            onCargoChanged={refreshPlayer}
          />
        )}
        {!docked && !riding && (
          <SetCoursePanel shipID={ownShipID} currentSectorID={ownSectorID} equipment={ownShip?.equipment} />
        )}
      </aside>
      <section className="sw-sector-grid__map">
        {shipPageOpen ? (
          <ShipDetailView onClose={closeShipPage} />
        ) : pilotPageOpen ? (
          <PilotPage onClose={closePilotPage} />
        ) : docked ? (
          <StationView />
        ) : (
          <div className="sw-panel sw-mapcard">
            <div className="sw-panel-head">
              <span className="title">Карта сектора</span>
              <div className="sw-row" style={{ gap: 6 }}>
                <ZoomToggle
                  mode={effectiveMode}
                  onChange={setZoomMode}
                  nearDisabled={!hasOwnShipHere}
                  radarDisabled={!hasRadar}
                />
                <span className="sw-chip dot good">SCAN 100%</span>
                <span className="sw-chip">{contactsHere} контактов</span>
              </div>
            </div>
            <div className="sw-mapcard__body">
              <SectorCanvas
                ships={ships}
                statics={statics}
                staticCombat={world.staticCombat}
                tickIntervalMs={world.tickIntervalMs}
                ownPlayerID={ownPlayerID}
                ownRace={ownShip?.race ?? 0}
                controlledShipID={controlShipID}
                currentSectorID={ownSectorID}
                logins={logins}
                zoomMode={effectiveMode}
                sectorBoundsRadius={world.sectorBoundsRadius}
                nearZoomRadius={world.nearZoomRadius}
                dockRange={world.dockRange}
                gateRange={world.gateRange}
                gates={gates}
                sectorNames={sectorNames}
                raceColors={raceColors}
                races={races}
                stationTypes={stationTypes}
                highlight={safeHighlight}
                selectedTarget={selectedTargetRef}
                laserEffects={world.laserEffects}
                missiles={world.missiles}
                missileImpacts={world.missileImpacts}
                drones={world.drones}
                droneImpacts={world.droneImpacts}
                torpedos={world.torpedos}
                torpedoImpacts={world.torpedoImpacts}
                containers={world.containers}
                asteroids={world.asteroids}
                goods={goods}
                ownShipAttackTargetID={ownShipAttackTargetID}
                ownShipMiningTargetID={ownShipMiningTargetID}
              />
              <div className="sw-corner tl" />
              <div className="sw-corner tr" />
              <div className="sw-corner bl" />
              <div className="sw-corner br" />
              <div className="sw-scan" />
            </div>
          </div>
        )}
      </section>
      <aside className={`sw-sector-grid__nav${openPanel === 'nav' ? ' is-open' : ''}`}>
        <TargetsPanel
          ships={ships}
          statics={statics}
          containers={world.containers}
          asteroids={world.asteroids}
          races={races}
          stationTypes={stationTypes}
          currentSectorID={ownSectorID}
          ownShipID={controlShipID}
          ownPlayerID={ownPlayerID}
          ownShip={riding ? null : ownShipHere}
          dockRange={world.dockRange}
          gateRange={world.gateRange}
          logins={logins}
          onHoverTarget={setHighlight}
          onFocusOwnShip={() => setZoomMode('near')}
          selectedTarget={selectedTargetRef}
        />
      </aside>
      <footer className={`sw-sector-grid__log${openPanel === 'log' ? ' is-open' : ''}`}>
        <EventLog tick={world.tick} connection={world.connection} ownShip={ownShip} contacts={contactsHere} />
      </footer>
      <div
        className={`sw-drawer-scrim${openPanel !== null ? ' is-open' : ''}`}
        aria-hidden="true"
        onClick={() => setOpenPanel(null)}
      />
    </div>
  );
}

function ZoomToggle({
  mode,
  onChange,
  nearDisabled,
  radarDisabled,
}: {
  mode: ZoomMode;
  onChange: (m: ZoomMode) => void;
  nearDisabled: boolean;
  radarDisabled: boolean;
}) {
  return (
    <div className="sw-row" style={{ gap: 4 }}>
      <button
        type="button"
        className={`sw-chip sw-zoom-chip dot${mode === 'max' ? ' active' : ''}`}
        onClick={() => onChange('max')}
      >
        Сектор
      </button>
      <button
        type="button"
        className={`sw-chip sw-zoom-chip dot${mode === 'near' ? ' active' : ''}`}
        onClick={() => onChange('near')}
        disabled={nearDisabled}
        style={nearDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        title={nearDisabled ? 'Нет корабля в этом секторе' : undefined}
      >
        Возле корабля
      </button>
      <button
        type="button"
        className={`sw-chip sw-zoom-chip dot${mode === 'radar' ? ' active' : ''}`}
        onClick={() => onChange('radar')}
        disabled={radarDisabled}
        style={radarDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        title={radarDisabled ? 'Нет корабля с радаром в этом секторе' : undefined}
      >
        По радару
      </button>
    </div>
  );
}
