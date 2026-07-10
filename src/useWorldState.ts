import { useEffect, useRef, useState } from 'react';
import type {
  Asteroid,
  Container,
  DestructibleStatic,
  Drone,
  DroneImpact,
  EntityRef,
  InstalledEquipment,
  LaserBeam,
  Missile,
  MissileImpact,
  PoliceScanFrame,
  SectorStatics,
  Ship,
  ShipCaptureFrame,
  Snapshot,
  StaticsMessage,
  Torpedo,
  TorpedoImpact,
} from './api';
import { wsURL } from './api';

// staticKey keys the static-combat map by kind+id (phase 6.2b).
const staticKey = (r: EntityRef): string => `${r.kind}:${r.id}`;

// removeStaticsByRefs returns a SectorStatics with the given (destroyed)
// objects filtered out, so a killed station/tower stops being rendered.
function removeStaticsByRefs(statics: SectorStatics, refs: EntityRef[]): SectorStatics {
  const drop = new Set(refs.map(staticKey));
  const gone = (kind: number) => (o: { id: number }) => !drop.has(`${kind}:${o.id}`);
  return {
    stations: statics.stations?.filter(gone(2)),
    shipyards: statics.shipyards?.filter(gone(3)),
    tradeStations: statics.tradeStations?.filter(gone(4)),
    pirbases: statics.pirbases?.filter(gone(5)),
    laserTowers: statics.laserTowers?.filter(gone(7)),
    satellites: statics.satellites?.filter(gone(11)),
  };
}

// mergeStatics folds the big-radar staticsAdded delta (phase 10.20 L2) into the
// rendered set, appending only objects not already present (dedup by id per
// kind) so re-entering the window never duplicates.
function mergeStatics(base: SectorStatics, added: SectorStatics): SectorStatics {
  const merge = <T extends { id: number }>(a: T[] | undefined, b: T[] | undefined): T[] | undefined => {
    if (!b || b.length === 0) return a;
    const have = new Set((a ?? []).map((o) => o.id));
    const extra = b.filter((o) => !have.has(o.id));
    return extra.length === 0 ? a : [...(a ?? []), ...extra];
  };
  return {
    stations: merge(base.stations, added.stations),
    shipyards: merge(base.shipyards, added.shipyards),
    tradeStations: merge(base.tradeStations, added.tradeStations),
    pirbases: merge(base.pirbases, added.pirbases),
    laserTowers: merge(base.laserTowers, added.laserTowers),
    satellites: merge(base.satellites, added.satellites),
  };
}

// staticsEmpty reports whether a staticsAdded delta carries nothing.
function staticsEmpty(s: SectorStatics | undefined): boolean {
  return (
    !s ||
    !(
      s.stations?.length ||
      s.shipyards?.length ||
      s.tradeStations?.length ||
      s.pirbases?.length ||
      s.laserTowers?.length ||
      s.satellites?.length
    )
  );
}

export type ConnectionState = 'connecting' | 'open' | 'closed';

// TrackedShip carries previous and current coordinates so SectorCanvas can
// interpolate position between snapshot deliveries. prevAt is wall-clock
// time (performance.now()) when the ship last moved; tickIntervalMs from
// the canvas controls how `t` is clamped during interpolation.
// prevDirectionX/Y carry the previous heading vector so the rotated
// triangle can be interpolated through the shortest arc.
export type TrackedShip = {
  id: number;
  playerID: number;
  // name/race carry the ship's display name and faction (phases 10.10/10.6);
  // name is empty for NPC/legacy ships, race 0 = neutral player.
  name?: string;
  race?: number;
  sectorID: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  directionX: number;
  directionY: number;
  prevX: number;
  prevY: number;
  prevDirectionX: number;
  prevDirectionY: number;
  prevAt: number;
  maxSpeed: number;
  acceleration: number;
  turnRate: number;
  hp: number;
  maxHP: number;
  shield: number;
  maxShield: number;
  energy: number;
  maxEnergy: number;
  targetX?: number;
  targetY?: number;
  finalTarget?: { sectorID: number; x: number; y: number; approach?: EntityRef };
  docked?: EntityRef;
  currentTargetRef?: EntityRef;
  attackTarget?: EntityRef;
  // miningTarget is the asteroid id this ship is sustained-mining (phase
  // 10.3.21); the action menu flips «Бурить/Стоп» on the own active ship.
  miningTarget?: number;
  isSpacesuit?: boolean;
  isOpen?: boolean;
  isNPC?: boolean;
  // hullCategory is the per-class hull-shape code from the backend (phase
  // 10.13); the ObjectLayer maps it to a silhouette. Absent → size heuristic.
  hullCategory?: string;
  // shipClassID/equipment back the shipyard outfit screen (phase 10.14):
  // the class number filters the equipment catalog and equipment is the
  // ship's current fit. Both update live via the WS patch on install/remove.
  shipClassID?: number;
  equipment?: InstalledEquipment[];
  // radarRange is the personal radar radius (phase 10.20); the SectorCanvas
  // draws a ring of this world-radius around the player's own ship.
  radarRange?: number;
  // isHidden marks a cloaked ship (phase 10.20 L4); the HUD shows a stealth
  // indicator for the player's own cloaked ship.
  isHidden?: boolean;
};

