import { useOutletContext } from 'react-router-dom';
import type { CargoInventory, EntityRef, GoodsRow, PlayerSelf, Race, SectorStatics, StationType } from './api';
import { EntityKind } from './api';
import type { TrackedShip, WorldState } from './useWorldState';

export type GameOutletContext = {
  world: WorldState;
  ships: Map<number, TrackedShip>;
  statics: SectorStatics;
  ownPlayerID: number;
  // ownShip is the ship the HUD/camera follow. Usually the player's active
  // ship; while riding as a passenger (10.23) it is the HOST ship (read-only).
  ownShip: TrackedShip | null;
  // riding is true when the player is a passenger aboard another ship (10.23):
  // ownShip points at the host, but controls are disabled (only «Высадиться»).
  riding: boolean;
  logins: Map<number, string>;
  // player carries the wallet from GET /api/player/me. Null while the
  // initial fetch is in-flight. setCash applies an optimistic update from
  // a buy/sell ack so the HUD reflects the new balance without an extra
  // round-trip. refreshPlayer re-fetches the canonical value.
  player: PlayerSelf | null;
  setCash: (newCash: number) => void;
  refreshPlayer: () => Promise<void>;
  // goods is the static catalog from GET /api/goods. Empty array until the
  // first fetch resolves. Used by goodsName / goodsSpace helpers.
  goods: GoodsRow[];
  // races is the static race reference from GET /api/races (phase 8.13).
  // Empty until the first fetch resolves. Used by raceColor / raceName to
  // colour and label faction-owned objects.
  races: Race[];
  // stationTypes is the static station-type catalog from GET /api/station-types
  // (phase 8.15). Empty until the first fetch resolves. Used by
  // stationTypeName to show a docked station's human-readable type.
  stationTypes: StationType[];
  // ownCargo is the player ship's hold (used/capacity + items), fetched in
  // GameLayout and refreshed on refreshPlayer. Null until the first fetch or
  // when the player has no ship. The ship HUD reads used/capacity for the
  // ГРУЗ bar.
  ownCargo: CargoInventory | null;
  // pilotPageOpen: the rail's «пилот» button toggles a full-center «ПИЛОТ»
  // page (profile + clan + fleet + reputation) that replaces the sector map,
  // mirroring the docked→StationView swap. State lives in GameLayout (the rail
  // owns the toggle); SectorView reads it to pick what fills the map cell.
  pilotPageOpen: boolean;
  // closePilotPage returns the center to the map/station (the page's own
  // «назад» button and the сектор/станция rail items call it).
  closePilotPage: () => void;
  // shipPageOpen: the rail's «корабль» button toggles a full-center «ДЕТАЛИ
  // КОРАБЛЯ» screen (vitals + characteristics + installed equipment) that
  // replaces the sector map, mirroring pilotPageOpen (TASK-127.2). Ship and
  // pilot pages are mutually exclusive — opening one closes the other.
  shipPageOpen: boolean;
  // closeShipPage returns the center to the map/station (the screen's own
  // «назад» button and the сектор/станция rail items call it).
  closeShipPage: () => void;
};

export function useGameContext(): GameOutletContext {
  return useOutletContext<GameOutletContext>();
}

// usePlayer mirrors the task spec ("usePlayer() hook — cash, login, current
// ship"). Just a typed projection of the outlet context for components
// that don't need the world map.
export function usePlayer(): {
  player: PlayerSelf | null;
  ownShip: TrackedShip | null;
  setCash: (newCash: number) => void;
  refreshPlayer: () => Promise<void>;
} {
  const ctx = useGameContext();
  return {
    player: ctx.player,
    ownShip: ctx.ownShip,
    setCash: ctx.setCash,
    refreshPlayer: ctx.refreshPlayer,
  };
}

