// SVG object overlay for the sector map (phase 10.13).
//
// React owns the node lifecycle (one <g> per object, keyed by id, with its
// silhouette + relation colour); a single rAF in SectorCanvas drives the
// per-frame transforms through `update(vp, w, h)` via the imperative handle —
// no React re-render per frame. The overlay <svg> is pointer-events:none so
// empty-space clicks fall through to the canvas underneath (course plotting);
// each object's hit-circle is pointer-events:auto so clicks/hover land on the
// node directly (no manual hit-test).

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { EntityKind } from '../api';
import type { Asteroid, Container, DestructibleStatic, Drone, GoodsRow, Missile, Race, SectorStatics, StationType, Torpedo, WorldGate } from '../api';
import type { TrackedShip } from '../useWorldState';
import type { HighlightRef } from '../TargetsPanel';
import type { PickedObject } from '../ObjectActionsMenu';
import type { SelectedTargetRef } from '../SectorCanvas';
import { goodsName, shipDisplayName, staticTypeLabel, stationLetter, stationTypeName } from '../gameContext';
import { worldToCanvas as wToC, type Viewport } from '../sectorViewport';
import {
  ShapeDefs,
  StationGlyph,
  ShipyardGlyph,
  TradeStationGlyph,
  PirbaseGlyph,
  GateGlyph,
  LaserTowerGlyph,
  SatelliteGlyph,
  ContainerGlyph,
  AsteroidGlyph,
  SpacesuitGlyph,
} from './shapes';
import { HIT_R, categoryForShip, relationColor, shipRelation } from './shapeData';

const RAD = 180 / Math.PI;
// Velocity-vector length clamp (px) and the floor below which it is hidden.
const VEC_MAX = 24;
const VEC_MIN = 2;

export type ObjectLayerHandle = { update: (vp: Viewport, w: number, h: number) => void };

type HoverInfo = { shipID: number; login: string; x: number; y: number };

type Props = {
  ships: Map<number, TrackedShip>;
  drones?: Map<number, Drone>;
  missiles?: Map<number, Missile>;
  // torpedos is the live torpedo set within AOI (heads drawn here; trails +
  // splash on the canvas). Phase 10.3.5.
  torpedos?: Map<number, Torpedo>;
  containers?: Map<number, Container>;
  // asteroids is the live minable ore-body set within AOI (drawn on the
  // overlay, clickable for the «Бурить» action). Phase 10.3.6.
  asteroids?: Map<number, Asteroid>;
  // goods is the GET /api/goods catalog, forwarded so a picked asteroid's menu
  // reads its ore type by name (goodsName) instead of a raw ore_type id.
  goods: GoodsRow[];
  // hasOreScanner gates the asteroid ore-type/yield reveal (phase 10.3.19,
  // up_ore_scanner): with the module the label reads «<руда> · <масса>», without
  // it the body is coarsened to a bare «Астероид». Affordance gate (the data is
  // still on the wire), mirroring up_drill/up_launcher.
  hasOreScanner?: boolean;
  statics: SectorStatics;
  staticCombat: Map<string, DestructibleStatic>;
  gates: WorldGate[];
  sectorNames: Map<number, string>;
  raceColors: Map<number, string>;
  // races is the GET /api/races reference; ship context-menu titles are built
  // via shipDisplayName(ship, races) so an NPC reads its race/model name
  // instead of the system __npc__ login (phase 10.16).
  races: Race[];
  stationTypes: StationType[];
  currentSectorID: number;
  ownPlayerID: number;
  // controlShipID is the ship the player is actively controlling. It is lifted
  // out of the main ship group and drawn LAST in the DOM so it always sits on
  // top of every other object of the layer (TASK-118 FR-1). 0 while riding /
  // before spawn — then no ship is lifted.
  controlShipID: number;
  ownRace: number;
  tickIntervalMs: number;
  width: number;
  height: number;
  logins: Map<number, string>;
  selectedTarget?: SelectedTargetRef | null;
  highlight?: HighlightRef | null;
  onPick: (picked: PickedObject, px: number, py: number) => void;
  onHover: (h: HoverInfo | null) => void;
};