export type WorldState = {
  ships: Map<number, TrackedShip>;
  // sectorID is the sector the WS is currently subscribed to. Mirrors the
  // backend's most recent `statics` frame; 0 until the first welcome
  // arrives. On a gate jump the backend re-subscribes the same socket to
  // the destination sector and pushes a fresh statics frame, which bumps
  // this and triggers a ships-map reset (the old sector's ships would
  // otherwise linger after we left their AOI).
  sectorID: number;
  // statics is the per-sector immutable set of dockable objects (stations,
  // shipyards, trade stations, pirbases) the server sends once at WS
  // subscribe time. Empty until the first `statics` frame arrives.
  statics: SectorStatics;
  // tickIntervalMs mirrors the server's sector tick period. Seeded with the
  // backend default (3000) so client-side interpolation has a sane value
  // before the first welcome frame; the welcome overwrites it.
  tickIntervalMs: number;
  // sectorBoundsRadius and nearZoomRadius come from the WS welcome and
  // configure SectorCanvas zoom math. Seeded with the backend defaults
  // so the first render before welcome is still sane.
  sectorBoundsRadius: number;
  nearZoomRadius: number;
  // dockRange / gateRange let TargetsPanel decide when the dock/jump
  // affordance is enabled. Seeded with backend defaults so the first
  // render is consistent before welcome arrives.
  dockRange: number;
  gateRange: number;
  tick: number;
  // timeScale is the sector's time-dilation factor (phase 7.2): 1 = real
  // time, < 1 = slowed under server overload. Drives the "замедление времени"
  // HUD indicator. Defaults to 1 until a snapshot reports otherwise.
  timeScale: number;
  connection: ConnectionState;
  // laserEffects holds the beams that arrived in the most recent
  // snapshot. SectorCanvas draws them once and they are replaced (or
  // emptied) on the next patch — the SPA never accumulates them.
  laserEffects: LaserBeam[];

  // missiles is the live in-flight set per Missile.id. Same accumulation
  // pattern as ships: additions/updates apply, removals delete; the
  // ref-Map is replaced on every snapshot so React picks up the change.
  missiles: Map<number, Missile>;
  // missileImpacts holds the one-frame events from the most recent
  // snapshot. SectorCanvas renders a brief flash and they are dropped
  // on the next snapshot (mirrors laserEffects lifecycle).
  missileImpacts: MissileImpact[];

  // drones is the live combat-drone set per Drone.id, accumulated like
  // missiles. droneImpacts holds the one-frame drone events from the
  // most recent snapshot. Phase 4.4.
  drones: Map<number, Drone>;
  droneImpacts: DroneImpact[];

  // torpedos is the live torpedo set per Torpedo.id, accumulated like drones.
  // torpedoImpacts holds the one-frame detonation/shot-down events (with the
  // splash radius) from the most recent snapshot. Phase 10.3.5.
  torpedos: Map<number, Torpedo>;
  torpedoImpacts: TorpedoImpact[];

  // containers is the live loot-container set per Container.id, accumulated
  // from the added/removed delta (containers are immutable — no update
  // bucket). Phase 4.6.
  containers: Map<number, Container>;

  // asteroids is the live minable ore-body set per Asteroid.id, accumulated
  // from the added/updated/removed delta (updated carries a lower mass as the
  // body is drilled). Phase 10.3.6.
  asteroids: Map<number, Asteroid>;

  // staticCombat is the live HP/Shield of statics that have taken damage or
  // recharged, keyed by `${kind}:${id}`. Patched from the staticsUpdated /
  // staticsRemoved delta; destroyed statics are also dropped from `statics`.
  // Phase 6.2b.
  staticCombat: Map<string, DestructibleStatic>;

  // policeScanSeq increments on every police_scan frame (phase 9.4); the
  // reputation panel refetches and usePoliceLog emits a journal line when it
  // changes. lastPoliceScan carries the latest event for that log line.
  policeScanSeq: number;
  lastPoliceScan: PoliceScanFrame | null;

  // shipCaptureSeq increments on every ship_capture frame (phase 10.3.9.5);
  // useShipCaptureLog emits a journal line when it changes. lastShipCapture
  // carries the latest capture event (captor/success) for that line.
  shipCaptureSeq: number;
  lastShipCapture: ShipCaptureFrame | null;
};

