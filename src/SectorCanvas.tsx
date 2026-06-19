import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityKind } from './api';
import type { Asteroid, Container, DestructibleStatic, Drone, DroneImpact, GoodsRow, LaserBeam, Missile, MissileImpact, Race, SectorStatics, StationType, WorldGate } from './api';
import type { TrackedShip } from './useWorldState';
import type { HighlightRef } from './TargetsPanel';
import {
  computeMaxBounds,
  fitSquareToCanvas,
  worldToCanvas as wToC,
  canvasToWorld as cToW,
  RADAR_BIG_MULTIPLIER,
  SATELLITE_REVEAL_RADIUS,
  type Viewport,
} from './sectorViewport';
import { CanvasContextMenu } from './CanvasContextMenu';
import type { PickedObject } from './ObjectActionsMenu';
import { SpacePointMenu } from './SpacePointMenu';
import { ObjectLayer, type ObjectLayerHandle } from './sector/ObjectLayer';

type LoginMap = Map<number, string>;

export type ZoomMode = 'max' | 'near';

// SelectedTargetRef identifies the entity the player explicitly told their
// ship to fly to (server-side ship.currentTargetRef). SectorView resolves
// the backend EntityRef into one of these two cases up front: 'ship' for
// ship-to-ship pursuit (we look up the live position every frame), 'dock' for
// stations/shipyards/trade-stations/pirbases (looked up in p.statics, since
// they don't move). refKind mirrors EntityKind so we can pick the right
// statics array. null tells the overlay there is nothing to highlight.
export type SelectedTargetRef =
  | { kind: 'ship'; id: number }
  | { kind: 'dock'; refKind: number; id: number };

type Props = {
  ships: Map<number, TrackedShip>;
  statics: SectorStatics;
  // staticCombat is the live HP/Shield of damaged/recharging statics, keyed
  // by `${kind}:${id}` (phase 6.2b). The overlay paints a shield bar over any
  // static present here whose shield is below max.
  staticCombat: Map<string, DestructibleStatic>;
  tickIntervalMs: number;
  ownPlayerID: number;
  // ownRace is the player's own ship faction (phase 10.13) — drives the
  // ally/neutral relation colouring of NPC ships of the same / other race.
  ownRace: number;
  controlledShipID: number;
  currentSectorID: number;
  logins: LoginMap;
  zoomMode: ZoomMode;
  // sectorBoundsRadius is the half-extent of the sector box (±5000 by
  // default). Used as fallback in Max-zoom on empty sectors and to draw
  // the boundary line in Near-zoom.
  sectorBoundsRadius: number;
  // nearZoomRadius is the half-side of the Near zoom square around the
  // player's own ship.
  nearZoomRadius: number;
  // dockRange / gateRange mirror the server-side validation radii. The
  // canvas-anchored context menu uses them to decide when Dock/Jump items
  // light up, matching the behaviour of TargetsPanel.
  dockRange: number;
  gateRange: number;
  // gates is the full topology array from useGalaxy(); the overlay filters per
  // `currentSectorID` and paints the glyph at the matching side's coords.
  gates: WorldGate[];
  // sectorNames maps WorldSector.id → name for the "→ Sector_name" gate label.
  sectorNames: Map<number, string>;
  // raceColors maps a race id → palette colour (js/map.js, via GET /api/races).
  // The overlay tints each dock/tower glyph by its owning race. Phase 8.13.
  raceColors: Map<number, string>;
  // races is the GET /api/races reference, forwarded to the overlay so a
  // clicked ship's context menu is titled by its race/model name instead of
  // the system __npc__ login (phase 10.16).
  races: Race[];
  // stationTypes is the GET /api/station-types catalog; the overlay titles a
  // clicked station / trade-station by its type name in the context menu.
  stationTypes: StationType[];
  // highlight is set by SectorView while the user hovers a row in the
  // TargetsPanel; the overlay paints an accent outline around the matching
  // entity. null when nothing is hovered.
  highlight?: HighlightRef | null;
  // selectedTarget is the persistent "current target" marker derived from the
  // own ship's currentTargetRef. Painted in --accent-target.
  selectedTarget?: SelectedTargetRef | null;
  // laserEffects carries the one-frame laser beams from the most recent
  // snapshot. The canvas draws each beam until the next snapshot replaces it.
  laserEffects?: LaserBeam[];
  // missiles is the in-flight projectile set within AOI. The overlay draws the
  // heads; the canvas draws their fading trails. Phase 4.3.
  missiles?: Map<number, Missile>;
  // missileImpacts holds one-frame hit/expire events drawn as a brief flash.
  missileImpacts?: MissileImpact[];
  // drones is the live combat-drone set within AOI (drawn on the overlay).
  // droneImpacts holds one-frame shot/death events (drawn on canvas).
  drones?: Map<number, Drone>;
  droneImpacts?: DroneImpact[];
  // containers is the live loot-container set within AOI (drawn on the
  // overlay, clickable for the "Подобрать" action). Phase 4.6.
  containers?: Map<number, Container>;
  // asteroids is the live minable ore-body set within AOI (drawn on the
  // overlay, clickable for the «Бурить» action). Phase 10.3.6.
  asteroids?: Map<number, Asteroid>;
  // goods is the GET /api/goods catalog, forwarded to the overlay so a picked
  // asteroid's menu reads its ore type by name instead of a raw id.
  goods: GoodsRow[];
  // ownShipAttackTargetID, when set, identifies the ship the player is
  // currently firing at — flips the context menu's Attack/Cease-fire item.
  ownShipAttackTargetID?: number;
  // ownShipMiningTargetID, when set, is the asteroid the player is mining —
  // flips the context menu's «Бурить»/«Прекратить добычу» item (phase 10.3.21).
  ownShipMiningTargetID?: number;
};

