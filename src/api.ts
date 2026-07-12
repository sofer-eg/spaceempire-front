// Wire types shared between WS streaming and HTTP fallbacks.
//
// Phase 1.4 contract: the WS push stopped being a full snapshot. Servers
// emit deltas `{tick, added, updated, removed}` and the client folds them
// into a local map keyed by ship id.

// EntityRef mirrors the backend domain.EntityRef. Kind values:
//   1 = ship, 2 = station, 3 = shipyard, 4 = trade_station, 5 = pirbase.
// Only the four static kinds (2..5) are valid for docking targets in phase 3.2.
export type EntityRef = { kind: number; id: number };

// InstalledEquipment is one ct_updates module fitted on a ship (phase 10.14).
// equipmentID pins the catalog row; type is the module key (up_engine/…);
// level is the install level.
export type InstalledEquipment = { equipmentID: number; type: string; level: number };

export const EntityKind = {
  Ship: 1,
  Station: 2,
  Shipyard: 3,
  TradeStation: 4,
  Pirbase: 5,
  Drone: 6,
  LaserTower: 7,
  Satellite: 11,
} as const;

// isStaticTargetKind mirrors the server's sector.IsStaticTargetKind (TASK-113
// FR-01): the destructible statics a weapon may lock onto besides ships —
// stations, shipyards, trade stations, pirbases, laser towers, satellites.
// Gates/containers/asteroids are NOT weapon targets (gates excluded until
// TASK-110). One source of truth for the weapon-button gates so the UI never
// offers a target the server would reject with ErrInvalidAttackTarget.
export function isStaticTargetKind(kind: number): boolean {
  return (
    kind === EntityKind.Station ||
    kind === EntityKind.Shipyard ||
    kind === EntityKind.TradeStation ||
    kind === EntityKind.Pirbase ||
    kind === EntityKind.LaserTower ||
    kind === EntityKind.Satellite
  );
}

export type Ship = {
  id: number;
  playerID: number;
  // name is the ship's display name (phase 10.10); empty/absent for NPC and
  // legacy ships. race is the ship's faction (0 = neutral player). Together
  // they back shipDisplayName's fallback (phases 10.6/10.7).
  name?: string;
  race?: number;
  sectorID: number;
  x: number;
  y: number;
  // vx/vy is the instantaneous velocity. Phase 3.18 adds inertia to the
  // physics model — the canvas can extrapolate between snapshots so the
  // ship visually drifts when Target is cleared but Vel is non-zero.
  vx: number;
  vy: number;
  // directionX/Y is the ship's nose unit vector — mirrors the SP's
  // direction_x/direction_y columns. The canvas converts it to an angle
  // with atan2 to rotate the triangle glyph; useWorldState keeps a
  // prevDirectionX/Y pair for shortest-arc interpolation between ticks.
  directionX: number;
  directionY: number;
  // maxSpeed/acceleration/turnRate are class characteristics (server-
  // side ships table). PilotPanel surfaces speed/accel; the rest are
  // available for client-side prediction in later phases.
  maxSpeed: number;
  acceleration: number;
  turnRate: number;
  // hp/shield/energy are the ship's current pools. maxHP/maxShield/
  // maxEnergy travel alongside on every patch — cheap (one int each)
  // and avoids depending on the welcome for combat HUD bars.
  hp: number;
  maxHP: number;
  shield: number;
  maxShield: number;
  energy: number;
  maxEnergy: number;
  // targetX/Y is the per-tick waypoint the ship is steering toward — set
  // either by manual sendMove or by the server autopilot (next gate / final
  // pos). The canvas draws it as a small marker so the player sees where
  // their ship is headed *right now*.
  targetX?: number;
  targetY?: number;
  // finalTarget is the autopilot destination (sector + position). When
  // approach is set, the autopilot parks the ship at DockRange/2 from the
  // referenced static — the player still has to click "Стыковка" to dock.
  // Phase 3.12 dropped the auto-dock behaviour.
  finalTarget?: { sectorID: number; x: number; y: number; approach?: EntityRef };
  // docked, when set, marks the ship as parked inside a static. The SPA
  // shows the station screen instead of the canvas controls.
  docked?: EntityRef;
  // currentTargetRef, when set, names the entity the player explicitly
  // told the ship to fly to (via TargetsPanel row click or
  // ObjectActionsMenu "Лететь"/"Стыковка"). SectorView derives
  // selectedTargetRef from ownShip and feeds it to SectorCanvas /
  // TargetsPanel so the chosen target gets a persistent orange outline
  // and a highlighted row. Cleared on dock/undock or plain arrival;
  // preserved through autopilot parking. See backend domain.Ship.
  currentTargetRef?: EntityRef;
  // attackTarget, when set, marks the entity the laser tick is firing
  // at. Phase 4.2 emits EntityKindShip targets only. Cleared on cease-
  // fire, target death, or sector handoff.
  attackTarget?: EntityRef;
  // miningTarget, when set, is the id of the asteroid the ship is sustained-
  // mining (phase 10.3.6/10.3.21) — a bare asteroid id. The action menu reads
  // it on the player's own active ship to flip «Бурить»/«Прекратить добычу»
  // into one toggle, mirroring attackTarget for fire/cease-fire.
  miningTarget?: number;
  // isSpacesuit marks the weak pilot suit a player flies after their ship was
  // destroyed (phase 10.1). The HUD shows a "СКАФАНДР" indicator.
  isSpacesuit?: boolean;
  // isOpen marks a ship other players may board as a passenger (phase 10.23).
  isOpen?: boolean;
  // isNPC marks ships owned by the system NPC player (traders, miners,
  // passengers). The SPA colours them amber; enemy player ships get red.
  isNPC?: boolean;
  // hullCategory is the hull-shape code (M1/M2/M3/M4/M5/M6/TL/XX/TS) resolved
  // from the ship's class on the backend (phase 10.13). The SVG ObjectLayer
  // maps it to a per-class silhouette. Absent for spacesuit/legacy ships — the
  // client then falls back to a maxSpeed-based size heuristic.
  hullCategory?: string;
  // shipClassID is the ct_ship_classes blueprint id (phase 10.14); the shipyard
  // outfit screen uses it to find the ship's class number and filter the
  // equipment catalog. Absent for spacesuit/legacy ships.
  shipClassID?: number;
  // equipment is the list of installed ct_updates modules (phase 10.14).
  // Absent/empty for NPC/legacy ships; present on outfitted player ships.
  equipment?: InstalledEquipment[];
  // radarRange is the ship's personal small-radar radius in world units
  // (phase 10.20). The SectorCanvas draws it as a ring around the player's own
  // ship. Absent for legacy/spacesuit ships (server used the AOI fallback).
  radarRange?: number;
  // isHidden marks a cloaked ship (phase 10.20 L4, up_hide). Only set on ships
  // the client can see (own / close / allied). The HUD shows a stealth
  // indicator for the player's own cloaked ship.
  isHidden?: boolean;
};

