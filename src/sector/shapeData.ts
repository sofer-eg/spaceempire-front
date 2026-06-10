// Shape data + relation helpers for the sector-map object layer (phase 10.13).
//
// Pure data/logic (no JSX) so it can be shared by the SVG overlay
// (ObjectLayer), the panel icon (shapes.tsx / objectIcons) and tests without
// tripping react-refresh's component-only-export rule.
//
// Silhouettes are the final HUD set (designer sheet "Набор знаков HUD"):
// engines/nozzles at the stern, TL/TS boxy hulls, octagon stations/gates,
// diamond pirbase. Authored nose-up (toward -Y); ship hulls are normalised
// (centre + scale to a per-tier height) via HULL_NORM. Everything uses
// `currentColor` so one symbol renders in any relation colour.

import type { TrackedShip } from '../useWorldState';

// ShipCategory is the hull-shape code the backend resolves from a ship class
// (balance.ShipClass.Category). Mirrors the 9 X-universe roles.
export type ShipCategory = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'TL' | 'TS' | 'XX';

export const SHIP_CATEGORIES: ShipCategory[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'TL', 'TS', 'XX'];

// HIT_R is the pointer hit radius (px) around every clickable object. Matches
// the old canvas HOVER_RADIUS_PX so click/hover targeting is unchanged.
export const HIT_R = 14;

// --- silhouette markup builders (ported from the designer sheet) ------------

// sil renders a filled+stroked silhouette path, plus optional stroked-only
// internal detail lines (hangar decks / cargo dividers).
function sil(body: string, detail?: string): string {
  return (
    `<path d="${body}" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>` +
    (detail ? `<path d="${detail}" fill="none" stroke="currentColor" stroke-width="0.8" stroke-opacity="0.7"/>` : '')
  );
}

// noz draws a small engine-nozzle trapezoid at the stern (centre x, top y,
// half-widths w→w2 over depth d). Makes the rear — hence the heading — read
// at any rotation.
function noz(x: number, y: number, w: number, w2: number, d: number): string {
  return `<path d="M${x - w},${y} L${x + w},${y} L${x + w2},${y + d} L${x - w2},${y + d} Z" fill="currentColor" fill-opacity="0.5" stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/>`;
}

// octagon returns an 8-sided path of "radius" r — the station/shipyard/gate
// frame in the final set.
export function octagon(r: number): string {
  const a = r * 0.62;
  return `M${-r},${-a} L${-a},${-r} L${a},${-r} L${r},${-a} L${r},${a} L${a},${r} L${-a},${r} L${-r},${a} Z`;
}

// HULL_BODY — raw silhouette markup per class (authored coords, nose-up).
// Normalised to a uniform per-tier height by HULL_NORM at render time.
export const HULL_BODY: Record<ShipCategory, string> = {
  TL:
    `<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><rect x="-4.6" y="-6" width="9.2" height="12" fill="currentColor" fill-opacity="0.2"/><line x1="-4.6" y1="-2" x2="4.6" y2="-2"/><line x1="-4.6" y1="2" x2="4.6" y2="2"/></g>` +
    noz(-2.3, 6, 1, 0.75, 1.9) + noz(2.3, 6, 1, 0.75, 1.9),
  M1: sil('M-2.6,-12 L2.6,-12 L5,-5 L5,12 L-5,12 L-5,-5 Z', 'M-5,1 L5,1 M-5,6.5 L5,6.5') + noz(-2.6, 12, 1, 0.75, 1.9) + noz(2.6, 12, 1, 0.75, 1.9),
  M2: sil('M0,-12 L2.6,3 L4.9,11 L-4.9,11 L-2.6,3 Z') + noz(-2.3, 11, 0.95, 0.7, 1.8) + noz(2.3, 11, 0.95, 0.7, 1.8),
  TS:
    `<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><rect x="-3.2" y="-4.2" width="6.4" height="8.4" fill="currentColor" fill-opacity="0.2"/><line x1="-3.2" y1="-1.8" x2="3.2" y2="-1.8"/></g>` +
    noz(0, 4.2, 1, 0.75, 1.7),
  M6: sil('M0,-8 L3,-2 L2.4,4.5 L1.6,7.6 L-1.6,7.6 L-2.4,4.5 L-3,-2 Z') + noz(0, 7.6, 0.9, 0.65, 1.8),
  XX: sil('M0,-8.5 L1.4,-3 L1.8,1 L6,4 L2,3.6 L2.4,7.5 L-2.4,7.5 L-2,3.6 L-6,4 L-1.8,1 L-1.4,-3 Z', 'M0,-3 L0,7') + noz(-1.2, 7.5, 0.8, 0.6, 1.6) + noz(1.2, 7.5, 0.8, 0.6, 1.6),
  M3: sil('M0,-7 L1.5,2 L4.7,4.8 L4.7,6.2 L1.4,5.2 L0,7 L-1.4,5.2 L-4.7,6.2 L-4.7,4.8 L-1.5,2 Z'),
  M4: sil('M0,-5.5 L1.5,-0.6 L3.8,4 L1.3,2.4 L0,3.1 L-1.3,2.4 L-3.8,4 L-1.5,-0.6 Z'),
  M5: sil('M0,-5 L1.2,1.4 L0,5 L-1.2,1.4 Z'),
};