type MenuState = { target: PickedObject; px: number; py: number };
type SpaceMenuState = { px: number; py: number; wx: number; wy: number };

type HoverState = {
  shipID: number;
  login: string;
  canvasX: number;
  canvasY: number;
} | null;

// Explosion is a transient kill effect: an expanding orange→red ring that
// fades over EXPLOSION_MS. Spawned (in world coords) when a laser beam /
// missile / drone impact arrives with killed=true, animated in the rAF
// loop and pruned once aged out.
type Explosion = { x: number; y: number; startedAt: number };

const GRID_DIVS = 20;
const EXPLOSION_MS = 450;

export function SectorCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const objectLayerRef = useRef<ObjectLayerHandle | null>(null);
  const explosionsRef = useRef<Explosion[]>([]);
  const [hover, setHover] = useState<HoverState>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [spaceMenu, setSpaceMenu] = useState<SpaceMenuState | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Resize observer keeps the canvas in sync with its container so the map
  // fills its panel cell at any viewport. We render at devicePixelRatio for
  // sharp grid lines on Retina/scaled displays.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Latest props in a ref so the rAF loop closure reads fresh values.
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  });

  // Spawn a kill explosion for every killed combat effect in this snapshot.
  // The impact arrays are replaced wholesale each frame, so keying on their
  // identity fires once per snapshot. Positions are world coords.
  const { laserEffects, missileImpacts, droneImpacts } = props;
  useEffect(() => {
    const now = performance.now();
    for (const b of laserEffects ?? []) {
      if (b.killed) explosionsRef.current.push({ x: b.toX, y: b.toY, startedAt: now });
    }
    for (const m of missileImpacts ?? []) {
      if (m.killed) explosionsRef.current.push({ x: m.x, y: m.y, startedAt: now });
    }
    for (const d of droneImpacts ?? []) {
      if (d.killed) explosionsRef.current.push({ x: d.x, y: d.y, startedAt: now });
    }
  }, [laserEffects, missileImpacts, droneImpacts]);

  // Drop pending explosions on a sector jump — their world coords belong to
  // the old sector and would flash at the wrong spot in the new view.
  const currentSectorID = props.currentSectorID;
  useEffect(() => {
    explosionsRef.current = [];
  }, [currentSectorID]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const draw = () => {
      const p = propsRef.current;
      const s = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = s.width;
      const h = s.height;
      if (w === 0 || h === 0) {
        frame = requestAnimationFrame(draw);
        return;
      }
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Single source of the frame: one viewport drives both the canvas
      // (background / grid / boundary / effects) and the SVG ObjectLayer
      // (ships / statics / gates / projectiles), so the two never desync.
      const vp = computeViewport(p, w, h);

      drawBackground(ctx, w, h);
      drawGrid(ctx, w, h);
      drawSectorBoundary(ctx, vp, w, h, p);
      drawRadarRing(ctx, vp, w, h, p);
      drawSatelliteCoverage(ctx, vp, w, h, p);
      drawLaserBeams(ctx, vp, w, h, p);
      drawMissileTrails(ctx, vp, w, h, p);
      drawMissileImpacts(ctx, vp, w, h, p);
      drawDroneImpacts(ctx, vp, w, h, p);
      drawExplosions(ctx, vp, w, h, explosionsRef.current);
      drawScaleBar(ctx, vp, w, h);

      objectLayerRef.current?.update(vp, w, h);

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Hide the canvas-anchored menu when the picked object disappears (handoff,
  // kill, undock) so we don't keep a phantom popover over empty space.
  const visibleMenu = useMemo<MenuState | null>(() => {
    if (!menu) return null;
    if (menu.target.kind === 'ship') {
      const ship = props.ships.get(menu.target.id);
      if (!ship || ship.sectorID !== props.currentSectorID) return null;
      return menu;
    }
    if (menu.target.kind === 'dock') {
      const ref = menu.target.ref;
      const list =
        ref.kind === EntityKind.Station
          ? props.statics.stations
          : ref.kind === EntityKind.Shipyard
            ? props.statics.shipyards
            : ref.kind === EntityKind.TradeStation
              ? props.statics.tradeStations
              : ref.kind === EntityKind.Pirbase
                ? props.statics.pirbases
                : undefined;
      const found = list?.some(
        (s) => s.id === ref.id && s.sectorID === props.currentSectorID,
      );
      return found ? menu : null;
    }
    if (menu.target.kind === 'container') {
      return props.containers?.has(menu.target.id) ? menu : null;
    }
    if (menu.target.kind === 'asteroid') {
      return props.asteroids?.has(menu.target.id) ? menu : null;
    }
    return menu;
  }, [menu, props.ships, props.statics, props.currentSectorID, props.containers, props.asteroids]);

  // Empty-space click → "fly here" menu. Object clicks are caught by the SVG
  // overlay's per-node hit areas (onPickObject) and never reach the canvas,
  // so this handler only sees clicks into empty space.
  const onClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const s = sizeRef.current;
    const vp = computeViewport(propsRef.current, s.width, s.height);
    const [wx, wy] = cToW(px, py, vp, s.width, s.height);
    setMenu(null);
    setSpaceMenu({ px, py, wx, wy });
  };

  const onPickObject = (picked: PickedObject, px: number, py: number) => {
    setSpaceMenu(null);
    setMenu({ target: picked, px, py });
  };

  const onHoverObject = (h: { shipID: number; login: string; x: number; y: number } | null) => {
    if (h === null) {
      setHover(null);
      return;
    }
    setHover({ shipID: h.shipID, login: h.login, canvasX: h.x, canvasY: h.y });
  };

  const tooltipStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!hover) return undefined;
    return {
      position: 'absolute',
      left: hover.canvasX + 12,
      top: hover.canvasY + 12,
      background: 'rgba(7, 16, 28, 0.92)',
      border: '1px solid var(--line-strong)',
      color: 'var(--accent-hot)',
      padding: '2px 6px',
      fontSize: 10,
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.06em',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    };
  }, [hover]);

  const ownShipNow = findOwnShip(props);
  const ownShipPos = ownShipNow ? { x: ownShipNow.x, y: ownShipNow.y } : null;
  // Gate the launch items on the controlled ship's own fit (phase 10.3.2):
  // the command runs on controlledShipID, so its equipment must decide the
  // affordance — not findOwnShip's first-in-sector pick.
  const ownEquipment = props.ships.get(props.controlledShipID)?.equipment;
  // up_ore_scanner (phase 10.3.19) reveals an asteroid's ore type + yield; the
  // controlled ship's fit decides it, like the launch/mine affordance gates.
  const hasOreScanner = !!ownEquipment?.some((e) => e.type === 'up_ore_scanner');

  return (
    <div ref={wrapRef} className="sw-map-wrap">
      <canvas
        ref={canvasRef}
        className="sw-map-canvas"
        style={{ width: '100%', height: '100%' }}
        onClick={onClick}
      />
      <ObjectLayer
        ref={objectLayerRef}
        ships={props.ships}
        drones={props.drones}
        missiles={props.missiles}
        containers={props.containers}
        asteroids={props.asteroids}
        goods={props.goods}
        hasOreScanner={hasOreScanner}
        statics={props.statics}
        staticCombat={props.staticCombat}
        gates={props.gates}
        sectorNames={props.sectorNames}
        raceColors={props.raceColors}
        races={props.races}
        stationTypes={props.stationTypes}
        currentSectorID={props.currentSectorID}
        ownPlayerID={props.ownPlayerID}
        ownRace={props.ownRace}
        tickIntervalMs={props.tickIntervalMs}
        width={size.width}
        height={size.height}
        logins={props.logins}
        selectedTarget={props.selectedTarget}
        highlight={props.highlight}
        onPick={onPickObject}
        onHover={onHoverObject}
      />
      {hover && <div style={tooltipStyle}>{hover.login}</div>}
      {visibleMenu && (
        <CanvasContextMenu
          target={visibleMenu.target}
          ownShipID={props.controlledShipID}
          ownShip={ownShipPos}
          ownShipAttackTargetID={props.ownShipAttackTargetID}
          ownShipMiningTargetID={props.ownShipMiningTargetID}
          ownEquipment={ownEquipment}
          dockRange={props.dockRange}
          gateRange={props.gateRange}
          px={visibleMenu.px}
          py={visibleMenu.py}
          onClose={() => setMenu(null)}
        />
      )}
      {spaceMenu && (
        <SpacePointMenu
          px={spaceMenu.px}
          py={spaceMenu.py}
          wx={spaceMenu.wx}
          wy={spaceMenu.wy}
          shipID={props.controlledShipID}
          onClose={() => setSpaceMenu(null)}
        />
      )}
    </div>
  );
}