// LaserBeam is a one-frame visual effect: the SPA draws each beam from
// `(fromX,fromY)` to `(toX,toY)` for a single tick, then discards it.
// Damage / killed feed the event log; the SectorCanvas only needs the
// coordinates.
export type LaserBeam = {
  attacker: number;
  target: EntityRef;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  damage: number;
  killed?: boolean;
};

// Missile is the in-flight projectile broadcast in WS patches. Pos / Vel
// / Direction are stored as scalar pairs (x/y, vx/vy, dirX/dirY) to mirror
// the wire DTO. Reconstructable state on the backend — never persisted.
export type Missile = {
  id: number;
  attacker: number;
  target: EntityRef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dirX: number;
  dirY: number;
  expiresAt: string;
};

// MissileImpact is a one-frame event the SPA renders as a brief flash:
// `expired=true` → the missile timed out (no damage); otherwise the
// missile detonated on `target` for `damage` (Killed when the target
// died this hit). Always coincides with the missile's removal frame.
export type MissileImpact = {
  missileID: number;
  attacker: number;
  target: EntityRef;
  x: number;
  y: number;
  damage?: number;
  killed?: boolean;
  expired?: boolean;
};

// Drone is a persistent autonomous combat unit broadcast in WS patches.
// Same scalar-pair layout as Missile. Phase 4.4.
export type Drone = {
  id: number;
  owner: number;
  target: EntityRef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dirX: number;
  dirY: number;
  hp: number;
};

// DroneImpact is a one-frame drone event: `expired=true` → the drone
// self-destructed (TTL / owner loss); otherwise it fired on `target` for
// `damage` (killed when the target died this hit).
export type DroneImpact = {
  droneID: number;
  owner: number;
  target: EntityRef;
  x: number;
  y: number;
  damage?: number;
  killed?: boolean;
  expired?: boolean;
};

// Torpedo is a persistent, shoot-downable homing projectile broadcast in WS
// patches (ЧТЗ doc-1 §3 FR-010). Same scalar-pair layout as Drone/Missile;
// `cls` selects the ammunition profile/icon (2 = "Огненная Буря", 3 = "Святая
// Торпеда") and `hp` lets the renderer show it can be shot down. Kept as a
// separate list so the Ship DTO stays untouched (NFR-006). Phase 10.3.5.
export type Torpedo = {
  id: number;
  owner: number;
  target: EntityRef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dirX: number;
  dirY: number;
  // class is the ammunition profile: 2 = Firestorm (gt23), 3 = Holy (gt24).
  // (`class` is a valid object key in JS — only an identifier reserved word.)
  class: number;
  hp: number;
};

// TorpedoImpact is a one-frame torpedo event in the same Snapshot that removes
// the torpedo (mirrors MissileImpact / DroneImpact). Exactly one outcome flag
// is set: `hit` (a detonation — carries `splashRadius` so the SPA can animate
// the area blast), `killed` (shot down — dies in place, no splash), or `expired`
// (TTL / owner-loss — no damage). Phase 10.3.5.
export type TorpedoImpact = {
  torpedoID: number;
  owner: number;
  target: EntityRef;
  x: number;
  y: number;
  splashRadius?: number;
  hit?: boolean;
  killed?: boolean;
  expired?: boolean;
};

// Container is a loot drop floating in space — the cargo of a destroyed
// ship, pickup-able by a nearby ship. Only the glyph position travels in
// the radar delta; the contents transfer on pickup. Phase 4.6.
export type Container = {
  id: number;
  x: number;
  y: number;
};

// Asteroid is a minable ore body. Pos and oreType are fixed at creation;
// mass shrinks as the body is mined, so a WS update may re-send a lower
// mass. oreType is a goods-catalog type id (resolve via goodsName for the
// human-readable ore label). Phase 10.3.6.
export type Asteroid = {
  id: number;
  x: number;
  y: number;
  mass: number;
  ore_type: number;
};

