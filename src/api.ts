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
  Container: 8,
  Satellite: 11,
  // Torpedo is a shoot-downable projectile (TASK-100.3.5.6): unlike a missile it
  // carries HP, so a weapon can be aimed at it — TASK-112 made that reachable.
  Torpedo: 12,
  Jammer: 13,
  Gate: 14,
} as const;

// isStaticTargetKind mirrors the server's sector.IsStaticTargetKind (TASK-113
// FR-01): the destructible statics a weapon may lock onto besides ships —
// stations, shipyards, trade stations, pirbases, laser towers, satellites,
// jammers and, since TASK-110, gates. Containers and asteroids are not statics.
// One source of truth for the weapon-button gates so the UI never offers a target
// the server would reject with ErrInvalidAttackTarget.
export function isStaticTargetKind(kind: number): boolean {
  return (
    kind === EntityKind.Station ||
    kind === EntityKind.Shipyard ||
    kind === EntityKind.TradeStation ||
    kind === EntityKind.Pirbase ||
    kind === EntityKind.LaserTower ||
    kind === EntityKind.Satellite ||
    kind === EntityKind.Jammer ||
    kind === EntityKind.Gate
  );
}

// isMissileTargetKind mirrors the server's sector.IsMissileTargetKind (TASK-111):
// a missile reaches wider than the laser and the torpedo — every destructible
// static plus a loot container, which is destroyed with its cargo (denying an
// enemy their loot). Lasers and torpedoes stay off crates, so they keep using
// isStaticTargetKind.
export function isMissileTargetKind(kind: number): boolean {
  return isStaticTargetKind(kind) || kind === EntityKind.Container;
}

