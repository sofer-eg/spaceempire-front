// Pure reduction of the WS `statics` frame into the world state (TASK-186).
//
// It lives outside useWorldState for one reason: the frame is the only message
// that carries the live hull/shield of the sector's statics, and until this was
// a function there was nothing a test could hold. The seeding line inside the
// hook could be reverted to `new Map()` — the exact regression this task fixed —
// and every check in the repo stayed green, because the project has no harness
// for React hooks and is not getting one for this.
//
// DOM-free and React-free so `node --test` can import it. The one runtime import
// carries its .ts extension because Node resolves specifiers literally; the
// type-only imports do not need it, being stripped before Node ever sees them.
import { staticCombatMap, type Asteroid, type StaticsMessage } from './api.ts';
import type { TrackedShip, WorldState } from './useWorldState.ts';

// FreshSectorMaps are the emptied per-sector maps the caller has already swapped
// in when the frame announced a new sector (a gate jump re-subscribes the socket,
// and contacts from the old sector must not leak into the new view). Null means
// the frame is for the sector the client is already in — subscribe, or a
// reconnect — and the existing maps stay.
export type FreshSectorMaps = {
  ships: Map<number, TrackedShip>;
  asteroids: Map<number, Asteroid>;
};

// applyStaticsFrame folds one `statics` frame into the previous state.
//
// staticCombat is SEEDED from the frame rather than cleared: the frame is total
// for its sector — the server sends it on subscribe and again on every jump, and
// it carries every live static — so it is authoritative at exactly the moments
// the client has nothing else. Clearing here is what left a reloaded page, or a
// jump to the neighbour and back, with only the spawn layout to print. The
// per-tick staticsUpdated/staticsRemoved delta merges into this seed afterwards,
// which is why the caller keeps its ref pointing at the map returned here.
//
// Every scalar falls back to the previous value on a non-positive field, so a
// frame that omits a range cannot zero the viewport.
export function applyStaticsFrame(prev: WorldState, msg: StaticsMessage, fresh: FreshSectorMaps | null): WorldState {
  return {
    ...prev,
    ships: fresh ? fresh.ships : prev.ships,
    sectorID: msg.sectorID || prev.sectorID,
    statics: msg.statics ?? {},
    asteroids: fresh ? fresh.asteroids : prev.asteroids,
    staticCombat: staticCombatMap(msg.destructibles),
    tickIntervalMs: msg.tickIntervalMs > 0 ? msg.tickIntervalMs : prev.tickIntervalMs,
    sectorBoundsRadius: msg.sectorBoundsRadius > 0 ? msg.sectorBoundsRadius : prev.sectorBoundsRadius,
    nearZoomRadius: msg.nearZoomRadius > 0 ? msg.nearZoomRadius : prev.nearZoomRadius,
    dockRange: msg.dockRange > 0 ? msg.dockRange : prev.dockRange,
    gateRange: msg.gateRange > 0 ? msg.gateRange : prev.gateRange,
  };
}