export type Snapshot = {
  type: 'snapshot';
  sectorID: number;
  tick: number;
  // timeScale is the sector's time-dilation factor (phase 7.2); omitted (→
  // undefined) when the sector runs at real time (1.0).
  timeScale?: number;
  // HTTP /api/state still returns a full list under `ships` so the SPA can
  // bootstrap deterministically; WS always uses the delta fields.
  ships?: Ship[];
  statics?: SectorStatics;
  // asteroids is the full minable ore-body set returned by the /api/state
  // snapshot (mirrors ships). WS deltas use the asteroidsAdded/Updated/Removed
  // buckets below instead. Phase 10.3.6.
  asteroids?: Asteroid[];
  added?: Ship[];
  updated?: Ship[];
  removed?: number[];
  // laserEffects carries one-frame beams that fired this tick. Absent or
  // empty between ticks. Phase 4.2.
  laserEffects?: LaserBeam[];
  // Missile delta against the previous frame within AOI. Phase 4.3.
  missilesAdded?: Missile[];
  missilesUpdated?: Missile[];
  missilesRemoved?: number[];
  missileImpacts?: MissileImpact[];
  // Drone delta against the previous frame within AOI. Phase 4.4.
  dronesAdded?: Drone[];
  dronesUpdated?: Drone[];
  dronesRemoved?: number[];
  droneImpacts?: DroneImpact[];
  // Torpedo delta against the previous frame within AOI. Same diff/upsert
  // pattern as drones; impacts carry the splash centre + radius. Phase 10.3.5.
  torpedosAdded?: Torpedo[];
  torpedosUpdated?: Torpedo[];
  torpedosRemoved?: number[];
  torpedoImpacts?: TorpedoImpact[];
  // Container delta against the previous frame within AOI (immutable, so
  // no "updated"). Phase 4.6.
  containersAdded?: Container[];
  containersRemoved?: number[];
  // Asteroid delta against the previous frame within AOI. Added carries full
  // bodies, Updated carries bodies whose mass changed (mining), Removed is the
  // id list of asteroids that depleted or left view. Phase 10.3.6.
  asteroidsAdded?: Asteroid[];
  asteroidsUpdated?: Asteroid[];
  asteroidsRemoved?: number[];
  // Static-combat delta (phase 6.2b): statics whose HP/Shield changed this
  // tick, and statics destroyed this tick (ref-only). Patches the combat
  // state of objects received once via the `statics` frame.
  staticsUpdated?: DestructibleStatic[];
  staticsRemoved?: EntityRef[];
  // staticsAdded carries the full static objects that just entered the player's
  // big-radar window (phase 10.20 L2). The client merges them into its statics
  // map; statics that left arrive in staticsRemoved.
  staticsAdded?: SectorStatics;
};

// DestructibleStatic is the live combat state of one static object — the
// HP/Shield patched onto a station/shipyard/trade-station/pirbase/tower as
// it takes damage or recharges. Phase 6.2b.
export type DestructibleStatic = {
  ref: EntityRef;
  hp: number;
  shield: number;
  maxShield: number;
};

// Static dockable objects of a sector — stations (factories), shipyards,
// trade stations and pirbases. Sent once over WS as a dedicated `statics`
// frame right after subscribe, and embedded in HTTP /api/state. None of
// the fields mutate during a session in phase 3.1.

export type Station = {
  id: number;
  ownerID?: number;
  type: number;
  sectorID: number;
  x: number;
  y: number;
  hp: number;
  shield: number;
  race: number;
  built: boolean;
};

export type Shipyard = {
  id: number;
  ownerID?: number;
  sectorID: number;
  x: number;
  y: number;
  hp: number;
  shield: number;
  race: number;
  built: boolean;
};

export type TradeStation = {
  id: number;
  ownerID?: number;
  type: number;
  sectorID: number;
  x: number;
  y: number;
  hp: number;
  shield: number;
  race: number;
  built: boolean;
};

export type Pirbase = {
  id: number;
  sectorID: number;
  x: number;
  y: number;
  hp: number;
  shield: number;
  angle: number;
  race: number;
  built: boolean;
};

// LaserTower is a stationary defensive tower (phase 4.5). Read-only this
// phase — it has a fixed position and is rendered as a static object.
export type LaserTower = {
  id: number;
  ownerID?: number;
  sectorID: number;
  x: number;
  y: number;
  hp: number;
  shield: number;
  race: number;
  built: boolean;
};

// Satellite is a player-deployed navigation satellite (phase 10.15): a
// destructible static beacon that reveals the whole sector on radar while
// alive. Rendered with the 10.13 silhouette; deployed via sendInstallSatellite.
export type Satellite = {
  id: number;
  ownerID?: number;
  sectorID: number;
  x: number;
  y: number;
  hp: number;
  shield: number;
  race: number;
  built: boolean;
};

export type SectorStatics = {
  stations?: Station[];
  shipyards?: Shipyard[];
  tradeStations?: TradeStation[];
  pirbases?: Pirbase[];
  laserTowers?: LaserTower[];
  satellites?: Satellite[];
};

export type StaticsMessage = {
  type: 'statics';
  sectorID: number;
  // tickIntervalMs is the engine tick period the server runs at. The SPA
  // uses it to size client-side interpolation; without it the canvas
  // would have to guess and risk drift if the server tick rate changes.
  tickIntervalMs: number;
  // sectorBoundsRadius is the half-extent (in world units) of the
  // renderable sector box. Used by SectorCanvas to fall back to the
  // full sector in Max-zoom when there are no statics, and to draw the
  // boundary line in Near-zoom.
  sectorBoundsRadius: number;
  // nearZoomRadius is the half-side of the Near zoom window around the
  // player's own ship.
  nearZoomRadius: number;
  // dockRange and gateRange mirror the server-side validation radii.
  // The TargetsPanel uses them to decide when a dock/jump menu item is
  // enabled, so the affordance matches what the worker will accept.
  dockRange: number;
  gateRange: number;
  statics: SectorStatics;
};

export type PlayerSummary = {
  playerID: number;
  login: string;
};

export async function fetchState(): Promise<Snapshot> {
  const res = await fetch('/api/state');
  if (!res.ok) {
    throw new Error(`GET /api/state ${res.status}`);
  }
  return (await res.json()) as Snapshot;
}

export async function fetchPlayers(): Promise<PlayerSummary[]> {
  const res = await fetch('/api/players');
  if (!res.ok) {
    throw new Error(`GET /api/players ${res.status}`);
  }
  return (await res.json()) as PlayerSummary[];
}

export async function sendMove(
  shipID: number,
  x: number,
  y: number,
  targetRef?: EntityRef,
): Promise<void> {
  const res = await fetch('/api/cmd/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, x, y, targetRef }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/move ${res.status}: ${body}`);
  }
}

export type SetCourseResponse = { hops: number };

export async function sendSetCourse(
  shipID: number,
  sectorID: number,
  x: number,
  y: number,
  approach?: EntityRef,
): Promise<SetCourseResponse> {
  const res = await fetch('/api/cmd/set-course', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, sectorID, x, y, approach }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/set-course ${res.status}: ${body}`);
  }
  return (await res.json()) as SetCourseResponse;
}

export async function sendJump(shipID: number, gateID: number): Promise<void> {
  const res = await fetch('/api/cmd/jump', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, gateID }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/jump ${res.status}: ${body}`);
  }
}