type ShipNode = { g: SVGGElement; heading: SVGGElement; vel: SVGGElement; line: SVGLineElement; head: SVGPathElement };
type DirNode = { g: SVGGElement; heading: SVGGElement };

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// cardinal labels a gate by the sector edge it sits on (screen-up = -Y = N),
// echoing the original StarWind directional gates. The destination sector name
// stays in the label below; this is the quick at-a-glance "which way out".
function cardinal(x: number, y: number): string {
  if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? 'E' : 'W';
  return y >= 0 ? 'S' : 'N';
}

// interpAngle interpolates between two angles along the shortest arc so a wrap
// (-π → π) doesn't spin the hull a full turn on one tick. Same logic the
// canvas used before the SVG move.
function interpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

export const ObjectLayer = forwardRef<ObjectLayerHandle, Props>(function ObjectLayer(props, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const shipNodes = useRef(new Map<number, ShipNode>());
  const dirNodes = useRef(new Map<string, DirNode>());
  const simpleNodes = useRef(new Map<string, SVGGElement>());
  const selectedRef = useRef<SVGGElement | null>(null);
  const highlightRef = useRef<SVGGElement | null>(null);

  // Latest props for the rAF closure (update reads fresh data without
  // re-binding the handle every render).
  const dataRef = useRef(props);
  useEffect(() => {
    dataRef.current = props;
  });

  const evXY = (clientX: number, clientY: number): [number, number] => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [clientX - rect.left, clientY - rect.top];
  };

  useImperativeHandle(ref, (): ObjectLayerHandle => ({
    update(vp, w, h) {
      const p = dataRef.current;
      const now = performance.now();

      // Ships — interpolated position, heading rotation, velocity vector.
      for (const s of p.ships.values()) {
        if (s.sectorID !== p.currentSectorID) continue;
        const node = shipNodes.current.get(s.id);
        if (!node) continue;
        const t = clamp01((now - s.prevAt) / p.tickIntervalMs);
        const wx = s.prevX + (s.x - s.prevX) * t;
        const wy = s.prevY + (s.y - s.prevY) * t;
        const [cx, cy] = wToC(wx, wy, vp, w, h);
        node.g.setAttribute('transform', `translate(${cx} ${cy})`);
        const facing = interpAngle(
          Math.atan2(s.prevDirectionY, s.prevDirectionX),
          Math.atan2(s.directionY, s.directionX),
          t,
        );
        node.heading.setAttribute('transform', `rotate(${(facing + Math.PI / 2) * RAD})`);
        const speed = Math.hypot(s.vx, s.vy);
        const frac = s.maxSpeed > 0 ? speed / s.maxSpeed : 0;
        const len = Math.min(VEC_MAX, frac * VEC_MAX);
        if (len < VEC_MIN) {
          node.vel.style.visibility = 'hidden';
        } else {
          node.vel.style.visibility = 'visible';
          const vang = Math.atan2(s.vy, s.vx);
          node.vel.setAttribute('transform', `rotate(${(vang + Math.PI / 2) * RAD})`);
          node.line.setAttribute('y2', String(-len));
          node.head.setAttribute('transform', `translate(0 ${-len})`);
        }
      }

      // Drones / missiles — raw position (server publishes every tick), heading.
      const placeDir = (key: string, x: number, y: number, dirX: number, dirY: number) => {
        const node = dirNodes.current.get(key);
        if (!node) return;
        const [cx, cy] = wToC(x, y, vp, w, h);
        node.g.setAttribute('transform', `translate(${cx} ${cy})`);
        node.heading.setAttribute('transform', `rotate(${(Math.atan2(dirY, dirX) + Math.PI / 2) * RAD})`);
      };
      for (const d of p.drones?.values() ?? []) placeDir(`drone:${d.id}`, d.x, d.y, d.dirX, d.dirY);
      for (const m of p.missiles?.values() ?? []) placeDir(`missile:${m.id}`, m.x, m.y, m.dirX, m.dirY);
      for (const t of p.torpedos?.values() ?? []) placeDir(`torpedo:${t.id}`, t.x, t.y, t.dirX, t.dirY);

      // Static positions (statics / gates / containers) — translate only.
      const place = (key: string, x: number, y: number) => {
        const node = simpleNodes.current.get(key);
        if (!node) return;
        const [cx, cy] = wToC(x, y, vp, w, h);
        node.setAttribute('transform', `translate(${cx} ${cy})`);
      };
      const sid = p.currentSectorID;
      for (const s of p.statics.stations ?? []) if (s.sectorID === sid) place(`2:${s.id}`, s.x, s.y);
      for (const s of p.statics.shipyards ?? []) if (s.sectorID === sid) place(`3:${s.id}`, s.x, s.y);
      for (const s of p.statics.tradeStations ?? []) if (s.sectorID === sid) place(`4:${s.id}`, s.x, s.y);
      for (const s of p.statics.pirbases ?? []) if (s.sectorID === sid) place(`5:${s.id}`, s.x, s.y);
      for (const s of p.statics.laserTowers ?? []) if (s.sectorID === sid) place(`7:${s.id}`, s.x, s.y);
      for (const s of p.statics.satellites ?? []) if (s.sectorID === sid) place(`11:${s.id}`, s.x, s.y);
      // Gates are always visible regardless of radar distance (TASK-117) — just
      // position them. Laser towers and satellites are now radar-gated on the
      // server, so it stops sending them out of range (no client fade needed).
      for (const g of p.gates) {
        const inA = g.sectorA === sid;
        if (!inA && g.sectorB !== sid) continue;
        const gx = inA ? g.posAX : g.posBX;
        const gy = inA ? g.posAY : g.posBY;
        place(`gate:${g.id}`, gx, gy);
      }
      for (const c of p.containers?.values() ?? []) place(`container:${c.id}`, c.x, c.y);
      for (const a of p.asteroids?.values() ?? []) place(`asteroid:${a.id}`, a.x, a.y);

      // Selected-target and hover-highlight rings — resolve live position.
      positionMarker(selectedRef.current, resolveSelected(p), vp, w, h, now, p.tickIntervalMs);
      positionMarker(highlightRef.current, resolveHighlight(p), vp, w, h, now, p.tickIntervalMs);
    },
  }), []);

  const p = props;
  const sid = p.currentSectorID;
  const shipList = [...p.ships.values()].filter((s) => s.sectorID === sid);
  const gatesHere = p.gates.filter((g) => g.sectorA === sid || g.sectorB === sid);
  // The controlled ship is lifted out of the main group and drawn last so it
  // sits on top of every object (TASK-118 FR-1). It still registers in
  // shipNodes by id, so the rAF update() positions it exactly like the rest.
  const controlledShip = p.controlShipID ? shipList.find((s) => s.id === p.controlShipID) : undefined;

  // renderShip builds one ship <g> (hit-circle + shield arc +
  // velocity vector + hull). Shared by the main ship group and the lifted
  // controlled-ship node so both render identically (only the DOM position
  // differs, which decides z-order).
  const renderShip = (s: TrackedShip) => {
    const cat = categoryForShip(s);
    const rel = shipRelation(s, p.ownPlayerID, p.ownRace);
    const colour = relationColor(rel);
    const own = s.playerID === p.ownPlayerID;
    const login = own ? 'свой' : (p.logins.get(s.playerID) ?? `#${s.playerID}`);
    // Context-menu title: name (10.6) · owner. The owner suffix is shown
    // only for player ships (own → «свой», others → login); NPC ships
    // (the system __npc__ owner) drop it since the name already carries
    // the race/model (mirrors TargetsPanel, phase 10.7/10.16).
    const name = shipDisplayName(s, p.races);
    const ownerLogin = own ? 'свой' : p.logins.get(s.playerID);
    const owner = ownerLogin && ownerLogin !== '__npc__' ? ownerLogin : '';
    const menuLabel = owner ? `${name} · ${owner}` : name;
    const hasShield = (s.maxShield ?? 0) > 0 && s.shield < s.maxShield;
    return (
      <g key={`ship-${s.id}`} ref={shipRef(shipNodes, s.id)} style={{ color: colour }}>
        <circle
          className="hit"
          r={HIT_R}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={(e) => p.onPick({ kind: 'ship', id: s.id, x: s.x, y: s.y, label: menuLabel, relation: rel }, ...evXY(e.clientX, e.clientY))}
          onMouseEnter={(e) => { const [px, py] = evXY(e.clientX, e.clientY); p.onHover({ shipID: s.id, login, x: px, y: py }); }}
          onMouseLeave={() => p.onHover(null)}
        />
        {hasShield && (
          <path d="M-7,-13 A 7 7 0 0 1 7,-13" fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={0.85} pointerEvents="none" />
        )}
        <g className="vel" pointerEvents="none" style={{ visibility: 'hidden' }}>
          <line className="vel-line" x1={0} y1={0} x2={0} y2={-1} stroke="currentColor" strokeWidth={1.4} strokeOpacity={0.6} strokeDasharray="2.6 2.2" />
          <path className="vel-head" d="M0,0 L2.2,4 L-2.2,4 Z" fill="currentColor" fillOpacity={0.7} transform="translate(0 0)" />
        </g>
        <g className="heading" pointerEvents="none">
          {s.isSpacesuit ? <SpacesuitGlyph /> : <use href={`#hull-${cat}`} />}
        </g>
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      className="sw-object-layer"
      width={p.width}
      height={p.height}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}
      aria-hidden
    >
      <ShapeDefs />

      {/* Statics (z-bottom) */}
      {(p.statics.stations ?? []).filter((s) => s.sectorID === sid).map((s) => {
        const tint = raceTint(p, s.race, 'var(--cyan)');
        const letter = stationLetter(stationTypeName(p.stationTypes, s.type));
        const combat = p.staticCombat.get(`${EntityKind.Station}:${s.id}`);
        return (
          <g key={`station-${s.id}`} ref={simpleRef(simpleNodes, `2:${s.id}`)}>
            <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => p.onPick(dockPick(EntityKind.Station, s.id, s.x, s.y, s.type, p.stationTypes), ...evXY(e.clientX, e.clientY))} />
            <StationGlyph color={tint} letter={letter} />
            {shieldBar(combat)}
          </g>
        );
      })}
      {(p.statics.shipyards ?? []).filter((s) => s.sectorID === sid).map((s) => {
        const tint = raceTint(p, s.race, 'var(--amber)');
        const combat = p.staticCombat.get(`${EntityKind.Shipyard}:${s.id}`);
        return (
          <g key={`shipyard-${s.id}`} ref={simpleRef(simpleNodes, `3:${s.id}`)}>
            <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => p.onPick(dockPick(EntityKind.Shipyard, s.id, s.x, s.y, undefined, p.stationTypes), ...evXY(e.clientX, e.clientY))} />
            <ShipyardGlyph color={tint} />
            {shieldBar(combat)}
          </g>
        );
      })}
      {(p.statics.tradeStations ?? []).filter((s) => s.sectorID === sid).map((s) => {
        const tint = raceTint(p, s.race, 'var(--good)');
        const combat = p.staticCombat.get(`${EntityKind.TradeStation}:${s.id}`);
        return (
          <g key={`ts-${s.id}`} ref={simpleRef(simpleNodes, `4:${s.id}`)}>
            <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => p.onPick(dockPick(EntityKind.TradeStation, s.id, s.x, s.y, s.type, p.stationTypes), ...evXY(e.clientX, e.clientY))} />
            <TradeStationGlyph color={tint} />
            {shieldBar(combat)}
          </g>
        );
      })}
      {(p.statics.pirbases ?? []).filter((s) => s.sectorID === sid).map((s) => {
        const tint = raceTint(p, s.race, 'var(--danger)');
        const combat = p.staticCombat.get(`${EntityKind.Pirbase}:${s.id}`);
        return (
          <g key={`pb-${s.id}`} ref={simpleRef(simpleNodes, `5:${s.id}`)}>
            <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => p.onPick(dockPick(EntityKind.Pirbase, s.id, s.x, s.y, undefined, p.stationTypes), ...evXY(e.clientX, e.clientY))} />
            <PirbaseGlyph color={tint} />
            {shieldBar(combat)}
          </g>
        );
      })}
      {(p.statics.laserTowers ?? []).filter((s) => s.sectorID === sid).map((s) => {
        const tint = raceTint(p, s.race, 'var(--danger)');
        const combat = p.staticCombat.get(`${EntityKind.LaserTower}:${s.id}`);
        return (
          <g key={`lt-${s.id}`} ref={simpleRef(simpleNodes, `7:${s.id}`)}>
            {/* TASK-113 D3: a laser tower is a weapon target — make its glyph
                pickable (a dock-pick whose ref the weapon buttons consume). */}
            <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => p.onPick(dockPick(EntityKind.LaserTower, s.id, s.x, s.y, undefined, p.stationTypes), ...evXY(e.clientX, e.clientY))} />
            <LaserTowerGlyph color={tint} />
            {shieldBar(combat)}
          </g>
        );
      })}
      {(p.statics.satellites ?? []).filter((s) => s.sectorID === sid).map((s) => {
        const tint = raceTint(p, s.race, 'var(--violet)');
        const combat = p.staticCombat.get(`${EntityKind.Satellite}:${s.id}`);
        return (
          <g key={`sat-${s.id}`} ref={simpleRef(simpleNodes, `11:${s.id}`)}>
            <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => p.onPick(dockPick(EntityKind.Satellite, s.id, s.x, s.y, undefined, p.stationTypes), ...evXY(e.clientX, e.clientY))} />
            <SatelliteGlyph color={tint} />
            {shieldBar(combat)}
          </g>
        );
      })}

      {/* Gates */}
      {gatesHere.map((g) => {
        const inA = g.sectorA === sid;
        const other = inA ? g.sectorB : g.sectorA;
        const name = p.sectorNames.get(other) ?? `#${other}`;
        const wx = inA ? g.posAX : g.posBX;
        const wy = inA ? g.posAY : g.posBY;
        return (
          <g key={`gate-${g.id}`} ref={simpleRef(simpleNodes, `gate:${g.id}`)}>
            <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => p.onPick({ kind: 'gate', id: g.id, x: wx, y: wy, label: `Врата → ${name}` }, ...evXY(e.clientX, e.clientY))} />
            <GateGlyph color="var(--violet)" letter={cardinal(wx, wy)} label={`→ ${name}`} />
          </g>
        );
      })}

      {/* Asteroids (z below containers/ships — static rock) */}
      {[...(p.asteroids?.values() ?? [])].map((a) => {
        // up_ore_scanner gate (phase 10.3.19): the ore type and yield (mass) are
        // only legible with the scanner; otherwise the body reads «Астероид».
        const label = p.hasOreScanner ? `${goodsName(p.goods, a.ore_type)} · ${a.mass}` : 'Астероид';
        return (
          <g key={`asteroid-${a.id}`} ref={simpleRef(simpleNodes, `asteroid:${a.id}`)} style={{ color: 'var(--steel, #8a98a6)' }}>
            <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => p.onPick({ kind: 'asteroid', id: a.id, x: a.x, y: a.y, label }, ...evXY(e.clientX, e.clientY))} />
            <AsteroidGlyph color="var(--steel, #8a98a6)" />
          </g>
        );
      })}

      {/* Containers */}
      {[...(p.containers?.values() ?? [])].map((c) => (
        <g key={`container-${c.id}`} ref={simpleRef(simpleNodes, `container:${c.id}`)} style={{ color: 'var(--amber)' }}>
          <circle className="hit" r={HIT_R} fill="transparent" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
            onClick={(e) => p.onPick({ kind: 'container', id: c.id, x: c.x, y: c.y, label: `Контейнер #${c.id}` }, ...evXY(e.clientX, e.clientY))} />
          <ContainerGlyph color="var(--amber)" />
        </g>
      ))}

      {/* Drones / missiles */}
      {[...(p.drones?.values() ?? [])].map((d) => (
        <g key={`drone-${d.id}`} ref={dirRef(dirNodes, `drone:${d.id}`)} style={{ color: 'var(--cyan)', pointerEvents: 'none' }}>
          <g className="heading"><use href="#hull-drone" /></g>
        </g>
      ))}
      {[...(p.missiles?.values() ?? [])].map((m) => (
        <g key={`missile-${m.id}`} ref={dirRef(dirNodes, `missile:${m.id}`)} style={{ color: 'var(--magenta)', pointerEvents: 'none' }}>
          <g className="heading"><use href="#hull-missile" /></g>
        </g>
      ))}
      {/* Torpedoes — class tints the warhead: 2 = Firestorm (fiery), 3 = Holy (gold) */}
      {[...(p.torpedos?.values() ?? [])].map((t) => (
        <g key={`torpedo-${t.id}`} ref={dirRef(dirNodes, `torpedo:${t.id}`)} style={{ color: torpedoColor(t.class), pointerEvents: 'none' }}>
          <g className="heading"><use href="#hull-torpedo" /></g>
        </g>
      ))}

      {/* Ships (z-top among objects) — controlled ship excluded here, it is
          lifted below so it always draws over every other ship/object. */}
      {shipList.filter((s) => s.id !== p.controlShipID).map(renderShip)}

      {/* Controlled ship — last object node in the DOM, so its silhouette and
          hit-circle sit on top of everything else (TASK-118 FR-1). */}
      {controlledShip && renderShip(controlledShip)}

      {/* Selected target (amber) — rendered when present, positioned in update */}
      {p.selectedTarget && (
        <g ref={selectedRef} pointerEvents="none" style={{ visibility: 'hidden' }}>
          <circle r={16} fill="none" stroke="var(--accent-target)" strokeWidth={2} />
        </g>
      )}
      {/* Hover highlight (cyan) + label */}
      {p.highlight && (
        <g ref={highlightRef} pointerEvents="none" style={{ visibility: 'hidden' }}>
          <circle r={14} fill="none" stroke="var(--accent-hot)" strokeWidth={1.5} />
          <text x={0} y={-18} fill="var(--accent-hot)" fontFamily="var(--font-mono, monospace)" fontSize={10} textAnchor="middle">
            {p.highlight.label}
          </text>
        </g>
      )}
    </svg>
  );
});