// computeViewport resolves the world rectangle to draw based on the current
// zoom mode. In Near mode the camera follows the interpolated position of the
// player's own ship; falls back to Max when the player has no ship here.
function computeViewport(p: Props, canvasWidth: number, canvasHeight: number): Viewport {
  if (p.zoomMode === 'near') {
    const own = findOwnShip(p);
    if (own) {
      const now = performance.now();
      const t = Math.min(1, Math.max(0, (now - own.prevAt) / p.tickIntervalMs));
      const wx = own.prevX + (own.x - own.prevX) * t;
      const wy = own.prevY + (own.y - own.prevY) * t;
      const { halfX, halfY } = fitSquareToCanvas(p.nearZoomRadius, canvasWidth, canvasHeight);
      return { centerX: wx, centerY: wy, halfX, halfY };
    }
  }
  const bb = computeMaxBounds(p.statics, p.gates, p.currentSectorID, p.sectorBoundsRadius);
  const { halfX, halfY } = fitSquareToCanvas(bb.halfSide, canvasWidth, canvasHeight);
  return { centerX: bb.centerX, centerY: bb.centerY, halfX, halfY };
}

function findOwnShip(p: Props): TrackedShip | null {
  for (const s of p.ships.values()) {
    if (s.playerID === p.ownPlayerID && s.sectorID === p.currentSectorID) {
      return s;
    }
  }
  return null;
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#04070d';
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
  grad.addColorStop(0, 'rgba(91, 206, 250, 0.05)');
  grad.addColorStop(1, 'rgba(91, 206, 250, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const stepX = w / GRID_DIVS;
  const stepY = h / GRID_DIVS;
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_DIVS; i++) {
    const x = i * stepX;
    const y = i * stepY;
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(91, 206, 250, 0.14)' : 'rgba(91, 206, 250, 0.06)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(91, 206, 250, 0.25)';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 12, h / 2);
  ctx.lineTo(w / 2 + 12, h / 2);
  ctx.moveTo(w / 2, h / 2 - 12);
  ctx.lineTo(w / 2, h / 2 + 12);
  ctx.stroke();
}

// SCALE_BAR_UNITS is the fixed world length the scale bar represents. Its
// on-screen pixel length shrinks as the player zooms out.
const SCALE_BAR_UNITS = 50;
// SCALE_BAR_BOTTOM lifts the bar above the bottom-left HUD corner bracket.
const SCALE_BAR_BOTTOM = 34;

function drawScaleBar(ctx: CanvasRenderingContext2D, vp: Viewport, w: number, h: number) {
  const segPx = (SCALE_BAR_UNITS / (2 * vp.halfX)) * w;
  const colour = 'rgba(91, 206, 250, 0.55)';
  const x0 = 10;
  const baseY = h - SCALE_BAR_BOTTOM;
  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.font = '9px var(--font-mono, monospace)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const prefix = 'Масштаб:';
  ctx.fillText(prefix, x0, baseY);
  const barX0 = x0 + ctx.measureText(prefix).width + 6;

  ctx.beginPath();
  ctx.moveTo(barX0, baseY);
  ctx.lineTo(barX0 + segPx, baseY);
  ctx.moveTo(barX0, baseY - 3);
  ctx.lineTo(barX0, baseY + 3);
  ctx.moveTo(barX0 + segPx, baseY - 3);
  ctx.lineTo(barX0 + segPx, baseY + 3);
  ctx.stroke();

  ctx.fillText(`= ${SCALE_BAR_UNITS} unit`, barX0 + segPx + 6, baseY);
  ctx.restore();
}

// drawSectorBoundary renders the ±sectorBoundsRadius rectangle (world coords)
// so the player can see the sector edge when the Near zoom brings the camera
// close to it. Only drawn in Near mode.
function drawSectorBoundary(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: number,
  h: number,
  p: Props,
) {
  if (p.zoomMode !== 'near') return;
  const r = p.sectorBoundsRadius;
  const [tlx, tly] = wToC(-r, -r, vp, w, h);
  const [brx, bry] = wToC(r, r, vp, w, h);
  ctx.save();
  ctx.strokeStyle = 'var(--line-strong, rgba(91, 206, 250, 0.6))';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(tlx, tly, brx - tlx, bry - tly);
  ctx.restore();
}

// drawRadarRing paints the player's personal small-radar radius (phase 10.20)
// as a soft dashed ring concentric with their own ship — the visible edge of
// what the AOI subscription delivers. Drawn in every zoom mode (the full ring
// reads best in the sector overview, and an arc still hints the edge when
// followed in). Skipped for ships with no class radar (legacy/spacesuit, where
// the server used the AOI fallback). The centre is interpolated between
// snapshots to match the moving ship glyph.
function drawRadarRing(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: number,
  h: number,
  p: Props,
) {
  const own = findOwnShip(p);
  if (!own || !own.radarRange || own.radarRange <= 0) return;
  const now = performance.now();
  const t = Math.min(1, Math.max(0, (now - own.prevAt) / p.tickIntervalMs));
  const cx = own.prevX + (own.x - own.prevX) * t;
  const cy = own.prevY + (own.y - own.prevY) * t;
  const [centerX, centerY] = wToC(cx, cy, vp, w, h);
  const [edgeX] = wToC(cx + own.radarRange, cy, vp, w, h);
  const pr = Math.abs(edgeX - centerX);
  if (pr <= 1) return;
  ctx.save();
  // Small radar — ships/missiles/drones/containers edge.
  ctx.strokeStyle = 'rgba(91, 206, 250, 0.4)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.arc(centerX, centerY, pr, 0, Math.PI * 2);
  ctx.stroke();
  // Big-object radar — stations/shipyards/TS/pirbases/towers/gates edge (L2).
  const [bigEdgeX] = wToC(cx + own.radarRange * RADAR_BIG_MULTIPLIER, cy, vp, w, h);
  const bpr = Math.abs(bigEdgeX - centerX);
  if (bpr > pr + 1) {
    ctx.strokeStyle = 'rgba(91, 206, 250, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 10]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, bpr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// drawSatelliteCoverage paints a soft violet ring at the satellite's true
// radar-reveal radius around each of the player's own live navigation
// satellites (phase 10.20 L5) — the area it lights up for its owner and allies.
// Satellites are static, so the centre is their reported position (no
// interpolation). Other players' satellites are not ringed (they reveal to
// their own owner, not to us). The reveal radius is ≈2× the sector half-extent,
// so at the sector-fit zoom the ring sits off-canvas — by design: it is the
// literal coverage reach, not a clamped overview cue.
function drawSatelliteCoverage(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: number,
  h: number,
  p: Props,
) {
  const sats = p.statics.satellites;
  if (!sats || sats.length === 0) return;
  const ringWorld = SATELLITE_REVEAL_RADIUS;
  ctx.save();
  // Violet at 30% — mirrors the satellite glyph's --violet tint; soft enough
  // not to fight the cyan radar rings, dense dash so the faint ring still reads.
  ctx.strokeStyle = 'rgba(168, 138, 232, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  for (const sat of sats) {
    if (!sat.built || sat.ownerID !== p.ownPlayerID) continue;
    const [centerX, centerY] = wToC(sat.x, sat.y, vp, w, h);
    const [edgeX] = wToC(sat.x + ringWorld, sat.y, vp, w, h);
    const pr = Math.abs(edgeX - centerX);
    if (pr <= 1) continue;
    ctx.beginPath();
    ctx.arc(centerX, centerY, pr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// drawLaserBeams paints the one-frame laser shots from the latest snapshot.
// Each beam is a short orange line; killed shots flash red. The next snapshot
// replaces (or empties) the slice.
function drawLaserBeams(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: number,
  h: number,
  p: Props,
) {
  if (!p.laserEffects || p.laserEffects.length === 0) return;
  ctx.save();
  ctx.lineWidth = 2;
  for (const beam of p.laserEffects) {
    const [fx, fy] = wToC(beam.fromX, beam.fromY, vp, w, h);
    const [tx, ty] = wToC(beam.toX, beam.toY, vp, w, h);
    ctx.strokeStyle = beam.killed ? '#ff5648' : '#ffa53c';
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  ctx.restore();
}

// drawMissileTrails paints the fading trail behind each in-flight missile. The
// missile head itself is rendered on the SVG overlay (phase 10.13); the trail
// stays on the canvas as an ephemeral effect.
function drawMissileTrails(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: number,
  h: number,
  p: Props,
) {
  const missiles = p.missiles;
  if (!missiles || missiles.size === 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(241, 88, 178, 0.55)';
  ctx.lineWidth = 1.5;
  const trailLen = 14;
  for (const m of missiles.values()) {
    const [cx, cy] = wToC(m.x, m.y, vp, w, h);
    if (cx < -20 || cx > w + 20 || cy < -20 || cy > h + 20) continue;
    const [tx, ty] = wToC(m.x - m.dirX * trailLen, m.y - m.dirY * trailLen, vp, w, h);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(cx, cy);
    ctx.stroke();
  }
  ctx.restore();
}

// drawMissileImpacts renders one-frame events: a short flash at the impact.
// Real hits use magenta + red/amber core; pure expires get a softer grey ring.
function drawMissileImpacts(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: number,
  h: number,
  p: Props,
) {
  const imps = p.missileImpacts;
  if (!imps || imps.length === 0) return;
  ctx.save();
  for (const imp of imps) {
    const [cx, cy] = wToC(imp.x, imp.y, vp, w, h);
    if (cx < -30 || cx > w + 30 || cy < -30 || cy > h + 30) continue;
    if (imp.expired) {
      ctx.strokeStyle = 'rgba(150, 150, 160, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#f158b2';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = imp.killed ? '#ff5648' : '#ffa53c';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// drawDroneImpacts renders one-frame drone events: a small cyan flash for a
// shot, a softer grey ring for a self-destruct (TTL / owner loss).
function drawDroneImpacts(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: number,
  h: number,
  p: Props,
) {
  const imps = p.droneImpacts;
  if (!imps || imps.length === 0) return;
  ctx.save();
  for (const imp of imps) {
    const [cx, cy] = wToC(imp.x, imp.y, vp, w, h);
    if (cx < -30 || cx > w + 30 || cy < -30 || cy > h + 30) continue;
    if (imp.expired) {
      ctx.strokeStyle = 'rgba(150, 150, 160, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = imp.killed ? '#ff5648' : '#3cd7e0';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// drawExplosions animates the transient kill rings. It prunes aged-out entries
// in place, then draws each as an expanding orange→red ring with a bright core
// early in its life. age is normalised to [0,1] over EXPLOSION_MS.
function drawExplosions(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: number,
  h: number,
  explosions: Explosion[],
) {
  const now = performance.now();
  for (let i = explosions.length - 1; i >= 0; i--) {
    if (now - explosions[i].startedAt > EXPLOSION_MS) explosions.splice(i, 1);
  }
  if (explosions.length === 0) return;
  ctx.save();
  for (const e of explosions) {
    const age = (now - e.startedAt) / EXPLOSION_MS;
    const [cx, cy] = wToC(e.x, e.y, vp, w, h);
    if (cx < -40 || cx > w + 40 || cy < -40 || cy > h + 40) continue;
    const radius = 6 + age * 22;
    const alpha = 1 - age;
    ctx.lineWidth = 2.5 * (1 - age) + 0.5;
    ctx.strokeStyle = `rgba(255, ${Math.round(150 * (1 - age))}, 60, ${alpha})`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (age < 0.4) {
      ctx.fillStyle = `rgba(255, 220, 150, ${(0.4 - age) / 0.4})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