// Defaults mirror cfg.Sector.* / spawn constants on the backend. Only used
// until the first WS welcome arrives.
const DEFAULT_TICK_INTERVAL_MS = 3000;
const DEFAULT_BOUNDS_RADIUS = 5000;
const DEFAULT_NEAR_ZOOM_RADIUS = 125;
const DEFAULT_DOCK_RANGE = 3;
const DEFAULT_GATE_RANGE = 50;

// Exponential backoff for WS reconnect: start at 1s, double on each failure,
// cap at RECONNECT_MAX_MS. Reset to RECONNECT_MIN_MS once a connection
// reaches `open` state, so a transient blip after weeks of uptime still
// reconnects quickly.
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10000;

export function useWorldState(): WorldState {
  const [state, setState] = useState<WorldState>({
    ships: new Map(),
    sectorID: 0,
    statics: {},
    tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
    sectorBoundsRadius: DEFAULT_BOUNDS_RADIUS,
    nearZoomRadius: DEFAULT_NEAR_ZOOM_RADIUS,
    dockRange: DEFAULT_DOCK_RANGE,
    gateRange: DEFAULT_GATE_RANGE,
    tick: 0,
    timeScale: 1,
    connection: 'connecting',
    laserEffects: [],
    missiles: new Map(),
    missileImpacts: [],
    drones: new Map(),
    droneImpacts: [],
    torpedos: new Map(),
    torpedoImpacts: [],
    containers: new Map(),
    asteroids: new Map(),
    staticCombat: new Map(),
    policeScanSeq: 0,
    lastPoliceScan: null,
    shipCaptureSeq: 0,
    lastShipCapture: null,
  });

  // shipsRef stores the live Map between snapshots so the WS callback can
  // mutate-in-place without re-allocating on every patch. setState clones
  // the map shallowly so React sees a new reference.
  const shipsRef = useRef<Map<number, TrackedShip>>(new Map());
  // missilesRef stores the live missile set between snapshots. Same
  // "mutate, then setState with a fresh map" pattern as shipsRef so
  // React renderers see a new reference per frame.
  const missilesRef = useRef<Map<number, Missile>>(new Map());
  // dronesRef stores the live drone set between snapshots, same pattern.
  const dronesRef = useRef<Map<number, Drone>>(new Map());
  // torpedosRef stores the live torpedo set between snapshots, same pattern.
  const torpedosRef = useRef<Map<number, Torpedo>>(new Map());
  // containersRef stores the live loot-container set between snapshots.
  const containersRef = useRef<Map<number, Container>>(new Map());
  // asteroidsRef stores the live minable ore-body set between snapshots, same
  // "mutate, then setState with a fresh map" pattern as containersRef.
  const asteroidsRef = useRef<Map<number, Asteroid>>(new Map());
  // staticCombatRef stores live static HP/Shield between snapshots, keyed by
  // `${kind}:${id}`. Reset on (re)connect and on a sector change. Phase 6.2b.
  const staticCombatRef = useRef<Map<string, DestructibleStatic>>(new Map());
  // shipsSectorRef remembers which sector the current `ships` map was built
  // for. On a backend-driven re-subscribe (gate jump) the statics frame
  // arrives with a new sectorID — we use that delta to reset shipsRef so
  // contacts from the old sector don't leak into the new view.
  const shipsSectorRef = useRef<number>(0);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = RECONNECT_MIN_MS;

    const connect = () => {
      if (stopped) return;
      setState((s) => ({ ...s, connection: 'connecting' }));

      socket = new WebSocket(wsURL());

      socket.onopen = () => {
        // Successful handshake — drop backoff so the next disconnect retries
        // immediately. The server's first patch contains every visible ship
        // as Added, so reset local state too.
        reconnectDelay = RECONNECT_MIN_MS;
        shipsRef.current = new Map();
        missilesRef.current = new Map();
        dronesRef.current = new Map();
        torpedosRef.current = new Map();
        containersRef.current = new Map();
        asteroidsRef.current = new Map();
        staticCombatRef.current = new Map();
        shipsSectorRef.current = 0;
        setState({
          ships: shipsRef.current,
          sectorID: 0,
          statics: {},
          tickIntervalMs: DEFAULT_TICK_INTERVAL_MS,
          sectorBoundsRadius: DEFAULT_BOUNDS_RADIUS,
          nearZoomRadius: DEFAULT_NEAR_ZOOM_RADIUS,
          dockRange: DEFAULT_DOCK_RANGE,
          gateRange: DEFAULT_GATE_RANGE,
          tick: 0,
          timeScale: 1,
          connection: 'open',
          laserEffects: [],
          missiles: missilesRef.current,
          missileImpacts: [],
          drones: dronesRef.current,
          droneImpacts: [],
          torpedos: torpedosRef.current,
          torpedoImpacts: [],
          containers: containersRef.current,
          asteroids: asteroidsRef.current,
          staticCombat: staticCombatRef.current,
          policeScanSeq: 0,
          lastPoliceScan: null,
          shipCaptureSeq: 0,
          lastShipCapture: null,
        });
      };

      socket.onmessage = (ev) => {
        let msg: Snapshot | StaticsMessage;
        try {
          msg = JSON.parse(ev.data as string) as Snapshot | StaticsMessage;
        } catch {
          return;
        }

        if (msg?.type === 'statics') {
          const sectorChanged = msg.sectorID !== 0 && msg.sectorID !== shipsSectorRef.current;
          if (sectorChanged) {
            // Backend re-subscribed this socket to a new sector (gate jump).
            // The old AOI snapshot is meaningless here — drop the ships map
            // so we don't render stale contacts from the previous sector
            // until the next `snapshot` arrives with the new Added set.
            shipsRef.current = new Map();
            missilesRef.current = new Map();
            dronesRef.current = new Map();
            torpedosRef.current = new Map();
            containersRef.current = new Map();
            asteroidsRef.current = new Map();
            staticCombatRef.current = new Map();
            shipsSectorRef.current = msg.sectorID;
          } else if (shipsSectorRef.current === 0 && msg.sectorID !== 0) {
            shipsSectorRef.current = msg.sectorID;
          }
          setState((s) => ({
            ...s,
            ships: sectorChanged ? shipsRef.current : s.ships,
            sectorID: msg.sectorID || s.sectorID,
            statics: msg.statics ?? {},
            asteroids: sectorChanged ? asteroidsRef.current : s.asteroids,
            staticCombat: sectorChanged ? staticCombatRef.current : s.staticCombat,
            tickIntervalMs: msg.tickIntervalMs > 0 ? msg.tickIntervalMs : s.tickIntervalMs,
            sectorBoundsRadius: msg.sectorBoundsRadius > 0 ? msg.sectorBoundsRadius : s.sectorBoundsRadius,
            nearZoomRadius: msg.nearZoomRadius > 0 ? msg.nearZoomRadius : s.nearZoomRadius,
            dockRange: msg.dockRange > 0 ? msg.dockRange : s.dockRange,
            gateRange: msg.gateRange > 0 ? msg.gateRange : s.gateRange,
          }));
          return;
        }
        if ((msg as { type?: string }).type === 'police_scan') {
          // Per-player police confiscation (9.4): bump the seq so the
          // reputation panel refetches and usePoliceLog emits a journal line.
          const ev = msg as unknown as PoliceScanFrame;
          setState((s) => ({ ...s, policeScanSeq: s.policeScanSeq + 1, lastPoliceScan: ev }));
          return;
        }
        if ((msg as { type?: string }).type === 'ship_capture') {
          // Per-player capture outcome (10.3.9.5): bump the seq so
          // useShipCaptureLog emits the "Корабль захвачен"/"Ваш корабль
          // захвачен"/"Захват не удался" journal line for captor and old owner.
          const ev = msg as unknown as ShipCaptureFrame;
          setState((s) => ({ ...s, shipCaptureSeq: s.shipCaptureSeq + 1, lastShipCapture: ev }));
          return;
        }
        if (msg?.type !== 'snapshot') return;
        const snap = msg;

        const now = performance.now();
        const next = new Map(shipsRef.current);

        const upsert = (s: Ship) => {
          const existing = next.get(s.id);
          const base: TrackedShip = existing
            ? {
                ...existing,
                prevX: existing.x,
                prevY: existing.y,
                prevDirectionX: existing.directionX,
                prevDirectionY: existing.directionY,
                prevAt: now,
              }
            : {
                id: s.id,
                playerID: s.playerID,
                sectorID: s.sectorID,
                x: s.x,
                y: s.y,
                vx: s.vx,
                vy: s.vy,
                directionX: s.directionX,
                directionY: s.directionY,
                prevX: s.x,
                prevY: s.y,
                prevDirectionX: s.directionX,
                prevDirectionY: s.directionY,
                prevAt: now,
                maxSpeed: s.maxSpeed,
                acceleration: s.acceleration,
                turnRate: s.turnRate,
                hp: s.hp,
                maxHP: s.maxHP,
                shield: s.shield,
                maxShield: s.maxShield,
                energy: s.energy,
                maxEnergy: s.maxEnergy,
              };
          next.set(s.id, {
            ...base,
            playerID: s.playerID,
            sectorID: s.sectorID,
            x: s.x,
            y: s.y,
            vx: s.vx,
            vy: s.vy,
            directionX: s.directionX,
            directionY: s.directionY,
            maxSpeed: s.maxSpeed,
            acceleration: s.acceleration,
            turnRate: s.turnRate,
            hp: s.hp,
            maxHP: s.maxHP,
            shield: s.shield,
            maxShield: s.maxShield,
            energy: s.energy,
            maxEnergy: s.maxEnergy,
            targetX: s.targetX,
            targetY: s.targetY,
            finalTarget: s.finalTarget,
            docked: s.docked,
            currentTargetRef: s.currentTargetRef,
            attackTarget: s.attackTarget,
            miningTarget: s.miningTarget,
            isSpacesuit: s.isSpacesuit,
            isOpen: s.isOpen,
            isNPC: s.isNPC,
            hullCategory: s.hullCategory,
            shipClassID: s.shipClassID,
            equipment: s.equipment,
            radarRange: s.radarRange,
            isHidden: s.isHidden,
            name: s.name,
            race: s.race,
          });
        };

        for (const s of snap.added ?? []) upsert(s);
        for (const s of snap.updated ?? []) upsert(s);
        for (const id of snap.removed ?? []) next.delete(id);

        // Missile delta — same diff/upsert pattern. Missile is a plain
        // record (no animation refs to preserve), so updates just
        // overwrite the slot.
        const nextMissiles = new Map(missilesRef.current);
        for (const m of snap.missilesAdded ?? []) nextMissiles.set(m.id, m);
        for (const m of snap.missilesUpdated ?? []) nextMissiles.set(m.id, m);
        for (const id of snap.missilesRemoved ?? []) nextMissiles.delete(id);

        // Drone delta — same diff/upsert pattern as missiles.
        const nextDrones = new Map(dronesRef.current);
        for (const d of snap.dronesAdded ?? []) nextDrones.set(d.id, d);
        for (const d of snap.dronesUpdated ?? []) nextDrones.set(d.id, d);
        for (const id of snap.dronesRemoved ?? []) nextDrones.delete(id);

        // Torpedo delta — same diff/upsert pattern as drones.
        const nextTorpedos = new Map(torpedosRef.current);
        for (const t of snap.torpedosAdded ?? []) nextTorpedos.set(t.id, t);
        for (const t of snap.torpedosUpdated ?? []) nextTorpedos.set(t.id, t);
        for (const id of snap.torpedosRemoved ?? []) nextTorpedos.delete(id);

        // Container delta — added/removed only (containers are immutable).
        const nextContainers = new Map(containersRef.current);
        for (const c of snap.containersAdded ?? []) nextContainers.set(c.id, c);
        for (const id of snap.containersRemoved ?? []) nextContainers.delete(id);

        // Asteroid delta — added/updated (mass shrinks while drilled)/removed.
        const nextAsteroids = new Map(asteroidsRef.current);
        for (const a of snap.asteroidsAdded ?? []) nextAsteroids.set(a.id, a);
        for (const a of snap.asteroidsUpdated ?? []) nextAsteroids.set(a.id, a);
        for (const id of snap.asteroidsRemoved ?? []) nextAsteroids.delete(id);

        // Static-combat delta (6.2b): patch HP/Shield of damaged/recharging
        // statics; drop destroyed ones from both the combat map and the
        // rendered layout so they disappear.
        const staticsUpdated = snap.staticsUpdated ?? [];
        const staticsRemoved = snap.staticsRemoved ?? [];
        let nextStaticCombat = staticCombatRef.current;
        if (staticsUpdated.length > 0 || staticsRemoved.length > 0) {
          nextStaticCombat = new Map(staticCombatRef.current);
          for (const d of staticsUpdated) nextStaticCombat.set(staticKey(d.ref), d);
          for (const ref of staticsRemoved) nextStaticCombat.delete(staticKey(ref));
        }

        shipsRef.current = next;
        missilesRef.current = nextMissiles;
        dronesRef.current = nextDrones;
        torpedosRef.current = nextTorpedos;
        containersRef.current = nextContainers;
        asteroidsRef.current = nextAsteroids;
        staticCombatRef.current = nextStaticCombat;
        const staticsAdded = snap.staticsAdded;
        setState((s) => {
          let nextStatics =
            staticsRemoved.length > 0 ? removeStaticsByRefs(s.statics, staticsRemoved) : s.statics;
          if (!staticsEmpty(staticsAdded)) {
            nextStatics = mergeStatics(nextStatics, staticsAdded as SectorStatics);
          }
          return {
          ships: next,
          sectorID: s.sectorID,
          statics: nextStatics,
          staticCombat: nextStaticCombat,
          tickIntervalMs: s.tickIntervalMs,
          sectorBoundsRadius: s.sectorBoundsRadius,
          nearZoomRadius: s.nearZoomRadius,
          dockRange: s.dockRange,
          gateRange: s.gateRange,
          tick: snap.tick,
          // Snapshots omit timeScale at real time (1.0) — default to 1.
          timeScale: snap.timeScale ?? 1,
          connection: 'open',
          laserEffects: snap.laserEffects ?? [],
          missiles: nextMissiles,
          missileImpacts: snap.missileImpacts ?? [],
          drones: nextDrones,
          droneImpacts: snap.droneImpacts ?? [],
          torpedos: nextTorpedos,
          torpedoImpacts: snap.torpedoImpacts ?? [],
          containers: nextContainers,
          asteroids: nextAsteroids,
          policeScanSeq: s.policeScanSeq,
          lastPoliceScan: s.lastPoliceScan,
          shipCaptureSeq: s.shipCaptureSeq,
          lastShipCapture: s.lastShipCapture,
          };
        });
      };

      socket.onclose = () => {
        if (stopped) return;
        setState((s) => ({ ...s, connection: 'closed' }));
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, []);

  return state;
}