// sendJumpDrive fires the seamless up_jump_drive jump (TASK-100.3.7): the ship
// is thrown into a random point near the centre of targetSectorID — the player
// picks only the sector, not a position. Throws ApiError on a non-2xx so the
// caller can pass it to jumpDriveErrorText for a Russian, human-readable line.
export async function sendJumpDrive(shipID: number, targetSectorID: number): Promise<void> {
  const res = await fetch('/api/cmd/jump-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetSectorID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// claimStation buys an unowned station for the configured price (phase 8.7).
// On success the station becomes player-owned and starts owing rent.
export async function claimStation(stationID: number): Promise<void> {
  const res = await fetch(`/api/stations/${stationID}/claim`, { method: 'POST' });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* keep statusText */
    }
    throw new Error(msg);
  }
}

// getShipAtShipyard exchanges the player's spacesuit (docked at the shipyard)
// for a fresh starter ship at the same spot (phase 10.2). Free for now.
export async function getShipAtShipyard(shipyardID: number): Promise<void> {
  const res = await fetch(`/api/shipyard/${shipyardID}/get-ship`, { method: 'POST' });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* keep statusText */
    }
    throw new Error(msg);
  }
}

// --- Shipyard purchase + outfitting (phase 10.14) --------------------------

// BuyShipAck is the body of POST /api/shipyard/{id}/buy-ship on success: the
// new ship id and the player's debited wallet balance.
export type BuyShipAck = { ok: boolean; shipID: number; cash: number };

// OutfitAck is the body of install-/uninstall-equipment: the new wallet and
// the ship's full installed-equipment list after the change.
export type OutfitAck = { ok: boolean; cash: number; equipment: InstalledEquipment[] };

// postShipyard POSTs a JSON body and unwraps the {error} message on failure,
// mirroring getShipAtShipyard's error handling.
async function postShipyard<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* keep statusText */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

// buyShip purchases a ship of the given class at the shipyard, debiting
// base_price. The new ship spawns docked at the shipyard (the player keeps
// flying their active ship — there is no active-ship switch yet, phase 10.14).
export async function buyShip(shipyardID: number, classID: number): Promise<BuyShipAck> {
  return postShipyard<BuyShipAck>(`/api/shipyard/${shipyardID}/buy-ship`, { classID });
}

// installEquipment fits a ct_updates module (at the given level) on a ship
// docked at the shipyard, debiting price + level*price_per_level.
export async function installEquipment(
  shipyardID: number,
  shipID: number,
  equipmentID: number,
  level: number,
): Promise<OutfitAck> {
  return postShipyard<OutfitAck>(`/api/shipyard/${shipyardID}/install-equipment`, {
    shipID,
    equipmentID,
    level,
  });
}

// uninstallEquipment removes a module from a docked ship (no refund, phase
// 10.14).
export async function uninstallEquipment(
  shipyardID: number,
  shipID: number,
  equipmentID: number,
): Promise<OutfitAck> {
  return postShipyard<OutfitAck>(`/api/shipyard/${shipyardID}/uninstall-equipment`, {
    shipID,
    equipmentID,
  });
}

export async function sendDock(shipID: number, target: EntityRef): Promise<void> {
  const res = await fetch('/api/cmd/dock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, target }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/dock ${res.status}: ${body}`);
  }
}

export async function sendUndock(shipID: number): Promise<void> {
  const res = await fetch('/api/cmd/undock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/undock ${res.status}: ${body}`);
  }
}

// boardShip moves the player out of their spacesuit into a target ship (10.23):
// own ship → take control; NPC / another player's open ship → ride as a
// passenger. Returns the resulting mode. Callers refreshPlayer afterwards so the
// HUD/own-ship (and passenger state) re-resolve.
export async function boardShip(targetShipID: number): Promise<{ mode: 'control' | 'passenger' }> {
  const res = await fetch('/api/cmd/board-ship', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetShipID }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/board-ship ${res.status}: ${body}`);
  }
  return (await res.json()) as { mode: 'control' | 'passenger' };
}

// disembark drops a passenger off their host ship into a spacesuit at the host's
// current spot (10.23). Returns the new spacesuit id. Callers refreshPlayer
// afterwards so ownShip / passenger state re-resolve.
export async function disembark(): Promise<{ shipID: number }> {
  const res = await fetch('/api/cmd/disembark', { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/disembark ${res.status}: ${body}`);
  }
  return (await res.json()) as { shipID: number };
}

// setShipAccess toggles whether other players may board the caller's ship as a
// passenger (10.23). The WS snapshot reflects the new isOpen on the next tick,
// so callers don't need to refresh.
export async function setShipAccess(shipID: number, open: boolean): Promise<void> {
  const res = await fetch('/api/cmd/ship-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, open }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/ship-access ${res.status}: ${body}`);
  }
}

// exitShip drops the player out of their ship into a spacesuit at the ship's
// current spot (10.23): docked at a station → the suit stays in the hangar; in
// space → the suit floats free. Returns the new spacesuit id. Callers
// refreshPlayer afterwards so ownShip re-resolves to the suit.
export async function exitShip(shipID: number): Promise<{ shipID: number }> {
  const res = await fetch('/api/cmd/exit-ship', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/exit-ship ${res.status}: ${body}`);
  }
  return (await res.json()) as { shipID: number };
}

// activateShip switches the player's active ship (10.14a). After it resolves,
// callers refreshPlayer() so the HUD/own-ship picks up the new activeShipID;
// the WS follows the ship into its sector via a server-published handoff.
export async function activateShip(shipID: number): Promise<void> {
  const res = await fetch(`/api/ship/${shipID}/activate`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/ship/${shipID}/activate ${res.status}: ${body}`);
  }
}

// sellShip trades a ship in at the shipyard it is docked at (10.14a) for a
// fraction of its base price. Returns the new wallet balance. The ship must be
// owned, docked at this shipyard, not the active ship, and not the last one.
export async function sellShip(shipyardID: number, shipID: number): Promise<{ cash: number }> {
  const res = await fetch(`/api/shipyard/${shipyardID}/sell-ship`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/shipyard/${shipyardID}/sell-ship ${res.status}: ${body}`);
  }
  return (await res.json()) as { cash: number };
}

export async function sendAttack(shipID: number, targetRef: EntityRef): Promise<void> {
  const res = await fetch('/api/cmd/attack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/attack ${res.status}: ${body}`);
  }
}