// isDockableStaticKind reports whether a 'dock'-category target is one a ship
// can actually dock at. Satellites (10.15), laser towers (TASK-113) and
// hyper-interference generators (TASK-131) ride the same static path but take
// no ship — the server's lookupStatic does not resolve them. One source of
// truth so the navigation panel's ⚓ affordance and the object menu's
// «Стыковка» item can never disagree (they did for jammers, which are deployed
// at distance 0 and so were always inside the dock range).
export function isDockableStaticKind(kind: number): boolean {
  return (
    kind !== EntityKind.Satellite &&
    kind !== EntityKind.LaserTower &&
    kind !== EntityKind.Jammer
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
  // destructibles is the live combat state of every static in the sector,
  // returned by GET /api/state next to `statics` (TASK-186). The hp inside
  // `statics` is the spawn layout; this is what the object has left.
  destructibles?: DestructibleStatic[];
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

// staticKey keys the static-combat map by kind+id (phase 6.2b). Lives here
// because both producers of that map are here now: the welcome frame's full set
// (staticCombatMap) and the per-tick staticsUpdated/staticsRemoved delta in
// useWorldState.
export const staticKey = (r: EntityRef): string => `${r.kind}:${r.id}`;

// staticCombatMap indexes a `statics` frame's destructibles list for lookup by
// `${kind}:${id}` — the key CombatHUD and ObjectLayer read live hull/shield
// under. A missing list yields an empty map, which is what a sector with no
// statics sends.
//
// The frame is authoritative and total for its sector: the server sends it on
// subscribe and again on every jump, and it carries every live static. So the
// client seeds this map from it instead of clearing (TASK-186) — before that,
// a reload or a jump there and back left the map empty and the HUD had nothing
// but the spawn layout to print.
export function staticCombatMap(list: DestructibleStatic[] | undefined): Map<string, DestructibleStatic> {
  const out = new Map<string, DestructibleStatic>();
  for (const d of list ?? []) out.set(staticKey(d.ref), d);
  return out;
}

// Static dockable objects of a sector — stations (factories), shipyards,
// trade stations and pirbases. Sent over WS as a dedicated `statics` frame right
// after subscribe and again on every sector change, and embedded in HTTP
// /api/state.
//
// These are the sector's LAYOUT: the position/type/owner fields hold for the
// session, and `hp`/`shield` here are the values the object was built with — not
// what it has left. The live figures ride in the same frame's `destructibles`
// and in the per-tick staticsUpdated delta (TASK-186); a destroyed object leaves
// the layout through staticsRemoved. So read `hp` here only as the bar's
// denominator, never as the target's current hull.

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

// Jammer is a player-deployed hyper-interference generator (TASK-131): a
// destructible static that blocks the seamless jump drive of every ship within
// its zone while alive. Deployed via sendInstallJammer.
export type Jammer = {
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
  jammers?: Jammer[];
};

// StaticObject is the shape every SectorStatics list shares. Written out rather
// than derived from the seven types above so staticListOf has one return type to
// name; `type` is optional because only stations and trade stations carry a
// subtype. Not shipyards — Shipyard has no `type` field at all, which is why
// gameContext.resolveStation passes `undefined` rather than `hit?.type` in its
// Shipyard branch.
export type StaticObject = {
  id: number;
  sectorID: number;
  x: number;
  y: number;
  hp: number;
  shield: number;
  race: number;
  built: boolean;
  type?: number;
};

// staticListOf resolves the SectorStatics list an EntityRef of a static kind
// lives in — the single mapping from kind to array, next to isStaticTargetKind /
// isDockableStaticKind for the same reason: a new static type must be taught to
// the client in exactly one place.
//
// It used to be four hand-copied mappings over the same seven kinds — three
// switches (SectorView.selectedStaticList for the panel row + canvas ring,
// ObjectLayer.staticList for marker positions, CombatHUD.findStatic for the target
// caption) and a nested ternary in SectorCanvas.visibleMenu that decides whether a
// canvas object's menu opens at all and then stays open. The copies drifted every
// single time a static type was added — satellites (10.15), laser towers (4.5),
// jammers (TASK-131). The
// jammer case is what TASK-165 came from: present in ObjectLayer, absent in
// SectorView, and because SectorView runs first the ObjectLayer case was dead code
// and the generator got no selected highlight at all.
//
// An unknown kind returns undefined — Gate and Container reach the navigation
// panel as targets but are not in SectorStatics, and callers already treat
// undefined as "nothing to highlight".
//
// "Single" covers resolving one list from one kind, which is what drifted. It does
// not cover the places that walk all seven fields by name and never branch on a
// kind: useWorldState.removeStaticsByRefs / mergeStatics / staticsEmpty,
// ObjectLayer's marker table and its render loops, TargetsPanel's row builders.
// Those are field walks, and folding them through a kind lookup would need a cast
// per assignment to convince tsc the element type still matches.
//
// sectorViewport.computeMaxBounds used to be listed with them and does NOT belong
// there: it folds four lists — stations, shipyards, tradeStations, pirbases — plus
// gates, and has never seen laserTowers, satellites or jammers. Left as it is on
// purpose. Max is the default zoom and computeViewport recomputes its box from
// props.statics every frame, so folding in a destructible tower or a
// player-deployed satellite would re-frame the whole sector the moment one is
// deployed or shot down. The price is that a deployable outside that box sits
// off-canvas at Max zoom, and Near / fit-to-radar (TASK-122) or the navigation
// row are how it is reached. Worth stating because the line above reads as a
// checklist: nobody should tick computeMaxBounds off as "this one already walks
// all seven, add mine next to them" — there was never a seventh field in it.
//
// The result is readonly because it is not a copy: it is `statics.stations` (or
// whichever list) handed back under a wider element type, and a push through that
// alias would put a StaticObject in an array the rest of the SPA reads as
// Station[]. Every caller only searches it.
//
// StaticObject deliberately stops at the fields all seven lists share, which is
// why gameContext.resolveStation still indexes statics.stations / .shipyards /
// .tradeStations by hand: it needs ownerID, which lives on the per-type types and
// not here. Its fourth branch, Pirbase, indexes no list at all — a pirbase has no
// ownerID to look up — so resolveStation is a narrower shape, not a caller this
// helper forgot.
//
// STATIC_LIST_KIND is the mapping itself, and it is keyed by the SectorStatics
// field rather than by the kind for one reason: `Record<keyof SectorStatics, …>`
// makes tsc demand an entry per declared list, so adding `mines?: Mine[]` to
// SectorStatics stops THIS file compiling until the kind is named. A switch on the
// kind could not do that — a missing case just returns undefined, silently, which
// is exactly how the jammer went missing. Exported because api.test.ts needs the
// field set at runtime (types are erased before node --test sees it), and node
// --test is the gate that then demands the new list be reachable.
export const STATIC_LIST_KIND: Record<keyof SectorStatics, number> = {
  stations: EntityKind.Station,
  shipyards: EntityKind.Shipyard,
  tradeStations: EntityKind.TradeStation,
  pirbases: EntityKind.Pirbase,
  laserTowers: EntityKind.LaserTower,
  satellites: EntityKind.Satellite,
  jammers: EntityKind.Jammer,
};

// Inverted once at module load — lookups run per frame (marker resolution, menu
// visibility), the table is seven entries and never changes.
const STATIC_LIST_FIELD = new Map<number, keyof SectorStatics>(
  (Object.entries(STATIC_LIST_KIND) as [keyof SectorStatics, number][]).map(([field, kind]) => [
    kind,
    field,
  ]),
);

export function staticListOf(
  statics: SectorStatics,
  kind: number,
): readonly StaticObject[] | undefined {
  const field = STATIC_LIST_FIELD.get(kind);
  return field === undefined ? undefined : statics[field];
}

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
  // destructibles is the live hull/shield of every static in the sector, in the
  // same shape the per-tick staticsUpdated delta uses. `statics` above is the
  // spawn layout: its hp is what the object was built with, so it is the bar's
  // denominator, never its value (TASK-186).
  destructibles?: DestructibleStatic[];
};

export type PlayerSummary = {
  playerID: number;
  login: string;
};

export async function fetchState(): Promise<Snapshot> {
  const res = await netFetch('/api/state');
  if (!res.ok) {
    throw new Error(`GET /api/state ${res.status}`);
  }
  return (await res.json()) as Snapshot;
}

// ApiError with the bare backend message rather than requireOk. Both work here,
// and not because of a mapper: of the three callers only one maps at all.
// bounties/BountiesPage (:21, :34) hands the board load to friendlyError;
// GameLayout (:83) console.errors and shows nothing, because the rail's login map
// is optional decoration; clans/MyClanView (:38) swallows it outright so the invite
// dropdown just stays empty. So the shape here is the in-space senders' shape, kept
// for uniformity with them, and it costs the one mapping caller nothing because
// friendlyError strips requireOk's route label anyway. See fetchWorld below for the
// same call decided the other way, and the in-space header for the group where the
// choice is not free.
export async function fetchPlayers(): Promise<PlayerSummary[]> {
  const res = await netFetch('/api/players');
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as PlayerSummary[];
}

// --- In-space commands -----------------------------------------------------
// Fifteen senders throw `new ApiError(res.status, await parseErrorBody(res))` —
// the same shape as sendLaunchMissile / sendLaunchDrone / sendLaunchTorpedo /
// sendPickupContainer / sendMine below, and deliberately NOT requireOk (TASK-168).
// By name, because "everything from here to sendCeaseFire" is not the rule and
// reading it that way would undo a decision: sendMove, sendSetCourse, sendJump,
// sendJumpDrive, sendDock, sendUndock, disembark, setShipAccess, exitShip,
// activateShip, sellShip, sendAttack, sendCapture, sendHack, sendCeaseFire.
//
// Six requireOk senders sit among them and must stay that way: claimStation
// (StationView → commandErrorText), getShipAtShipyard (StationView →
// friendlyError), postShipyard behind buyShip / installEquipment /
// uninstallEquipment (ShipyardView → commandErrorText) and boardShip (HangarView →
// friendlyError, plus its own note below — eva.go answers a Russian sentinel
// there). Each has a caller that maps the failure, and a mapper strips requireOk's
// route label; that is the whole difference between the two groups, not their
// position in the file.
//
// The fifteen used to read the body with res.text() and put the whole
// `POST /api/cmd/dock 400: {"error":"out of dock range"}` string in the thrown
// message, JSON envelope and all. Where that string actually reached the player is
// worth splitting three ways, since only the first group is why this shape is the
// rule:
//   - printed raw, envelope and all (7): sendMove, sendJump, sendDock, sendAttack,
//     sendCapture, sendHack, sendCeaseFire — ObjectActionsMenu.formatError (which
//     also writes it to the event journal), TargetsPanel.onRowClick, SpacePointMenu
//     and CombatHUD.run all render err.message with no mapper.
//   - mapped by the caller (4): sendSetCourse and sendJumpDrive (GalaxyMap /
//     SetCoursePanel → friendlyError / jumpDriveErrorText), activateShip and
//     sellShip (fleet/useFleet → friendlyError / commandErrorText). Either shape
//     would read fine here; they keep this one so the group stays uniform.
//   - shown to nobody (4): sendUndock, disembark, setShipAccess, exitShip reach only
//     PilotPanel, which console.errors and puts nothing on screen, so for these the
//     conversion only cleans up what a developer reads in the console.
// requireOk would fix the envelope but add its own `POST /api/…: ` label, which the
// raw-printing views do not strip. So these get the bare backend message, and the
// route stays where it is useful — the browser's network panel.
export async function sendMove(
  shipID: number,
  x: number,
  y: number,
  targetRef?: EntityRef,
): Promise<void> {
  const res = await netFetch('/api/cmd/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, x, y, targetRef }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
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
  const res = await netFetch('/api/cmd/set-course', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, sectorID, x, y, approach }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as SetCourseResponse;
}

export async function sendJump(shipID: number, gateID: number): Promise<void> {
  const res = await netFetch('/api/cmd/jump', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, gateID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// sendJumpDrive fires the seamless up_jump_drive jump (TASK-100.3.7): the ship
// is thrown into a random point near the centre of targetSectorID — the player
// picks only the sector, not a position. Throws ApiError on a non-2xx so the
// caller can pass it to jumpDriveErrorText for a Russian, human-readable line —
// and note that 502/504 mean "outcome unknown", not "nothing happened": the
// command may already be in the worker's inbox. A caller must not print
// err.message itself; the mapper is the one place that decides the wording, and
// it still returns the backend's English message verbatim for the statuses it
// does not word (TASK-185 territory), so a raw body reaches the screen only
// where nobody has chosen a line for it yet.
export async function sendJumpDrive(shipID: number, targetSectorID: number): Promise<void> {
  const res = await netFetch('/api/cmd/jump-drive', {
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
  const res = await netFetch(`/api/stations/${stationID}/claim`, { method: 'POST' });
  await requireOk(res, `POST /api/stations/${stationID}/claim`);
}

// getShipAtShipyard exchanges the player's spacesuit (docked at the shipyard)
// for a fresh starter ship at the same spot (phase 10.2). Free for now.
export async function getShipAtShipyard(shipyardID: number): Promise<void> {
  const res = await netFetch(`/api/shipyard/${shipyardID}/get-ship`, { method: 'POST' });
  await requireOk(res, `POST /api/shipyard/${shipyardID}/get-ship`);
}

// --- Shipyard purchase + outfitting (phase 10.14) --------------------------

// BuyShipAck is the body of POST /api/shipyard/{id}/buy-ship on success: the
// new ship id and the player's debited wallet balance.
export type BuyShipAck = { ok: boolean; shipID: number; cash: number };

// OutfitAck is the body of install-/uninstall-equipment: the new wallet and
// the ship's full installed-equipment list after the change.
export type OutfitAck = { ok: boolean; cash: number; equipment: InstalledEquipment[] };

// postShipyard POSTs a JSON body and unwraps the {error} message on failure,
// mirroring getShipAtShipyard's error handling. It throws ApiError rather than a
// plain Error so commandErrorText can see the status: a ship costs up to ~1.2M
// cr, and only the status tells «отказано» apart from «ответа нет».
async function postShipyard<T>(url: string, body: unknown): Promise<T> {
  const res = await netFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await requireOk(res, `POST ${url}`);
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
  const res = await netFetch('/api/cmd/dock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, target }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

export async function sendUndock(shipID: number): Promise<void> {
  const res = await netFetch('/api/cmd/undock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// boardShip moves the player out of their spacesuit into a target ship (10.23):
// own ship → take control; NPC / another player's open ship → ride as a
// passenger. Returns the resulting mode. Callers refreshPlayer afterwards so the
// HUD/own-ship (and passenger state) re-resolve.
//
// requireOk, not res.text(): eva.go answers {"error":"вход на этот корабль
// закрыт"} and the raw body put that JSON envelope on screen verbatim when the
// player raced the isOpen snapshot in the hangar (found in review of TASK-140).
export async function boardShip(targetShipID: number): Promise<{ mode: 'control' | 'passenger' }> {
  const res = await netFetch('/api/cmd/board-ship', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetShipID }),
  });
  await requireOk(res, 'POST /api/cmd/board-ship');
  return (await res.json()) as { mode: 'control' | 'passenger' };
}

// disembark drops a passenger off their host ship into a spacesuit at the host's
// current spot (10.23). Returns the new spacesuit id. Callers refreshPlayer
// afterwards so ownShip / passenger state re-resolve.
export async function disembark(): Promise<{ shipID: number }> {
  const res = await netFetch('/api/cmd/disembark', { method: 'POST' });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as { shipID: number };
}

// setShipAccess toggles whether other players may board the caller's ship as a
// passenger (10.23). The WS snapshot reflects the new isOpen on the next tick,
// so callers don't need to refresh.
export async function setShipAccess(shipID: number, open: boolean): Promise<void> {
  const res = await netFetch('/api/cmd/ship-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, open }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// exitShip drops the player out of their ship into a spacesuit at the ship's
// current spot (10.23): docked at a station → the suit stays in the hangar; in
// space → the suit floats free. Returns the new spacesuit id. Callers
// refreshPlayer afterwards so ownShip re-resolves to the suit.
export async function exitShip(shipID: number): Promise<{ shipID: number }> {
  const res = await netFetch('/api/cmd/exit-ship', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as { shipID: number };
}

// activateShip switches the player's active ship (10.14a). After it resolves,
// callers refreshPlayer() so the HUD/own-ship picks up the new activeShipID;
// the WS follows the ship into its sector via a server-published handoff.
export async function activateShip(shipID: number): Promise<void> {
  const res = await netFetch(`/api/ship/${shipID}/activate`, { method: 'POST' });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// sellShip trades a ship in at the shipyard it is docked at (10.14a) for a
// fraction of its base price. Returns the new wallet balance. The ship must be
// owned, docked at this shipyard, not the active ship, and not the last one.
export async function sellShip(shipyardID: number, shipID: number): Promise<{ cash: number }> {
  const res = await netFetch(`/api/shipyard/${shipyardID}/sell-ship`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as { cash: number };
}

export async function sendAttack(shipID: number, targetRef: EntityRef): Promise<void> {
  const res = await netFetch('/api/cmd/attack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// sendCapture attempts to seize a hostile ship with the attacker's up_capture
// module (POST /api/cmd/capture, TASK-100.3.9.5). Body mirrors sendAttack
// (attacker shipID + target EntityRef); the server resolves the energy cost and
// gates on module/shield/range/relation. A 2xx means the roll was performed —
// the win/lose journal line arrives asynchronously on the WS ship_capture frame,
// so this resolves void like sendAttack and surfaces only the 4xx as an error.
export async function sendCapture(shipID: number, targetRef: EntityRef): Promise<void> {
  const res = await netFetch('/api/cmd/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
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
  const res = await netFetch('/api/cmd/hack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

export async function sendCeaseFire(shipID: number): Promise<void> {
  const res = await netFetch('/api/cmd/cease-fire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// sendLaunchMissile fires one homing missile of `missileClass` (1 = «Москит» /
// gt10, 2 = «Оса» / gt11, 3 = «Стрекоза» / gt12, 4 = «Шелкопряд» / gt13,
// 5 = «Шершень» / gt14) from shipID at targetRef. The class picks both the
// ammunition row debited and the missile's flight/damage profile
// (ct_missiles, TASK-175); the server rejects anything outside 1-5 with 400.
// Returns the server-allocated missile id so the caller can correlate WS
// frames with its own optimistic state. Throws ApiError on a non-2xx
// status with the backend's error text.
export async function sendLaunchMissile(
  shipID: number,
  targetRef: EntityRef,
  missileClass: number,
): Promise<{ missileID: number }> {
  const res = await netFetch('/api/cmd/launch-missile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef, class: missileClass }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; missileID: number };
  return { missileID: body.missileID };
}

// sendLaunchDrone launches a salvo of combat drones from shipID at targetRef and
// returns how many actually flew.
//
// The SERVER decides the salvo size (TASK-176): min(up_drone_control level − drones
// already out, drones in the hold). There is no count to send — only the worker
// knows the cap and only its transaction can size the hold. Until then each caller
// sent a fixed 3 of its own, and the one without access to the cargo (the canvas
// action menu) got a flat 400 whenever the hold held fewer than that — which, at the
// drone's space of 290, is the ordinary case.
//
// Throws ApiError on a non-2xx; an EMPTY hold is still a 400.
export async function sendLaunchDrone(
  shipID: number,
  targetRef: EntityRef,
): Promise<{ spawned: number }> {
  const res = await netFetch('/api/cmd/launch-drone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, targetRef }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; spawned: number };
  return { spawned: body.spawned };
}

// sendDismantleStatic folds one of the player's deployed objects (a
// hyper-interference generator or a navigation satellite) back into shipID's
// hold: the object leaves the sector and one goods unit comes back, in one
// server-side transaction (TASK-146). The ship must be within pickup range of
// the object and have room for it — the server answers 422 otherwise. Throws
// ApiError on a non-2xx.
export async function sendDismantleStatic(
  shipID: number,
  target: EntityRef,
): Promise<void> {
  const res = await netFetch('/api/cmd/dismantle-static', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, target }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// sendRecallDrones recalls as many of shipID's live drones as its hold can take.
// Returns how many returned and how many stayed out for want of space (TASK-156:
// the recall is partial rather than overfilling the hold or refusing outright).
// Throws ApiError on a non-2xx.
export async function sendRecallDrones(
  shipID: number,
): Promise<{ recalled: number; left: number }> {
  const res = await netFetch('/api/cmd/recall-drones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; recalled: number; left: number };
  return { recalled: body.recalled, left: body.left };
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
  const res = await netFetch('/api/cmd/launch-torpedo', {
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
  const res = await netFetch('/api/cmd/pickup-container', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID, containerID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
}

// sendInstallSatellite deploys one navigation satellite from shipID's cargo at
// the ship's current position (phase 10.15). The HTTP handler only forwards the
// command: the 1× goods id 26 debit happens inside the sector worker, in the
// same transaction as the satellite INSERT (TASK-144), so goods and object
// always agree. Throws ApiError on a non-2xx (e.g. 400 no satellite in cargo,
// 400 ship docked) — and note that 504 now means "outcome unknown", not
// "nothing happened": the command may already have applied. Map failures with
// installErrorText(err, 'satellite') instead of showing err.message raw.
export async function sendInstallSatellite(
  shipID: number,
): Promise<{ satelliteID: number }> {
  const res = await netFetch('/api/cmd/install-satellite', {
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

// sendInstallJammer deploys one hyper-interference generator from shipID's
// cargo at the ship's current position (TASK-131). Like install-satellite, the
// 1× goods id 27 debit lives inside the sector worker and commits together with
// the generator INSERT (TASK-144) — the handler never consumes or refunds.
// Throws ApiError on a non-2xx (e.g. 400 no generator in cargo, 400 ship
// docked); 504 means "outcome unknown", so a blind retry can deploy (and pay
// for) a second ≈1.13M cr generator. Map failures with
// installErrorText(err, 'jammer').
export async function sendInstallJammer(
  shipID: number,
): Promise<{ jammerID: number }> {
  const res = await netFetch('/api/cmd/install-jammer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipID }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const body = (await res.json()) as { ok: boolean; jammerID: number };
  return { jammerID: body.jammerID };
}

// sendMine arms sustained ore mining on shipID against the given asteroid, or
// stops it when asteroidID is 0 (phase 10.3.6). The server only sets the
// intent; the per-tick drilling, drill gate (up_drill), range check and energy
// gate run in the sector worker. Throws ApiError on a non-2xx — notably 422
// when the ship lacks a mining drill (the menu gates the button to avoid this),
// 404 asteroid gone, 400 out of range / docked.
export async function sendMine(shipID: number, asteroidID: number): Promise<void> {
  const res = await netFetch('/api/cmd/mine', {
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

// Backs useGalaxy, i.e. the galaxy map and the autopilot panel's sector list.
// requireOk is safe here because useGalaxy hands the failure to friendlyError
// (TASK-168 replaced its String(err)), and friendlyError strips the
// `GET /api/world: ` label requireOk adds. Note the reason is the caller's mapper,
// not the message being printed: printing err.message as-is is the one thing that
// makes requireOk unsafe, which is why the raw-printing senders above avoid it.
export async function fetchWorld(): Promise<WorldResponse> {
  const res = await netFetch('/api/world');
  await requireOk(res, 'GET /api/world');
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

// NetworkError means the request never got an answer: the backend is down, the
// connection dropped mid-flight, DNS failed. fetch signals those by rejecting
// with a TypeError, and testing `err instanceof TypeError` at the mapper cannot
// tell them apart from an ordinary bug in this SPA — `body.lots` off a null body
// throws a TypeError too, and used to surface as «Нет связи с сервером» while
// the server had in fact answered 200 (found in review of TASK-140). netFetch
// wraps the rejection where the distinction is still known: at the call itself.
//
// (An aborted request rejects with a DOMException named AbortError, not a
// TypeError. Nothing in src/ uses AbortController today; it is wrapped here all
// the same, because "no answer" is exactly what it is.)
//
// cause carries whatever fetch threw, for the console; message is the line we
// would show a player. Views that print err.message straight into their own
// error slot get a Russian line this way without each growing a mapper.
//
// That now covers the whole SPA. Clans, bounties and the login screen used to keep
// their own transport on bare fetch — 7 call sites that never reached this wrapper,
// so opening the Кланы tab during a backend restart read "Failed to fetch" in a
// Russian interface. TASK-168 moved all three onto netFetch; the only bare `fetch(`
// left in src/ is the one inside netFetch below, which is what makes that checkable
// with a grep. friendlyError returns the same constant.
const NO_CONNECTION_TEXT = 'Нет связи с сервером. Проверьте подключение.';

export class NetworkError extends Error {
  cause: unknown;
  constructor(cause: unknown) {
    super(NO_CONNECTION_TEXT);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

// netFetch is fetch plus the NetworkError wrapper. Every request in this module
// goes through it, so the three outcomes stay distinct types: no answer
// (NetworkError), an answer that is an error (ApiError), and our own code
// throwing (anything else).
export async function netFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    throw new NetworkError(err);
  }
}

// parseErrorBody pulls the backend's own `error` field out of a non-2xx
// response. Exported so the clan, bounty and auth clients share it instead of
// keeping their own copies — the three had drifted to nothing but the same eight
// lines, and the statusText decision below has to be made once.
//
// When there is no usable `error` field the fallback is a Russian line naming the
// status, NOT res.statusText. The reason phrase is the wrong thing to show twice
// over: it is English in a Russian UI, it carries nothing the status code does
// not, and it is not even stable — HTTP/2 has no reason phrase at all, so the
// same 500 read "Internal Server Error" through the dev proxy and "" in
// production. That is how the market tab came to say «Не удалось загрузить
// рынок: Internal Server Error» (TASK-168): a Vite/Apache proxy error page is not
// JSON, res.json() threw, and the reason phrase went straight to the screen under
// a Russian prefix.
export async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? statusLine(res.status);
  } catch {
    return statusLine(res.status);
  }
}

// statusLine is the last-resort wording when a failure carries no message of its
// own. friendlyError repeats it verbatim for the same case, so it lives here.
function statusLine(status: number): string {
  return `Сервер вернул ошибку ${status}.`;
}

// stripRoute drops the "POST /api/…: " prefix requireOk puts in front of the
// backend's own message.
function stripRoute(message: string): string {
  return message.replace(/^[A-Z]+ \/api[^:]+: /, '').trim();
}

// friendlyError is the line a view shows the player when a *read* fails — a tab
// loading its market, hold, auction or scan. Retrying a GET costs nothing, so it
// is allowed to read as "try again"; commandErrorText below is the mapper for
// anything that spends credits or moves goods, and it is not.
// jumpDriveErrorText / installErrorText are the same idea one command at a time.
//
// Five shapes reach it:
//   - NetworkError — netFetch never got an answer. Its native cause is the
//     English "Failed to fetch", which the Russian UI showed verbatim until
//     TASK-140.
//   - ApiError — the backend (or a proxy in front of it) answered non-2xx;
//     requireOk prefixes the message with the route, stripped here. 502/504 come
//     from Apache, not from the game, and get their own wording (see
//     UNKNOWN_OUTCOME_STATUSES); every other body-less status arrives already
//     worded by parseErrorBody, so the `||` below now only catches an explicit
//     `{"error":""}` from the backend. AuthError (auth/api.ts) is a subclass, so
//     the login screen's unclassified statuses land here too.
//   - TypeError — a bug in this SPA, not a failure of the request: no sender
//     here throws one, and netFetch owns the only rejection fetch itself
//     produces. It used to be read as "no connection"; it now has its own line,
//     because «Cannot read properties of null (reading 'lots')» is no better an
//     answer for a player than the wrong one was.
//   - any other Error — the senders that throw a plain Error() after reading a
//     response; show the message as-is. Those messages are the backend's own
//     (English sentinels included, as they have always been), so this branch
//     deliberately does not Russianise.
//   - a non-Error rejection — String()ed. Unreachable from any sender in this
//     module (they all throw Error subclasses), so it stays a debugging aid
//     rather than getting a Russian line that would hide the bug.
//
// This lived as four copies of the same closure (AuctionView ×2, CargoView,
// MarketView); none of them worded the network case.
export function friendlyError(err: unknown): string {
  if (err instanceof NetworkError) {
    // Keep the native reason in the console — the player only sees the Russian
    // line, but "Failed to fetch" vs "NetworkError when attempting to fetch
    // resource" still matters when debugging.
    console.error('request failed without a response', err.cause);
    return NO_CONNECTION_TEXT;
  }
  if (err instanceof ApiError) {
    if (UNKNOWN_OUTCOME_STATUSES.has(err.status)) {
      console.error('proxy answered instead of the backend', err.status, err.message);
      return `Сервер не ответил (${err.status}). Попробуйте позже.`;
    }
    // Empty only when the backend answered `{"error":""}` — parseErrorBody words
    // every other body-less failure itself.
    return stripRoute(err.message) || statusLine(err.status);
  }
  if (err instanceof TypeError) {
    console.error('bug in the SPA while handling a response', err);
    return 'Ошибка в интерфейсе игры. Обновите страницу; если повторится — сообщите разработчикам.';
  }
  if (err instanceof Error) return stripRoute(err.message);
  return String(err);
}

// commandErrorText is friendlyError for a request that spends credits or moves
// goods: market buy/sell, cargo transfer, lot creation, ship purchase and
// outfitting, insurance, claiming a station and — outside the station, added by
// TASK-168 — placing a bounty (bounties.Service debits the sponsor's wallet or the
// clan treasury inside the transaction that inserts it) and selling a ship
// (app/sell_ship.go credits the wallet and deletes the hull in one transaction).
//
// One rule, no per-screen exceptions: every mutating command outside the station
// that moves credits, goods or a hull is on this mapper. Besides the two above that
// is the ordnance — sendLaunchMissile / sendLaunchDrone / sendLaunchTorpedo, whose
// magazine is charged as one all-or-nothing debit — and sendPickupContainer and
// sendDismantleStatic, which both put goods into the hold. All five map at their
// call sites through the toText hook (CombatHUD.run, ObjectActionsMenu.run);
// sendInstallSatellite / sendInstallJammer have installErrorText, which words the
// same in-doubt case one command at a time (TASK-149).
//
// This paragraph used to claim the rest «move no money and say so at their own call
// sites» while listing only the clan commands, activateShip and sendSetCourse — the
// five ordnance/cargo senders above were simply missing from it, and none of them
// said anything at its call site: they went through run() with no toText and printed
// the raw backend message. A 502 on «Запустить ракету» read «Сервер вернул ошибку
// 502.», i.e. the server refused, and a second click spent a second missile.
//
// The commands genuinely left out move neither credits nor goods, and that was
// checked rather than assumed: sendSetCourse (internal/api/set_course.go only hands
// the worker a Course), sendMine (internal/api/mine.go only stores MiningTarget —
// the drilling, the energy gate and the ore are per-tick in the worker),
// activateShip, sendMove, sendDock, sendUndock, sendJump, sendAttack, sendCapture,
// sendHack, sendCeaseFire, disembark, exitShip, setShipAccess — all record an intent
// the worker acts on later, and internal/sector/docking.go and jump*.go touch no
// wallet — plus the clan commands (create/invite/accept/kick/leave/role), which
// debit nothing and are refused on a repeat by a unique key.
//
// It exists because friendlyError's advice is wrong for those. When no answer
// arrives the request may still have reached the backend and committed — the
// same in-doubt situation installErrorText was built around in TASK-149, and
// which UNKNOWN_OUTCOME_STATUSES already states for 502/504. Telling a player
// on a lost ack to «повторите» is how a 1 200 000 cr hull gets bought twice.
//
// Deliberately NOT applied to sendAuctionBid: the backend only accepts a bid
// strictly above the current price, so a repeat of a bid that did land is
// rejected rather than charged twice, and the cautious line would be noise.
//
// Deliberately NOT applied to sendSetCourse either, the one mutating command
// outside the station that TASK-168 AC #3 asks about. Laying a course spends
// nothing (internal/api/set_course.go only hands the worker a Course) and
// re-sending it overwrites the same field, so friendlyError's "try again" is the
// correct advice and nothing of the player's is in doubt. That is the only test
// applied, to this command and to every other candidate: does it move credits,
// goods or a hull — i.e. can the panel still honestly imply nothing happened. (A
// double charge is the worst case of failing that test, not the test itself: a
// repeated pickup or a repeated sell answers 404, but the first attempt may have
// moved the goods, and that is enough.) It used to be argued partly on the wording
// ("would name a wallet and a hold this command never touches"), which held
// sendSetCourse to a stricter standard than setBounty and sellShip were let in
// under: the line named a hold neither of them touches either. It no longer names
// any resource, precisely because this mapper is shared by commands that move
// different things — a wallet, a hold, a hull, a bounty board — and naming one set
// made it false for the rest. Both sendSetCourse callers (GalaxyMap,
// SetCoursePanel) use friendlyError.
export function commandErrorText(err: unknown): string {
  if (err instanceof NetworkError || (err instanceof ApiError && UNKNOWN_OUTCOME_STATUSES.has(err.status))) {
    console.error('command outcome unknown', err);
    return (
      'Ответ не получен, исход неизвестен. Команда могла пройти — вместе со списанием ' +
      'или начислением. Проверьте, что изменилось, прежде чем повторять.'
    );
  }
  return friendlyError(err);
}

// Lines shared by jumpDriveErrorText and installErrorText below. Both mappers
// word the same four backend outcomes identically (404 ship not found, 403
// foreign ship, ErrInboxFull, and the 401 auth middleware answers on an expired
// session), and keeping the literals in one place stops them drifting apart the
// next time one of the two gets reworded.
const ERR_SHIP_NOT_FOUND = 'Корабль не найден.';
const ERR_NOT_YOUR_SHIP = 'Это не ваш корабль.';
const ERR_SECTOR_BUSY = 'Сектор занят, попробуйте ещё раз.';
const ERR_SESSION_EXPIRED = 'Сессия истекла — войдите в игру заново.';

// JUMP_UNKNOWN_OUTCOME_TEXT is the line for a jump whose answer never arrived.
// The in-doubt cases for THIS command, checked against the handler and the
// worker (TASK-157 AC #1), are 502, 504, a dropped connection — and 500:
//
//   - 502 and 504 are stated once, with their causes, on
//     UNKNOWN_OUTCOME_STATUSES; this line only words them for the jump. The
//     wording it replaced, «Команда не успела выполниться, попробуйте ещё раз»,
//     asserted a failure nobody knows about — that is the TASK-140 class of
//     defect, not a matter of wording taste.
//   - a NetworkError is the commonest of the three and never reaches the status
//     switch at all: netFetch rejects, the POST may still have landed.
//   - 500 belongs to the same class and is worded separately, in the switch's
//     default branch — see it for why a server-side error can still leave the
//     ship in the target sector.
//
// What a jump that DID go through leaves behind
// (back/internal/sector/jumpdrive.go:138-145): the shield is zeroed and
// LastJumpAt stamped BEFORE executeJump, and rolled back only if executeJump
// itself fails. So the ship is in the target sector with a flat shield and a
// running cooldown (3600 s at module level 1, 1800 s at level 2), and a blind
// retry is answered 429 «двигатель ещё не готов» rather than jumping again.
//
// Deliberately NOT installUnknownOutcomeText's wording: this path debits no
// goods and no credits, so pointing the player at their hold would be noise.
// The one thing in doubt is which sector the ship is in — and the galaxy map
// marks that itself as soon as the WS handoff lands, which is why the line says
// to look before repeating rather than offering a retry.
const JUMP_UNKNOWN_OUTCOME_TEXT =
  'Ответ не получен, исход неизвестен. Прыжок мог состояться — карта сама отметит ' +
  'корабль в новом секторе. Посмотрите, где он, прежде чем повторять.';

// jumpDriveErrorText turns a sendJumpDrive failure into a Russian, human-
// readable line for the galaxy-map footer / Journal (TASK-129). It branches on
// the HTTP status ApiError carries and — for the three statuses the backend
// overloads — on a substring of its English sentinel text: the same 422 covers
// both "no jump drive" and "shield generator damaged", the same 400 covers
// both "jump blocked in this sector" and "invalid target sector", and the same
// 409 covers both "ship is docked" and "jump blocked by antijump field"
// (TASK-131 — before that the jammed case read as "you are docked"). The backend
// does not distinguish these by status alone, so keying on the English wording
// ("shield" / "blocked") is a deliberate, documented coupling to those
// sentinels (see the error table in TASK-129).
//
// The in-doubt case is asked first, exactly as installErrorText does and in the
// same shape as commandErrorText, so the set of unanswered statuses stays stated
// once in UNKNOWN_OUTCOME_STATUSES (TASK-157). Everything that is not an
// ApiError goes to friendlyError afterwards: it used to be String(err), which
// put the class name on screen as «NetworkError: Нет связи с сервером…» — the
// leak TASK-168 removed from the set-course branch eight lines below this
// mapper's own caller (GalaxyMap.tsx) and left here.
export function jumpDriveErrorText(err: unknown): string {
  if (err instanceof NetworkError || (err instanceof ApiError && UNKNOWN_OUTCOME_STATUSES.has(err.status))) {
    console.error('jump drive: outcome unknown', err);
    return JUMP_UNKNOWN_OUTCOME_TEXT;
  }
  // A TypeError from our own .then chain, or a non-Error rejection: friendlyError
  // words both and strips a route prefix if one got in.
  if (!(err instanceof ApiError)) return friendlyError(err);
  const msg = err.message.toLowerCase();
  switch (err.status) {
    case 401:
      // The session cookie expired: back/internal/auth/middleware.go answers
      // «not authenticated» before the handler runs, and without this branch
      // that English sentinel landed in the Russian map footer verbatim.
      return ERR_SESSION_EXPIRED;
    case 404:
      return ERR_SHIP_NOT_FOUND;
    case 403:
      return ERR_NOT_YOUR_SHIP;
    case 409:
      // Overloaded status: "antijump" sentinel → hyper-interference jams the
      // jump (a powered up_antijump ship, TASK-100.3.8, or a deployed
      // «Генератор гипер-помех», TASK-131), otherwise the ship is docked.
      return msg.includes('antijump')
        ? 'Гипер-помехи глушат прыжок: рядом генератор гипер-помех или корабль с полем подавления.'
        : 'Нельзя прыгнуть пристыкованным — сначала отстыкуйтесь.';
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
      // Two backend faults behind one status, and only the first is worth a
      // retry (TASK-157 — this branch used to answer ERR_SECTOR_BUSY to both):
      //   "sector busy" — ErrInboxFull, refused at the door
      //     (back/internal/api/jump_drive.go:42-45). The command was never
      //     enqueued and the worker is merely behind, so «попробуйте ещё раз»
      //     is exactly right.
      //   "handoff unavailable" — ErrHandoffUnavailable, a worker built without
      //     topology or bus (back/internal/sector/jumpdrive.go:69-70 — after the
      //     ship lookup and the ownership check, but ahead of every gate the
      //     player could act on: dock, module, shield, cooldown). That is how
      //     the process was wired; it will answer the same until it is restarted
      //     differently, so inviting a retry is advice that can never come true.
      // Tested positively on the retryable sentinel rather than on the fault,
      // for installErrorText's reason: a reworded sentinel or a proxy's own
      // generic "Service Unavailable" must land on the cautious side, not
      // inherit «попробуйте ещё раз».
      //
      // Neither branch is an unknown outcome: one never reached the worker at
      // all, the other was refused ahead of the shield drain and the cooldown
      // stamp (jumpdrive.go:138-145). Nothing of the player's was spent either
      // way, and the line says so rather than sending them to check the map.
      if (msg.includes('sector busy')) return ERR_SECTOR_BUSY;
      console.error('jump drive: unrecognised 503', err.message);
      return 'Прыжок сейчас недоступен на стороне сервера. Ничего не потрачено, но повтор сейчас не поможет — попробуйте позже.';
    default:
      // A 5xx body is the worker's own error string, handed through raw
      // (back/internal/api/jump_drive.go:77-78), so an English «publish jump
      // event: context deadline exceeded» would otherwise land in the Russian
      // map footer. Keep it in the console, show Russian.
      //
      // And the line stops short of asserting failure, exactly as
      // installErrorText's 500 branch does. executeJump saves the ship row
      // naming the TARGET sector *before* it publishes the handoff event
      // (back/internal/sector/handoff.go:155); since TASK-148 the publish has a
      // deadline, so back-pressure failing it is a routine outcome, and the
      // compensating re-save that follows is best-effort and may itself fail
      // (handoff.go:189-210). A 500 can therefore mean the ship is already
      // recorded as gone from here. Nothing of the player's was spent — this
      // command debits no goods and no credits — but which sector the ship is
      // in is precisely what is in doubt, so the line sends them to the map
      // rather than promising a free retry.
      if (err.status >= 500) {
        console.error('jump drive failed', err.status, err.message);
        return 'Сервер вернул ошибку. Скорее всего прыжок не состоялся — но посмотрите на карте, где корабль, прежде чем повторять.';
      }
      return err.message;
  }
}

// InstallKind names the two deployable statics install-* commands build, so one
// mapper can word its lines for the right object.
export type InstallKind = 'satellite' | 'jammer';

// Nominative/genitive captions per install kind — both nouns are masculine, so
// the shared «мог быть развёрнут» phrasing agrees for either.
const INSTALL_NOUNS: Record<InstallKind, { nominative: string; genitive: string }> = {
  satellite: { nominative: 'Спутник', genitive: 'спутников' },
  jammer: { nominative: 'Генератор гипер-помех', genitive: 'генераторов гипер-помех' },
};

// Statuses on which the request demonstrably reached the server but its answer
// did not reach us. The single place this list lives: friendlyError,
// commandErrorText, installErrorText and jumpDriveErrorText each phrase them for
// their own command, and adding one here must not require touching a mapper.
//
//   504 — the POST reached the worker's inbox and the HTTP wait for the ack
//         expired; the command is queued or already applied. The handler issues
//         it itself once s.cfg.AckTimeout runs out (back/internal/api/
//         jump_drive.go:82-83 and its siblings): it stopped waiting, it did not
//         cancel anything. This is the one statement of that fact — the mappers
//         and their tests point here instead of repeating it.
//   502 — in production Apache fronts the Go process
//         (deploy/spaceempire.online.conf proxies / to 127.0.0.1:8081) and
//         answers 502 when the backend drops the connection *after* the request
//         was forwarded: a restart, a deploy, a worker panic. Same in-doubt
//         situation as 504.
//
// A proxy 503 is deliberately NOT here: it means the connection was never
// established, so the command cannot have been enqueued.
const UNKNOWN_OUTCOME_STATUSES = new Set([502, 504]);

// isOutcomeUnknown reports whether a failed install-* command may nonetheless
// have been applied by the server — either one of the statuses above, or a
// rejection that is not an ApiError at all (a NetworkError on a dropped
// connection or DNS failure, where the request may still have landed). See
// TASK-144: the goods debit now commits with the object INSERT, so "no answer"
// no longer implies "no charge".
//
// Two limits on the non-ApiError half, both narrower than the name suggests:
//
//   - It holds for sendInstallSatellite / sendInstallJammer, not for api.ts at
//     large. Around twenty other senders throw a plain Error() *after* reading a
//     response (claimStation, getShipAtShipyard, sendCeaseFire, …), and for
//     those a non-ApiError says nothing about the outcome. Check what a command
//     throws before reusing this predicate on it.
//   - It errs the other way in one harmless spot: a 2xx whose body is not valid
//     JSON makes res.json() throw a SyntaxError, which reads here as "unknown"
//     even though the install in fact succeeded. The cost is one over-cautious
//     line and a redundant cargo re-read.
export function isOutcomeUnknown(err: unknown): boolean {
  return !(err instanceof ApiError) || UNKNOWN_OUTCOME_STATUSES.has(err.status);
}

// installUnknownOutcomeText is the single wording for every install-* failure
// whose outcome we cannot determine (504, 502 and a dead connection alike):
// don't promise a free retry, point at the hold and the radar instead.
function installUnknownOutcomeText(nominative: string): string {
  return (
    `Ответ не получен, исход неизвестен. ${nominative} мог быть уже развёрнут, ` +
    'а товар списан. Проверьте трюм и радар, прежде чем повторять: если команда прошла, ' +
    'объект появится сам со следующим обновлением обстановки.'
  );
}

// installErrorText turns a sendInstallSatellite / sendInstallJammer failure into
// a Russian, human-readable line for the combat HUD (TASK-149). Shaped like
// jumpDriveErrorText: branch on the HTTP status ApiError carries, and on a
// substring of the English sentinel where the backend overloads a status.
//
// The unknown outcome — 504, a proxy 502, or a dropped connection, the last two
// being commoner ways to lose an ack than a genuine worker timeout — is the
// reason this mapper exists at all (see isOutcomeUnknown, which owns that set,
// and which this function asks before anything else). Since TASK-144 the debit
// runs inside the sector worker in the same transaction as the object INSERT, so a
// lost ack no longer means "nothing happened, retry is free" — it means the
// outcome is unknown and the object may already stand. Telling the player to
// just try again would deploy (and charge for) a second one.
//
// Statuses the two handlers overload:
//   400 — "ship is docked" | "no satellite|jammer in cargo" | bad request body;
//   503 — "sector busy" (ErrInboxFull, the only genuinely retryable one) |
//         "install unavailable: server misconfigured" (ErrInstallerUnavailable).
// The 503 test is deliberately positive on the retryable sentinel rather than on
// the misconfigured one: "misconfigured" lives only in a hand-written handler
// literal, while ErrInstallerUnavailable's own text is "static installer not
// wired". Keying on the fault would make a routine backend rewording — or a
// proxy's generic "Service Unavailable" — silently read as "try again", which
// is exactly the advice this mapper exists to withhold. Unrecognised 503s
// therefore land on the cautious side.
export function installErrorText(err: unknown, kind: InstallKind): string {
  const noun = INSTALL_NOUNS[kind];
  // Asked before the switch so the set of in-doubt statuses is stated once, in
  // UNKNOWN_OUTCOME_STATUSES. The instanceof half is redundant with the
  // predicate (which is true for every non-ApiError) and is written out only to
  // narrow err for the switch below — TypeScript cannot follow the narrowing
  // through a boolean-returning function.
  if (!(err instanceof ApiError) || isOutcomeUnknown(err)) {
    console.error('install command: outcome unknown', err);
    return installUnknownOutcomeText(noun.nominative);
  }
  const msg = err.message.toLowerCase();
  switch (err.status) {
    case 401:
      return ERR_SESSION_EXPIRED;
    case 404:
      return ERR_SHIP_NOT_FOUND;
    case 403:
      return ERR_NOT_YOUR_SHIP;
    case 400:
      // Overloaded status: "docked" sentinel → the ship must undock first,
      // "cargo" → the hold ran empty (the button count can lag a snapshot),
      // otherwise the request itself was malformed.
      if (msg.includes('docked')) {
        return 'Нельзя разворачивать оборудование пристыкованным — сначала отстыкуйтесь.';
      }
      if (msg.includes('cargo')) return `В трюме нет ${noun.genitive}.`;
      console.error('install command: unrecognised 400', err.message);
      return 'Некорректный запрос на установку.';
    case 503:
      if (msg.includes('sector busy')) return ERR_SECTOR_BUSY;
      // Catch-all by design (see the header), which makes it the one branch
      // where the body is most likely to be news — a renamed sentinel, a proxy's
      // own wording — so it must not be swallowed. Retrying later can genuinely
      // work here (the backend may simply be down), so the line withholds the
      // blind retry without claiming a retry is pointless.
      console.error('install command: unrecognised 503', err.message);
      return 'Установка сейчас недоступна на стороне сервера. Не повторяйте вслепую — сначала проверьте трюм и радар.';
    default:
      // A 5xx body is a raw server-side message (install_satellite.go passes the
      // repository error straight through), so it can leak a Postgres error into
      // the combat HUD. Keep it in the console for debugging, show Russian.
      //
      // The wording stops short of asserting failure: the worker runs the
      // install under a RepoTimeout context (back/internal/sector/satellite.go),
      // and a deadline struck on COMMIT is in-doubt — the handler answers 500
      // while the transaction may have committed. Rarer than 502/504, hence its
      // own line rather than the unknown-outcome one, but not a failure we can
      // promise.
      if (err.status >= 500) {
        console.error('install command failed', err.status, err.message);
        return 'Сервер вернул ошибку. Скорее всего установка не прошла — но проверьте трюм и радар, прежде чем повторять.';
      }
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
  const res = await netFetch('/api/player/me');
  await requireOk(res, 'GET /api/player/me');
  return (await res.json()) as PlayerSelf;
}

// fetchFleet lists every ship the player owns across all sectors (10.14a). Each
// ship reuses the snapshot Ship shape, so shipDisplayName/class-catalog labelling
// applies. The fleet panel renders these with a "make active" action.
export async function fetchFleet(): Promise<Ship[]> {
  const res = await netFetch('/api/player/ships');
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
  const res = await netFetch('/api/goods');
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
  const res = await netFetch('/api/races');
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
  // Aggregate war/trade ratings of the current player (TASK-132). Consumed by
  // the shipyard to predictively gate installs on those axes; always present.
  warRate: number;
  tradeRate: number;
};

export async function fetchRaceStandings(): Promise<RaceStandings> {
  const res = await netFetch('/api/my/race-standings');
  await requireOk(res, 'GET /api/my/race-standings');
  const body = (await res.json()) as RaceStandings;
  return {
    items: body.items ?? [],
    wantedThreshold: body.wantedThreshold,
    warRate: body.warRate ?? 0,
    tradeRate: body.tradeRate ?? 0,
  };
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

// QuestOfferFrame is the per-player WS frame pushed when the pacer generates a
// personal quest offer (TASK-89, FR-10) — «доска объявлений» on a dock
// (source='dock') or an «перехваченный сигнал» on a sector jump (source='space').
// offerId is the "proc:<n>" accept handle. Drives the journal line (with an
// inline «Принять» button) in useQuestOfferLog; the panel adds it to «Предложения».
export type QuestOfferFrame = {
  type: 'quest_offer';
  offerId: string;
  title: string;
  desc: string;
  source: string;
  expiresUnix: number;
  rewardCash: number;
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
  const res = await netFetch(cargoEndpoint(owner));
  await requireOk(res, `GET ${cargoEndpoint(owner)}`);
  return (await res.json()) as CargoInventory;
}

export async function sendMoveCargo(
  from: EntityRef,
  to: EntityRef,
  typeID: number,
  quantity: number,
): Promise<void> {
  const res = await netFetch('/api/cmd/cargo/move', {
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
  const res = await netFetch(marketEndpoint(owner));
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
  const res = await netFetch('/api/cmd/trade/buy', {
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
  const res = await netFetch('/api/cmd/trade/sell', {
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
  const res = await netFetch('/api/market-scan');
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
  const res = await netFetch('/api/auction');
  await requireOk(res, 'GET /api/auction');
  const body = (await res.json()) as { lots: AuctionLot[] };
  return body.lots ?? [];
}

// fetchMyAuctionLots returns lots the player is involved in (as seller or
// current high bidder), any status — for the "Мои лоты/ставки" view.
export async function fetchMyAuctionLots(): Promise<AuctionLot[]> {
  const res = await netFetch('/api/auction/mine');
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
  const res = await netFetch('/api/auction', {
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
  const res = await netFetch(`/api/auction/${lotID}/bid`, {
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
  const res = await netFetch('/api/quests/active');
  await requireOk(res, 'GET /api/quests/active');
  return ((await res.json()) as ActiveQuest[]) ?? [];
}

// OfferableQuest is one personal, un-accepted quest offer (TASK-89, FR-10).
// GET /api/quests/offerable now returns only the player's own pending offers —
// the old static catalogue shape ({questId,title,totalSteps}) is gone. offerId
// is the "proc:<n>" accept handle (see acceptQuest); source is 'dock' (station
// bulletin board) or 'space' (intercepted signal); expiresUnix is the offer's
// TTL deadline; rewardCash is the scaled payout.
export type OfferableQuest = {
  offerId: string;
  title: string;
  desc: string;
  source: string;
  expiresUnix: number;
  rewardCash: number;
};

export async function fetchOfferableQuests(): Promise<OfferableQuest[]> {
  const res = await netFetch('/api/quests/offerable');
  await requireOk(res, 'GET /api/quests/offerable');
  return ((await res.json()) as OfferableQuest[]) ?? [];
}

// acceptQuest materialises a personal offer into an active quest. offerId is the
// "proc:<n>" handle — it contains a colon, so it MUST be percent-encoded into the
// path (encodeURIComponent). 404 on a foreign/unknown/expired offer.
export async function acceptQuest(offerId: string): Promise<void> {
  const res = await netFetch(`/api/quests/${encodeURIComponent(offerId)}/accept`, { method: 'POST' });
  await requireOk(res, `POST /api/quests/${offerId}/accept`);
}

export async function abandonQuest(questId: string): Promise<void> {
  const res = await netFetch(`/api/quests/${encodeURIComponent(questId)}/abandon`, { method: 'POST' });
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
  const res = await netFetch('/api/ship-classes');
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
  const res = await netFetch('/api/station-types');
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
  // Reputation gates (TASK-100.3.27): install is blocked when the player's
  // war/trade rating or their standing with the shipyard's race is below the
  // respective threshold. 0 means the axis does not gate. Consumed by the
  // shipyard to predictively disable «Установить» (TASK-100.3.28).
  minWarRate: number;
  minTradeRate: number;
  minRaceRate: number;
};

export async function fetchEquipment(): Promise<Equipment[]> {
  const res = await netFetch('/api/equipment');
  await requireOk(res, 'GET /api/equipment');
  const body = (await res.json()) as { items: Equipment[] };
  return body.items ?? [];
}
