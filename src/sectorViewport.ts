import type { SectorStatics, WorldGate } from './api';

// RADAR_BIG_MULTIPLIER mirrors the backend cfg.RadarBigMultiplier (phase 10.20
// L2): large objects (statics, gates) are visible within RadarRange × this. The
// authoritative visibility is the server's per-tick statics delta; the client
// uses it only to draw the big-radar ring and to fade out far gates.
export const RADAR_BIG_MULTIPLIER = 2.5;

// SATELLITE_REVEAL_RADIUS mirrors the backend cfg.SatelliteRevealRadius (phase
// 10.20 L5): a live navigation satellite reveals the whole sector to its owner
// and allies. The client uses it only to draw the coverage ring around the
// player's own satellites; the authoritative visibility is the server's AOI.
export const SATELLITE_REVEAL_RADIUS = 10000;

// Viewport is the world-space rectangle currently mapped onto the
// SectorCanvas. centre is the world coord at the canvas centre and
// halfX/halfY are the half-extents along each axis after fitting the
// chosen square world window into the (potentially non-square) canvas.
export type Viewport = {
  centerX: number;
  centerY: number;
  halfX: number;
  halfY: number;
};

// PADDING_MAX is the world-unit margin added on every side of the
// statics bounding box in Max-zoom. Keeps the outermost glyph from
// touching the canvas edge.
const PADDING_MAX = 200;
// MIN_HALF_MAX guards against degenerate windows (a single station →
// half-side 0). 300 ≈ a SHIP_RADIUS-sized object is still readable.
const MIN_HALF_MAX = 300;

// computeMaxBounds returns the world-space square that just contains
// every static AND gate of the given sector, padded by PADDING_MAX.
// Gates are folded in via their near-side coords (posAX/Y when the gate's
// sectorA is this sector, else posBX/Y) — they typically sit at the sector
// edges, so omitting them both clipped the outermost gate off the Max view
// and let the box shrink below the Near window. Falls back to the full
// sector box when the sector has neither statics nor gates.
export function computeMaxBounds(
  statics: SectorStatics,
  gates: WorldGate[],
  sectorID: number,
  fallbackRadius: number,
): { centerX: number; centerY: number; halfSide: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;

  const fold = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    count++;
  };
  const consume = (list: { sectorID: number; x: number; y: number }[] | undefined) => {
    for (const s of list ?? []) {
      if (s.sectorID !== sectorID) continue;
      fold(s.x, s.y);
    }
  };
  consume(statics.stations);
  consume(statics.shipyards);
  consume(statics.tradeStations);
  consume(statics.pirbases);
  for (const g of gates) {
    const inA = g.sectorA === sectorID;
    const inB = g.sectorB === sectorID;
    if (!inA && !inB) continue;
    fold(inA ? g.posAX : g.posBX, inA ? g.posAY : g.posBY);
  }

  if (count === 0) {
    return { centerX: 0, centerY: 0, halfSide: fallbackRadius };
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfX = (maxX - minX) / 2 + PADDING_MAX;
  const halfY = (maxY - minY) / 2 + PADDING_MAX;
  const halfSide = Math.max(halfX, halfY, MIN_HALF_MAX);
  return { centerX, centerY, halfSide };
}

// fitSquareToCanvas turns a square world half-side into per-axis half
// extents that fill a (canvasWidth × canvasHeight) viewport. The square
// is centred on the shorter canvas axis; the longer axis is extended
// symmetrically so grid lines stay isotropic.
export function fitSquareToCanvas(
  halfSide: number,
  canvasWidth: number,
  canvasHeight: number,
): { halfX: number; halfY: number } {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { halfX: halfSide, halfY: halfSide };
  }
  const aspect = canvasWidth / canvasHeight;
  if (aspect >= 1) {
    return { halfX: halfSide * aspect, halfY: halfSide };
  }
  return { halfX: halfSide, halfY: halfSide / aspect };
}

// worldToCanvas maps a world coordinate into canvas pixels for the
// given viewport and canvas size.
export function worldToCanvas(
  wx: number,
  wy: number,
  vp: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): [number, number] {
  const cx = ((wx - vp.centerX + vp.halfX) / (2 * vp.halfX)) * canvasWidth;
  const cy = ((wy - vp.centerY + vp.halfY) / (2 * vp.halfY)) * canvasHeight;
  return [cx, cy];
}

// canvasToWorld is the inverse of worldToCanvas — used by the click
// handler to translate a click pixel into a sendMove target.
export function canvasToWorld(
  cx: number,
  cy: number,
  vp: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): [number, number] {
  const wx = (cx / canvasWidth) * 2 * vp.halfX - vp.halfX + vp.centerX;
  const wy = (cy / canvasHeight) * 2 * vp.halfY - vp.halfY + vp.centerY;
  return [wx, wy];
}