// HULL_NORM — per-class normalisation transform (centre to (0,0) + scale to a
// uniform per-tier height). Proportions extracted from the designer sheet's
// getBBox layout (tier ladder TL/M1/M2/XX 100% → M6 90% → M3/TS 80% → M4 70% →
// M5 60%); every scale is then halved so the map glyphs sit at 50% of the
// sheet size (less clutter in dense sectors). The panel icon compensates via
// its viewBox so contacts-list icons keep their display size.
export const HULL_NORM: Record<ShipCategory, string> = {
  TL: 'scale(0.9353) translate(0 -0.95)',
  M1: 'scale(0.502) translate(0 -0.95)',
  M2: 'scale(0.5242) translate(0 -0.4)',
  XX: 'scale(0.7387) translate(0 -0.3)',
  M6: 'scale(0.6724) translate(0 -0.7)',
  M3: 'scale(0.7429) translate(0 0)',
  TS: 'scale(1.0297) translate(0 -0.85)',
  M4: 'scale(0.9579) translate(0 0.75)',
  M5: 'scale(0.78) translate(0 0)',
};

// HULL_TIER — relative size per class (drives the panel icon viewBox so the
// contacts list shows the same honest size ladder as the map).
export const HULL_TIER: Record<ShipCategory, number> = {
  TL: 1, M1: 1, M2: 1, XX: 1, M6: 0.9, M3: 0.8, TS: 0.8, M4: 0.7, M5: 0.6,
};

// Non-ship silhouettes (native coords, no tier scaling).
export const DRONE_BODY = `<path d="M0,-3.6 L1,-0.8 L2.7,3 L0,1.6 L-2.7,3 L-1,-0.8 Z" fill="currentColor" fill-opacity="0.4" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/>`;
export const MISSILE_BODY = `<g stroke="currentColor" stroke-linejoin="round"><path d="M0,-5 L1.3,-2.2 L1.3,3.2 L-1.3,3.2 L-1.3,-2.2 Z" fill="currentColor" fill-opacity="0.3" stroke-width="0.9"/><path d="M1.3,1.2 L2.9,4.3 L1.3,3.2 Z" fill="currentColor" fill-opacity="0.5" stroke-width="0.7"/><path d="M-1.3,1.2 L-2.9,4.3 L-1.3,3.2 Z" fill="currentColor" fill-opacity="0.5" stroke-width="0.7"/><path d="M-0.7,3.2 L0.7,3.2 L0.5,4.6 L-0.5,4.6 Z" fill="currentColor" fill-opacity="0.7" stroke="none"/></g>`;
export const SATELLITE_BODY = `<path d="M0,-3.1 L2.7,-1.55 L2.7,1.55 L0,3.1 L-2.7,1.55 L-2.7,-1.55 Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1"/><rect x="-8" y="-2" width="4" height="4" fill="currentColor" fill-opacity="0.45" stroke="currentColor" stroke-width="0.6"/><rect x="4" y="-2" width="4" height="4" fill="currentColor" fill-opacity="0.45" stroke="currentColor" stroke-width="0.6"/><path d="M-6,-2 L-6,2 M6,-2 L6,2" stroke="currentColor" stroke-width="0.5" stroke-opacity="0.7" fill="none"/>`;

// fallbackBySpeed maps a missing hullCategory to a coarse category from the
// ship's maxSpeed (the pre-10.13 heuristic): fast = scout, mid = fighter,
// slow = destroyer. Only hit for spacesuit/legacy ships the backend can't
// classify; a spacesuit is drawn by its own icon, not this.
function fallbackBySpeed(maxSpeed: number): ShipCategory {
  if (maxSpeed >= 45) return 'M5';
  if (maxSpeed >= 20) return 'M4';
  return 'M2';
}

// categoryForShip resolves the silhouette category: the backend-sent
// hullCategory when present, else the maxSpeed heuristic.
export function categoryForShip(ship: { hullCategory?: string; maxSpeed: number }): ShipCategory {
  const c = ship.hullCategory as ShipCategory | undefined;
  if (c && c in HULL_BODY) return c;
  return fallbackBySpeed(ship.maxSpeed);
}

// Relation is the object's stance toward the observer — drives the colour.
export type Relation = 'self' | 'ally' | 'neutral' | 'hostile';

// HOSTILE_RACES are factions hostile to every player by canon (pirates 6,
// Xenon 7, Kha'ak 8). Precise per-player standing (phases 6.02 / 9.4) is a
// follow-up; until then these read red and own-race NPC read green.
const HOSTILE_RACES = new Set<number>([6, 7, 8]);

// shipRelation derives the 4-way stance from data already on the client —
// never from isNPC alone (an NPC trader can be ally/neutral/hostile by race):
//   self    — the player's own ship
//   hostile — a hostile-race ship, or another human player
//   ally    — an NPC of the player's own race
//   neutral — any other NPC (other-race civilians/traders)
export function shipRelation(ship: TrackedShip, ownPlayerID: number, ownRace: number): Relation {
  if (ship.playerID === ownPlayerID) return 'self';
  const race = ship.race ?? 0;
  if (race !== 0 && HOSTILE_RACES.has(race)) return 'hostile';
  if (ship.isNPC) {
    if (race !== 0 && ownRace !== 0 && race === ownRace) return 'ally';
    return 'neutral';
  }
  return 'hostile'; // another human player
}

// relationColor maps a relation to its oklch token (App.css). Colour rules
// unchanged by the icon redesign.
export function relationColor(rel: Relation): string {
  switch (rel) {
    case 'self':
      return 'var(--cyan)';
    case 'ally':
      return 'var(--good)';
    case 'neutral':
      return 'var(--warn)';
    case 'hostile':
      return 'var(--danger)';
  }
}