// torpedoColor tints a torpedo warhead by its ammunition class so the two
// profiles read apart on the radar: class 2 "Огненная Буря" fiery orange,
// class 3 "Святая Торпеда" holy gold. Phase 10.3.5.
function torpedoColor(cls: number): string {
  return cls === 3 ? '#ffe08a' : '#ff8a3c';
}

// raceTint resolves a static's owning-race colour (phase 8.13), falling back to
// the per-type colour for neutral/unknown owners.
function raceTint(p: Props, race: number, fallback: string): string {
  const c = race ? p.raceColors.get(race) : undefined;
  return c ?? fallback;
}

// shieldBar renders a thin shield bar above a static under attack (shield below
// max). Absent/full shield → nothing. Static (no per-frame update).
function shieldBar(d: DestructibleStatic | undefined) {
  if (!d || d.maxShield <= 0 || d.shield >= d.maxShield) return null;
  const frac = Math.max(0, d.shield / d.maxShield);
  const barW = 18;
  return (
    <g pointerEvents="none" transform="translate(-9 -16)">
      <rect x={0} y={0} width={barW} height={2} fill="rgba(120,140,160,0.35)" />
      <rect x={0} y={0} width={barW * frac} height={2} fill="var(--cyan)" />
    </g>
  );
}

function dockPick(kind: number, id: number, x: number, y: number, type: number | undefined, stationTypes: StationType[]): PickedObject {
  return { kind: 'dock', ref: { kind, id }, x, y, label: staticTypeLabel(kind, type, stationTypes) };
}