// useStation resolves the static the player is currently docked at. Returns
// null when the player is in space — components branch on that to decide
// whether to render StationView or the in-flight HUD.
export type DockedStation = {
  ref: EntityRef;
  // label is the localized human title ("Станция", "Верфь", ...). Used in
  // the StationView header until stations get player-set names.
  label: string;
  // ownerID is the player id that owns this station; undefined for
  // trade-stations / pirbases which are NPC-owned in phase 3.
  ownerID?: number;
  // typeID is the station_types id of the docked Station/TradeStation
  // (phase 8.15), looked up against the station-type catalog for a
  // human-readable name. Undefined for shipyards/pirbases / when the static
  // is not in the current snapshot.
  typeID?: number;
};

export function useStation(): DockedStation | null {
  const { ownShip, statics, stationTypes } = useGameContext();
  if (!ownShip?.docked) return null;
  return resolveStation(ownShip.docked, statics, stationTypes);
}

function resolveStation(
  ref: EntityRef,
  statics: SectorStatics,
  stationTypes: StationType[],
): DockedStation {
  switch (ref.kind) {
    case EntityKind.Station: {
      const hit = statics.stations?.find((s) => s.id === ref.id);
      return { ref, label: staticTypeLabel(ref.kind, hit?.type, stationTypes), ownerID: hit?.ownerID, typeID: hit?.type };
    }
    case EntityKind.Shipyard: {
      const hit = statics.shipyards?.find((s) => s.id === ref.id);
      return { ref, label: staticTypeLabel(ref.kind, undefined, stationTypes), ownerID: hit?.ownerID };
    }
    case EntityKind.TradeStation: {
      const hit = statics.tradeStations?.find((s) => s.id === ref.id);
      return { ref, label: staticTypeLabel(ref.kind, hit?.type, stationTypes), ownerID: hit?.ownerID, typeID: hit?.type };
    }
    case EntityKind.Pirbase:
      return { ref, label: staticTypeLabel(ref.kind, undefined, stationTypes) };
    default:
      return { ref, label: `Объект #${ref.id}` };
  }
}

// dockedStationLabel is the non-hook twin of useStation().label: the human
// title of the static the ship is docked at ("Станция"/"Верфь"/…), or null
// when in space. GameLayout needs it for the rail's «станция» tooltip, and the
// rail renders outside <Outlet> so it can't call the useStation() hook.
export function dockedStationLabel(
  ownShip: TrackedShip | null,
  statics: SectorStatics,
  stationTypes: StationType[],
): string | null {
  if (!ownShip?.docked) return null;
  return resolveStation(ownShip.docked, statics, stationTypes).label;
}

// goodsName / goodsSpace are tiny lookup helpers used by Market/Cargo/Auction
// views. Falls back to "type N" / 0 when the catalog has not loaded yet or
// the id is unknown (legacy data).
export function goodsName(goods: GoodsRow[], typeID: number): string {
  const hit = goods.find((g) => g.typeID === typeID);
  return hit?.name ?? `type ${typeID}`;
}

export function goodsSpace(goods: GoodsRow[], typeID: number): number {
  const hit = goods.find((g) => g.typeID === typeID);
  return hit?.space ?? 0;
}

// raceColor returns the palette colour for a race id, or the fallback when the
// race is neutral (0), unknown, or the catalog hasn't loaded yet. Phase 8.13.
export function raceColor(races: Race[], id: number, fallback: string): string {
  if (!id) return fallback;
  const hit = races.find((r) => r.id === id);
  return hit?.color ?? fallback;
}

// raceName returns the display name for a race id, or '' when the race is
// neutral (0) / unknown. Used to suffix object labels with their faction.
export function raceName(races: Race[], id: number): string {
  if (!id) return '';
  return races.find((r) => r.id === id)?.name ?? '';
}

// shipDisplayName is the single source of truth for how a ship is labelled in
// the HUD (10.6), the navigation panel and the target marker (10.7). It
// prefers the ship's own name (the M5 model its starter ship spawned with,
// phase 10.10); for an NPC ship with no name it falls back to the race name
// (Пираты/Ксенон…); otherwise to the synthetic SHIP-<id>.
export function shipDisplayName(
  ship: { id: number; name?: string; race?: number },
  races: Race[],
): string {
  const name = ship.name?.trim();
  if (name) return name;
  if (ship.race) {
    const rn = raceName(races, ship.race);
    if (rn) return rn;
  }
  return `SHIP-${ship.id}`;
}