// sendCapture attempts to seize a hostile ship with the attacker's up_capture
// module (POST /api/cmd/capture, TASK-100.3.9.5). Body mirrors sendAttack
// (attacker shipID + target EntityRef); the server resolves the energy cost and
// gates on module/shield/range/relation. A 2xx means the roll was performed —
// the win/lose journal line arrives asynchronously on the WS ship_capture frame,
// so this resolves void like sendAttack and surfaces only the 4xx as an error.
export async function sendCapture(shipID: number, targetRef: EntityRef): Promise<void> {
  const res = await fetch('/api/cmd/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/capture ${res.status}: ${body}`);
  }
}

// sendHack raids a trade/production station with the attacker's up_hack module
// (POST /api/cmd/hack, TASK-100.3.9.6). Body mirrors sendCapture (attacker
// shipID + target station EntityRef); the server resolves the energy cost and
// gates on module/range/goods≥30%/race≠6/built authoritatively. A 2xx means the
// raid ran — the "Похищено N ед." / "Неудачная попытка взлома" journal line
// arrives asynchronously on the WS station_hacked frame, so this resolves void
// like sendCapture and surfaces only the 4xx as an error.
export async function sendHack(shipID: number, targetRef: EntityRef): Promise<void> {
  const res = await fetch('/api/cmd/hack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/hack ${res.status}: ${body}`);
  }
}

export async function sendCeaseFire(shipID: number): Promise<void> {
  const res = await fetch('/api/cmd/cease-fire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/cmd/cease-fire ${res.status}: ${body}`);
  }
}