// --- node ref helpers -------------------------------------------------------

function shipRef(map: MutableRefObject<Map<number, ShipNode>>, id: number) {
  return (el: SVGGElement | null) => {
    if (!el) {
      map.current.delete(id);
      return;
    }
    map.current.set(id, {
      g: el,
      heading: el.querySelector('.heading') as SVGGElement,
      vel: el.querySelector('.vel') as SVGGElement,
      line: el.querySelector('.vel-line') as SVGLineElement,
      head: el.querySelector('.vel-head') as SVGPathElement,
    });
  };
}

function dirRef(map: MutableRefObject<Map<string, DirNode>>, key: string) {
  return (el: SVGGElement | null) => {
    if (!el) {
      map.current.delete(key);
      return;
    }
    map.current.set(key, { g: el, heading: el.querySelector('.heading') as SVGGElement });
  };
}

function simpleRef(map: MutableRefObject<Map<string, SVGGElement>>, key: string) {
  return (el: SVGGElement | null) => {
    if (!el) {
      map.current.delete(key);
      return;
    }
    map.current.set(key, el);
  };
}

// --- marker resolution (selected / highlight) -------------------------------

type MarkerPos = { x: number; y: number; interp: boolean; ship?: TrackedShip } | null;

function resolveSelected(p: Props): MarkerPos {
  const sel = p.selectedTarget;
  if (!sel) return null;
  if (sel.kind === 'ship') {
    const ship = p.ships.get(sel.id);
    if (!ship || ship.sectorID !== p.currentSectorID) return null;
    return { x: ship.x, y: ship.y, interp: true, ship };
  }
  const list = staticList(p, sel.refKind);
  const hit = list?.find((s) => s.id === sel.id && s.sectorID === p.currentSectorID);
  if (!hit) return null;
  return { x: hit.x, y: hit.y, interp: false };
}

