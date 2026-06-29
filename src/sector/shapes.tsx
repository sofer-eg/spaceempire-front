// Shape components for the sector-map SVG object layer (phase 10.13).
//
// Renders the silhouette data from shapeData into reusable SVG: the overlay
// <defs> (referenced by <use href="#hull-XX">) and the per-object glyphs. One
// source of truth so the map overlay and the contacts-panel icon read as the
// same family. Geometry uses currentColor so the same symbol renders in any
// relation colour. Ship hulls carry the markup as a trusted static string and
// are injected with dangerouslySetInnerHTML (the markup is ours, never user
// input) so the multi-element silhouettes (hull + engine nozzles) stay
// compact.

import {
  HULL_BODY,
  HULL_NORM,
  HULL_TIER,
  SHIP_CATEGORIES,
  DRONE_BODY,
  MISSILE_BODY,
  TORPEDO_BODY,
  SATELLITE_BODY,
  octagon,
  type ShipCategory,
} from './shapeData';

// ShapeDefs renders the reusable <defs> for the overlay: one normalised <g>
// per ship hull (referenced by <use href="#hull-XX">) plus the drone, missile
// and satellite silhouettes. Geometry uses currentColor so each <use> picks up
// its node's relation colour. Rendered once inside the overlay <svg>.
export function ShapeDefs() {
  return (
    <defs>
      {SHIP_CATEGORIES.map((cat) => (
        <g key={cat} id={`hull-${cat}`} transform={HULL_NORM[cat]} dangerouslySetInnerHTML={{ __html: HULL_BODY[cat] }} />
      ))}
      <g id="hull-drone" dangerouslySetInnerHTML={{ __html: DRONE_BODY }} />
      <g id="hull-missile" dangerouslySetInnerHTML={{ __html: MISSILE_BODY }} />
      <g id="hull-torpedo" dangerouslySetInnerHTML={{ __html: TORPEDO_BODY }} />
      <g id="hull-satellite" dangerouslySetInnerHTML={{ __html: SATELLITE_BODY }} />
    </defs>
  );
}

// --- Static-object glyphs (no heading, fixed position) ----------------------
// Each renders a <g style={{color}}> so the currentColor-based geometry picks
// up the race tint / per-type fallback passed by the caller (not relation).

export function StationGlyph({ color, letter }: { color: string; letter: string }) {
  return (
    <g style={{ color }}>
      <path d={octagon(8)} fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      {letter && (
        <text x={0} y={0.5} fill="currentColor" stroke="none" fontFamily="ui-monospace, monospace" fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="central">
          {letter}
        </text>
      )}
    </g>
  );
}

export function ShipyardGlyph({ color }: { color: string }) {
  return <StationGlyph color={color} letter="Y" />;
}

export function TradeStationGlyph({ color }: { color: string }) {
  return (
    <g style={{ color }}>
      <circle cx={0} cy={0} r={7} fill="none" stroke="currentColor" strokeWidth={1.4} />
      <circle cx={0} cy={0} r={2.4} fill="currentColor" stroke="none" />
    </g>
  );
}

export function PirbaseGlyph({ color }: { color: string }) {
  return (
    <g style={{ color }}>
      <path d="M0,-9 L9,0 L0,9 L-9,0 Z" fill="none" stroke="currentColor" strokeWidth={1.3} />
      <path d="M0,-4 L4,0 L0,4 L-4,0 Z" fill="currentColor" fillOpacity={0.25} stroke="none" />
    </g>
  );
}

export function GateGlyph({ color, letter, label }: { color: string; letter?: string; label?: string }) {
  return (
    <g style={{ color }}>
      <path d={octagon(10)} fill="currentColor" fillOpacity={0.1} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      {letter && (
        <text x={0} y={0.5} fill="currentColor" stroke="none" fontFamily="ui-monospace, monospace" fontSize={10} fontWeight={700} textAnchor="middle" dominantBaseline="central">
          {letter}
        </text>
      )}
      {label && (
        <text x={0} y={22} fill="currentColor" fontFamily="ui-monospace, monospace" fontSize={9} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

export function LaserTowerGlyph({ color }: { color: string }) {
  return (
    <g style={{ color }}>
      <path d="M0,-8 L0,8 M-4,-3 L4,-3 M-5.5,3 L5.5,3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <circle cx={0} cy={-8} r={1.6} fill="currentColor" stroke="none" />
    </g>
  );
}

// SatelliteGlyph renders a player-deployed navigation satellite (phase 10.15)
// using the 10.13 silhouette (#hull-satellite: a panelled beacon), tinted by
// owner race. Static — no heading, like the laser tower.
export function SatelliteGlyph({ color }: { color: string }) {
  return (
    <g style={{ color }}>
      <use href="#hull-satellite" />
    </g>
  );
}

export function ContainerGlyph({ color }: { color: string }) {
  return (
    <g style={{ color }}>
      <rect x={-5} y={-5} width={10} height={10} fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeWidth={1.4} />
      <path d="M-5,-3 L5,-3" fill="none" stroke="currentColor" strokeWidth={1.4} />
    </g>
  );
}

// AsteroidGlyph renders a minable ore body (phase 10.3.6): an irregular rocky
// lump, distinct from the square container so the two read apart on the radar.
// Tinted by the caller (greyish ore colour); a couple of pits hint at texture.
export function AsteroidGlyph({ color }: { color: string }) {
  return (
    <g style={{ color }}>
      <path d="M-6,-3 L-3,-6 L3,-6 L6,-2 L5,4 L1,6 L-4,5 L-6,1 Z" fill="currentColor" fillOpacity={0.22} stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
      <circle cx={-1.5} cy={-1} r={1.1} fill="currentColor" fillOpacity={0.5} stroke="none" />
      <circle cx={2} cy={2} r={0.9} fill="currentColor" fillOpacity={0.5} stroke="none" />
    </g>
  );
}

// Spacesuit — the weak pilot "ship" a player drops into (phase 10.1). A small
// helmet/figure, drawn instead of a hull silhouette. Authored nose-up so it
// still rotates with heading.
export function SpacesuitGlyph() {
  return (
    <g fill="currentColor" stroke="currentColor">
      <circle cx={0} cy={-1} r={3} fillOpacity={0.25} strokeWidth={1} />
      <path d="M0,-4 L0,-5.5" strokeWidth={1} />
    </g>
  );
}

// --- Contacts-panel ship icon ----------------------------------------------

// ShipHullIcon renders a class silhouette into a size×size box for the
// contacts panel — same normalised geometry as the map, nose-up, no rotation.
// The viewBox frames the class's tier height so the list shows the same honest
// size ladder as the map. Colour comes from the caller (relation).
export function ShipHullIcon({ category, color, size = 14 }: { category: ShipCategory; color: string; size?: number }) {
  const e = 7 * HULL_TIER[category];
  return (
    <svg width={size} height={size} viewBox={`${-e} ${-e} ${e * 2} ${e * 2}`} className="sw-hull-icon sw-target-marker" aria-hidden style={{ color }}>
      <g transform={HULL_NORM[category]} dangerouslySetInnerHTML={{ __html: HULL_BODY[category] }} />
    </svg>
  );
}