// sendLaunchMissile fires one homing missile from shipID at targetRef.
// Returns the server-allocated missile id so the caller can correlate WS
// frames with its own optimistic state. Throws ApiError on a non-2xx
// status with the backend's error text.
export async function sendLaunchMissile(
  shipID: number,
  targetRef: EntityRef,
): Promise<{ missileID: number }> {
  const res = await fetch('/api/cmd/launch-missile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; missileID: number };
  return { missileID: body.missileID };
}

// sendLaunchDrone launches `count` combat drones from shipID at targetRef.
// Returns how many were actually spawned. Throws ApiError on a non-2xx.
export async function sendLaunchDrone(
  shipID: number,
  targetRef: EntityRef,
  count: number,
): Promise<{ spawned: number }> {
  const res = await fetch('/api/cmd/launch-drone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef, count }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; spawned: number };
  return { spawned: body.spawned };
}

// sendRecallDrones recalls every live drone owned by shipID back to cargo.
// Returns how many returned. Throws ApiError on a non-2xx.
export async function sendRecallDrones(
  shipID: number,
): Promise<{ recalled: number }> {
  const res = await fetch('/api/cmd/recall-drones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; recalled: number };
  return { recalled: body.recalled };
}

// sendLaunchTorpedo fires one torpedo of `torpedoClass` (2 = "Огненная Буря" /
// gt23, 3 = "Святая Торпеда" / gt24) from shipID at targetRef. The server debits
// one ammunition unit of the class's goods type and spawns a homing torpedo;
// returns the server-allocated torpedo id. Throws ApiError on a non-2xx (no
// ammunition → 400, no up_torpedo_launcher → 422). Phase 10.3.5.
export async function sendLaunchTorpedo(
  shipID: number,
  targetRef: EntityRef,
  torpedoClass: number,
): Promise<{ torpedoID: number }> {
  const res = await fetch('/api/cmd/launch-torpedo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef, class: torpedoClass }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; torpedoID: number };
  return { torpedoID: body.torpedoID };
}

// sendPickupContainer scoops a loot container into the ship's hold. The
// server validates ownership, proximity (PickupRange) and capacity; throws
// ApiError on a non-2xx (e.g. 400 out of range, 409 hold full).
export async function sendPickupContainer(
  shipID: number,
  containerID: number,
): Promise<void> {
  const res = await fetch('/api/cmd/pickup-container', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, containerID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// sendInstallSatellite deploys one navigation satellite from shipID's cargo at
// the ship's current position (phase 10.15). The server consumes 1× goods id 26
// and persists the satellite; throws ApiError on a non-2xx (e.g. 400 no
// satellite in cargo, 400 ship docked).
export async function sendInstallSatellite(
  shipID: number,
): Promise<{ satelliteID: number }> {
  const res = await fetch('/api/cmd/install-satellite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; satelliteID: number };
  return { satelliteID: body.satelliteID };
}

// sendMine arms sustained ore mining on shipID against the given asteroid, or
// stops it when asteroidID is 0 (phase 10.3.6). The server only sets the
// intent; the per-tick drilling, drill gate (up_drill), range check and energy
// gate run in the sector worker. Throws ApiError on a non-2xx — notably 422
// when the ship lacks a mining drill (the menu gates the button to avoid this),
// 404 asteroid gone, 400 out of range / docked.
export async function sendMine(shipID: number, asteroidID: number): Promise<void> {
  const res = await fetch('/api/cmd/mine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, asteroidID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

export type WorldSector = {
  id: number;
  name: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  // gridX/gridY place the sector on the schematic galaxy map (StarWind
  // pos_x/pos_y); race tints it (0 = neutral). See GalaxyMap.
  gridX: number;
  gridY: number;
  race: number;
};

export type WorldGate = {
  id: number;
  sectorA: number;
  posAX: number;
  posAY: number;
  sectorB: number;
  posBX: number;
  posBY: number;
};

export type WorldResponse = {
  sectors: WorldSector[];
  gates: WorldGate[];
};

export async function fetchWorld(): Promise<WorldResponse> {
  const res = await fetch('/api/world');
  if (!res.ok) {
    throw new Error(`GET /api/world ${res.status}`);
  }
  return (await res.json()) as WorldResponse;
}

export function wsURL(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

// ApiError carries the parsed `error` field the backend returns on every
// non-2xx JSON response. UI components show err.message instead of the raw
// `Error: POST /api/... 400: {"error":"..."}` chain produced by Error().
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

// jumpDriveErrorText turns a sendJumpDrive failure into a Russian, human-
// readable line for the galaxy-map footer / Journal (TASK-129). It branches on
// the HTTP status ApiError carries and — for the two statuses the backend
// overloads — on a substring of its English sentinel text: the same 422 covers
// both "no jump drive" and "shield generator damaged", and the same 400 covers
// both "jump blocked in this sector" and "invalid target sector". The backend
// does not distinguish these by status alone, so keying on the English wording
// ("shield" / "blocked") is a deliberate, documented coupling to those
// sentinels (see the error table in TASK-129). Non-ApiError inputs (a thrown
// Error, a rejected non-Error value) fall back to String(err).
export function jumpDriveErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return String(err);
  const msg = err.message.toLowerCase();
  switch (err.status) {
    case 404:
      return 'Корабль не найден.';
    case 403:
      return 'Это не ваш корабль.';
    case 409:
      return 'Нельзя прыгнуть пристыкованным — сначала отстыкуйтесь.';
    case 422:
      // Overloaded status: "shield" sentinel → damaged/missing shield generator,
      // otherwise the ship simply has no up_jump_drive fitted.
      return msg.includes('shield')
        ? 'Нужен исправный генератор щита.'
        : 'На корабле нет прыжкового двигателя (up_jump_drive).';
    case 429:
      return 'Прыжковый двигатель ещё не готов — идёт перезарядка.';
    case 400:
      // Overloaded status: "blocked" sentinel → this sector forbids jumping out,
      // otherwise the target sector is invalid (own sector / unknown / bad json).
      return msg.includes('blocked')
        ? 'Прыжок из этого сектора запрещён.'
        : 'Недопустимый сектор назначения.';
    case 503:
      return 'Сектор занят, попробуйте ещё раз.';
    case 504:
      return 'Команда не успела выполниться, попробуйте ещё раз.';
    default:
      return err.message;
  }
}

async function requireOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const msg = await parseErrorBody(res);
  throw new ApiError(res.status, `${label}: ${msg}`);
}

// --- Player ----------------------------------------------------------------
// Returned by GET /api/player/me. Cash is the wallet balance in credits.
export type PlayerSelf = {
  playerID: number;
  login: string;
  cash: number;
  // activeShipID is the ship the player currently controls (10.14a). null
  // when unset — the SPA then falls back to the lowest-id owned ship.
  activeShipID: number | null;
  // passengerOfShipID is the host ship the player rides as a passenger (10.23),
  // or null. When set, the HUD follows the host read-only and offers «Высадиться».
  passengerOfShipID: number | null;
};

export async function fetchPlayerSelf(): Promise<PlayerSelf> {
  const res = await fetch('/api/player/me');
  await requireOk(res, 'GET /api/player/me');
  return (await res.json()) as PlayerSelf;
}

// fetchFleet lists every ship the player owns across all sectors (10.14a). Each
// ship reuses the snapshot Ship shape, so shipDisplayName/class-catalog labelling
// applies. The fleet panel renders these with a "make active" action.
export async function fetchFleet(): Promise<Ship[]> {
  const res = await fetch('/api/player/ships');
  await requireOk(res, 'GET /api/player/ships');
  const body = (await res.json()) as { ships: Ship[] };
  return body.ships ?? [];
}

// --- Goods catalog ---------------------------------------------------------
// Loaded once at app start. Used by MarketView/CargoView/AuctionView to
// turn typeID into a human-readable name and the per-unit cargo footprint.
export type GoodsRow = {
  typeID: number;
  name: string;
  space: number;
};

export async function fetchGoodsCatalog(): Promise<GoodsRow[]> {
  const res = await fetch('/api/goods');
  await requireOk(res, 'GET /api/goods');
  const body = (await res.json()) as { items: GoodsRow[] };
  return body.items ?? [];
}

// --- Race reference --------------------------------------------------------
// Loaded once at app start. Maps the `race` field carried by every static
// (station/shipyard/trade-station/pirbase/laser-tower) to a display name and
// the canonical js/map.js palette colour. Phase 8.13.
export type Race = {
  id: number;
  name: string;
  stateName: string;
  color: string;
};

export async function fetchRaces(): Promise<Race[]> {
  const res = await fetch('/api/races');
  await requireOk(res, 'GET /api/races');
  const body = (await res.json()) as { items: Race[] };
  return body.items ?? [];
}

// --- Race standing (phase 9.4) ---------------------------------------------

// RaceStanding is the player's reputation with one race, plus the wanted flag.
export type RaceStanding = {
  race: number;
  standing: number;
  wanted: boolean;
};

export type RaceStandings = {
  items: RaceStanding[];
  wantedThreshold: number;
};

export async function fetchRaceStandings(): Promise<RaceStandings> {
  const res = await fetch('/api/my/race-standings');
  await requireOk(res, 'GET /api/my/race-standings');
  const body = (await res.json()) as RaceStandings;
  return { items: body.items ?? [], wantedThreshold: body.wantedThreshold };
}

// PoliceScanFrame is the per-player WS frame pushed when a race's police
// confiscate contraband from the player's ship (phase 9.4).
export type PoliceScanFrame = {
  type: 'police_scan';
  race: number;
  sectorId: number;
  goodsType: number;
  quantity: number;
  wanted: boolean;
};

// ShipCaptureFrame is the per-player WS frame pushed after a capture roll
// (TASK-100.3.9.5). Both participants receive one: the attacker gets captor=true
// (success = the roll), the old owner gets captor=false, success=true. Drives
// the journal line in useShipCaptureLog.
export type ShipCaptureFrame = {
  type: 'ship_capture';
  shipId: number;
  sectorId: number;
  captor: boolean;
  success: boolean;
};

// StationHackedFrame is the per-player WS frame pushed to the hacker after a
// station raid (TASK-100.3.9.6). robbed > 0 → "Похищено N ед."; robbed === 0 →
// "Неудачная попытка взлома" (only the damage landed). goodsType names the
// richest good the raid targeted. Drives the journal line in useStationHackedLog.
export type StationHackedFrame = {
  type: 'station_hacked';
  shipId: number;
  sectorId: number;
  stationId: number;
  race: number;
  goodsType: number;
  robbed: number;
};

// --- Cargo -----------------------------------------------------------------
export type CargoItem = {
  typeID: number;
  quantity: number;
};

export type CargoInventory = {
  ownerKind: number;
  ownerID: number;
  capacity: number;
  used: number;
  items: CargoItem[];
};

function cargoEndpoint(ref: EntityRef): string {
  switch (ref.kind) {
    case EntityKind.Ship:
      return `/api/ship/${ref.id}/cargo`;
    case EntityKind.Station:
      return `/api/station/${ref.id}/cargo`;
    case EntityKind.TradeStation:
      return `/api/trade-station/${ref.id}/cargo`;
    default:
      throw new ApiError(400, `cargo not available for kind ${ref.kind}`);
  }
}

export async function fetchCargo(owner: EntityRef): Promise<CargoInventory> {
  const res = await fetch(cargoEndpoint(owner));
  await requireOk(res, `GET ${cargoEndpoint(owner)}`);
  return (await res.json()) as CargoInventory;
}

export async function sendMoveCargo(
  from: EntityRef,
  to: EntityRef,
  typeID: number,
  quantity: number,
): Promise<void> {
  const res = await fetch('/api/cmd/cargo/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, typeID, quantity }),
  });
  await requireOk(res, 'POST /api/cmd/cargo/move');
}

// --- Market / Trade --------------------------------------------------------
// MarketEntry mirrors traderepo.MarketEntry. Either price may be null when
// the station only buys or only sells the good. Stock is the current
// quantity the station holds; MaxStock is the soft cap on accumulation.
export type MarketEntry = {
  typeID: number;
  buyPrice: number | null;
  sellPrice: number | null;
  stock: number;
  maxStock: number;
};

// ProductionInfo mirrors dto.ProductionInfo. Present only for producing
// factories (EntityKind.Station with a recipe). secondsRemaining counts
// down to the end of the in-progress cycle (0 when idle); cycleSeconds is
// the full recipe cycle length, both anchored server-side at fetch time.
export type ProductionInfo = {
  inProgress: boolean;
  secondsRemaining: number;
  cycleSeconds: number;
};

export type MarketResponse = {
  ownerKind: number;
  ownerID: number;
  items: MarketEntry[];
  production?: ProductionInfo;
};

function marketEndpoint(ref: EntityRef): string {
  switch (ref.kind) {
    case EntityKind.Station:
      return `/api/station/${ref.id}/market`;
    case EntityKind.TradeStation:
      return `/api/trade-station/${ref.id}/market`;
    case EntityKind.Pirbase:
      return `/api/pirbase/${ref.id}/market`;
    default:
      throw new ApiError(400, `market not available for kind ${ref.kind}`);
  }
}

export async function fetchMarket(owner: EntityRef): Promise<MarketResponse> {
  const res = await fetch(marketEndpoint(owner));
  await requireOk(res, `GET ${marketEndpoint(owner)}`);
  return (await res.json()) as MarketResponse;
}

export type TradeAck = {
  newCash: number;
  newStock: number;
  moved: number;
  unitPrice: number;
  totalAmount: number;
};

export async function sendBuy(
  shipID: number,
  station: EntityRef,
  typeID: number,
  qty: number,
): Promise<TradeAck> {
  const res = await fetch('/api/cmd/trade/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, station, typeID, qty }),
  });
  await requireOk(res, 'POST /api/cmd/trade/buy');
  return (await res.json()) as TradeAck;
}

export async function sendSell(
  shipID: number,
  station: EntityRef,
  typeID: number,
  qty: number,
): Promise<TradeAck> {
  const res = await fetch('/api/cmd/trade/sell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, station, typeID, qty }),
  });
  await requireOk(res, 'POST /api/cmd/trade/sell');
  return (await res.json()) as TradeAck;
}

// --- Sector price scanner (trade_up) --------------------------------------
// ScanGood mirrors dto.ScanGood. priceLevel ("high"/"medium"/"low") is always
// present (module level 1+); buyPrice/sellPrice are real only at level >=2 and
// arrive as 0 below that; stock is real only at level >=3, else 0. The zeros
// are intentional masks — branch on the response level, not on the values.
export type ScanGood = {
  typeID: number;
  priceLevel: 'high' | 'medium' | 'low';
  buyPrice: number;
  sellPrice: number;
  stock: number;
  // forecastStock / forecastPrice are the projected stock and dynamic price
  // after a production horizon, revealed only at trade_up level 4 (0 below that,
  // and 0 for non-producing stations) — phase 10.3.22.
  forecastStock: number;
  forecastPrice: number;
};

// ScanStation is one tradeable station's price board in the player's sector.
// name is a generic per-kind fallback; stationType is the station_types catalog
// id of a production station (0 for trade-stations / pirbases) so the UI can
// resolve a precise type name and tell several factories in one sector apart.
export type ScanStation = {
  owner: EntityRef;
  name: string;
  stationType: number;
  pos: { x: number; y: number };
  goods: ScanGood[];
};

// ScanResponse is the body of GET /api/market-scan. level echoes the active
// ship's trade_up level so the UI knows how much detail to render.
export type ScanResponse = {
  level: number;
  stations: ScanStation[];
};

// fetchMarketScan reads the trade_up sector price-scan for the player's active
// ship. 403 when no trade_up module is fitted — the caller only calls this when
// the ship carries one, so a 403 surfaces as an ApiError the block can hide on.
export async function fetchMarketScan(): Promise<ScanResponse> {
  const res = await fetch('/api/market-scan');
  await requireOk(res, 'GET /api/market-scan');
  return (await res.json()) as ScanResponse;
}

// --- Auction ---------------------------------------------------------------
export type AuctionLot = {
  id: number;
  sellerID: number;
  goodsTypeID: number;
  quantity: number;
  source: EntityRef;
  startPrice: number;
  currentPrice: number;
  currentBidderID?: number;
  endsAt: string;
  status: number;
  createdAt: string;
};

export async function fetchAuctionLots(): Promise<AuctionLot[]> {
  const res = await fetch('/api/auction');
  await requireOk(res, 'GET /api/auction');
  const body = (await res.json()) as { lots: AuctionLot[] };
  return body.lots ?? [];
}

// fetchMyAuctionLots returns lots the player is involved in (as seller or
// current high bidder), any status — for the "Мои лоты/ставки" view.
export async function fetchMyAuctionLots(): Promise<AuctionLot[]> {
  const res = await fetch('/api/auction/mine');
  await requireOk(res, 'GET /api/auction/mine');
  const body = (await res.json()) as { lots: AuctionLot[] };
  return body.lots ?? [];
}

export async function sendAuctionCreate(params: {
  source: EntityRef;
  goodsTypeID: number;
  quantity: number;
  startPrice: number;
  durationSeconds: number;
}): Promise<AuctionLot> {
  const res = await fetch('/api/auction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  await requireOk(res, 'POST /api/auction');
  return (await res.json()) as AuctionLot;
}

export type AuctionBidAck = {
  newPrice: number;
  newLeader: boolean;
};

export async function sendAuctionBid(
  lotID: number,
  shipID: number,
  amount: number,
): Promise<AuctionBidAck> {
  const res = await fetch(`/api/auction/${lotID}/bid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, amount }),
  });
  await requireOk(res, `POST /api/auction/${lotID}/bid`);
  return (await res.json()) as AuctionBidAck;
}

// --- Quests ----------------------------------------------------------------
// Returned by GET /api/quests/active. The backend quest engine (phase 8.12)
// lazy-starts the tutorial on first read and reconciles progress from game
// state every few seconds; the client just polls and renders the objective.
// `null` means no active quest (all done / none assigned).
// ActiveQuest is one active/recent quest from GET /api/quests/active (phase
// 8.17: now a list, with event-step counter, deadline and failed status).
export type ActiveQuest = {
  questId: string;
  title: string;
  status: string;
  stepIndex: number;
  totalSteps: number;
  stepDesc: string;
  stepReward: number;
  stepGoal: number; // event-step target (0 = polled step)
  stepProgress: number; // counter toward stepGoal
  deadlineUnix: number; // 0 = no deadline
  done: boolean;
  failed: boolean;
};

export async function fetchActiveQuests(): Promise<ActiveQuest[]> {
  const res = await fetch('/api/quests/active');
  await requireOk(res, 'GET /api/quests/active');
  return ((await res.json()) as ActiveQuest[]) ?? [];
}

// OfferableQuest is a quest the player can accept (GET /api/quests/offerable).
export type OfferableQuest = {
  questId: string;
  title: string;
  totalSteps: number;
};

export async function fetchOfferableQuests(): Promise<OfferableQuest[]> {
  const res = await fetch('/api/quests/offerable');
  await requireOk(res, 'GET /api/quests/offerable');
  return ((await res.json()) as OfferableQuest[]) ?? [];
}

export async function acceptQuest(questId: string): Promise<void> {
  const res = await fetch(`/api/quests/${encodeURIComponent(questId)}/accept`, { method: 'POST' });
  await requireOk(res, `POST /api/quests/${questId}/accept`);
}

export async function abandonQuest(questId: string): Promise<void> {
  const res = await fetch(`/api/quests/${encodeURIComponent(questId)}/abandon`, { method: 'POST' });
  await requireOk(res, `POST /api/quests/${questId}/abandon`);
}

// --- Ship classes ----------------------------------------------------------
// Returned by GET /api/ship-classes — the static ct_ship_classes catalog
// (phase 8.14). Loaded once; used to label ships by class/name and, later,
// to drive the shipyard buy screen. `category` is the X-universe code
// (M1/M2/M3/M4/M5/M6/TL/TS/XX); `categoryLabel` is its Russian name.
export type ShipClass = {
  id: number;
  race: number;
  type: number;
  class: number;
  category: string;
  categoryLabel: string;
  name: string;
  speed: number;
  acceleration: number;
  laser: number;
  shield: number;
  hull: number;
  cargobay: number;
  basePrice: number;
  pilotCabin: number;
};

export async function fetchShipClasses(): Promise<ShipClass[]> {
  const res = await fetch('/api/ship-classes');
  await requireOk(res, 'GET /api/ship-classes');
  const body = (await res.json()) as { items: ShipClass[] };
  return body.items;
}

// Returned by GET /api/station-types — the static station_types catalog
// (phase 8.15). Loaded once; used to show a docked station's human-readable
// type name. `kind` is the object class (0 trade station / 1 shipyard /
// 2 factory / 3 rebuildable); `kindLabel` is its Russian name.
export type StationType = {
  id: number;
  name: string;
  race: number;
  kind: number;
  kindLabel: string;
  sellable: boolean;
};

export async function fetchStationTypes(): Promise<StationType[]> {
  const res = await fetch('/api/station-types');
  await requireOk(res, 'GET /api/station-types');
  const body = (await res.json()) as { items: StationType[] };
  return body.items ?? [];
}

// Returned by GET /api/equipment — the static ct_updates catalog (phase 8.16).
// `type` is the module key (up_engine/up_shield/…); `position` is the slot
// (1 inner, 2 outer); `dependance` is the module it switches off with.
// Consumed by the (future) outfitting screen.
export type Equipment = {
  id: number;
  type: string;
  description: string;
  maxLevel: number;
  race: number;
  shipClass: number;
  price: number;
  pricePerLevel: number;
  isBase: boolean;
  position: number;
  dependance: string;
  energyUseType: string;
  energyUsage: number;
};

export async function fetchEquipment(): Promise<Equipment[]> {
  const res = await fetch('/api/equipment');
  await requireOk(res, 'GET /api/equipment');
  const body = (await res.json()) as { items: Equipment[] };
  return body.items ?? [];
}