// stationTypeName returns the human-readable name for a station_types id, or
// '' when the id is undefined / unknown / the catalog hasn't loaded. Phase
// 8.15.
export function stationTypeName(stationTypes: StationType[], id: number | undefined): string {
  if (id == null) return '';
  return stationTypes.find((t) => t.id === id)?.name ?? '';
}

// stationGlyphLetters maps a station-type name to the single letter the
// original StarWind baked into its map sprite (im/map/4/<id>.gif). The codes
// are the X-universe-style category letters read off those sprites: E=energy,
// O=ore, S=silicon, C=crystal, U=computer, W=warhead, P=microchip, R=rocket,
// L=laser, D=device (drones/mines/traps/satellites), H=hyper, V=whisky,
// M=raw food, F=processed food. Keyed by name because the catalog repeats the
// same name across racial variants (Электростанция = ids 1/101/201/…), all of
// which share one sprite letter.
const stationGlyphLetters: Record<string, string> = {
  'Строящаяся станция': '', // under construction — blank brackets, as in 0.gif
  'Электростанция': 'E',
  'Сталелитейный завод': 'O',
  'Завод кремния': 'S',
  'Фабрика кристаллов': 'C',
  'Компьютерный завод': 'U',
  'Завод боеголовок': 'W',
  'Завод микросхем': 'P',
  'Ракетный завод': 'R',
  'Завод лазерных башен': 'L',
  'Завод боевых дронов': 'D',
  'Завод мин сквош': 'D',
  'Завод ловушек': 'D',
  'Завод спутников': 'D',
  'Фабрика Гипер-генераторов': 'H',
  'Завод Виски': 'V',
  'Ранчо': 'M',
  'Завод биогаза': 'M',
  'Аквариум челтов': 'M',
  'Цветочная ферма': 'M',
  'Кухня кахуна': 'F',
  'Лаборатория Бофу': 'F',
  'Соевая ферма': 'F',
  'Фабрика сои': 'F',
  'Растарный завод': 'F',
  'Завод масла ностроп': 'F',
};

// stationLetter returns the glyph letter for a station-type name. Weapon-
// factory types (импульсных/плазменных/фотонных пушек, …) had no sprite in
// the original, so there is no canonical letter — fall back to the first
// letter of the (Russian) name. An empty name yields the generic 'S'.
export function stationLetter(name: string): string {
  const mapped = stationGlyphLetters[name];
  if (mapped !== undefined) return mapped;
  return name ? name[0].toUpperCase() : 'S';
}

// staticTypeLabel is the human-readable title of a dockable static, used in
// the navigation list, the target/dock label and the StationView header
// (phase 10.5). A production station resolves its station_types name from its
// `type` (a station_types catalog id). A trade station's `type` is NOT a
// catalog id — it is the original central/ring classification (0/1), which
// collided with catalog ids 0 ("Строящаяся станция") / 1 ("Электростанция")
// and made working trade stations look unbuilt (phase 10.19); so trade
// stations, shipyards and pirbases all use their fixed generic name. Falls
// back to the generic name when a station's type id is missing/unknown so a
// label is never empty.
export function staticTypeLabel(
  kind: number,
  typeID: number | undefined,
  stationTypes: StationType[],
): string {
  switch (kind) {
    case EntityKind.Station:
      return stationTypeName(stationTypes, typeID) || 'Станция';
    case EntityKind.TradeStation:
      return 'Торговая станция';
    case EntityKind.Shipyard:
      return 'Верфь';
    case EntityKind.Pirbase:
      return 'Пиратская база';
    case EntityKind.Satellite:
      return 'Навигационный спутник';
    case EntityKind.LaserTower:
      return 'Лазерная башня';
    default:
      return 'Объект';
  }
}