function resolveHighlight(p: Props): MarkerPos {
  const hl = p.highlight;
  if (!hl) return null;
  if (hl.kind === 'ship') {
    const ship = p.ships.get(hl.id);
    if (!ship || ship.sectorID !== p.currentSectorID) return null;
    return { x: ship.x, y: ship.y, interp: true, ship };
  }
  return { x: hl.x, y: hl.y, interp: false };
}

function staticList(p: Props, refKind: number): { id: number; sectorID: number; x: number; y: number }[] | undefined {
  switch (refKind) {
    case EntityKind.Station:
      return p.statics.stations;
    case EntityKind.Shipyard:
      return p.statics.shipyards;
    case EntityKind.TradeStation:
      return p.statics.tradeStations;
    case EntityKind.Pirbase:
      return p.statics.pirbases;
    case EntityKind.Satellite:
      return p.statics.satellites;
    default:
      return undefined;
  }
}

function positionMarker(node: SVGGElement | null, pos: MarkerPos, vp: Viewport, w: number, h: number, now: number, tickMs: number) {
  if (!node) return;
  if (!pos) {
    node.style.visibility = 'hidden';
    return;
  }
  let { x, y } = pos;
  if (pos.interp && pos.ship) {
    const s = pos.ship;
    const t = clamp01((now - s.prevAt) / tickMs);
    x = s.prevX + (s.x - s.prevX) * t;
    y = s.prevY + (s.y - s.prevY) * t;
  }
  const [cx, cy] = wToC(x, y, vp, w, h);
  node.style.visibility = 'visible';
  node.setAttribute('transform', `translate(${cx} ${cy})`);
}
