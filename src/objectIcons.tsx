import { EntityKind } from './api';
import type { TrackedShip } from './useWorldState';
import type { PickedObject } from './ObjectActionsMenu';
import { ShipHullIcon } from './sector/shapes';
import { categoryForShip, relationColor, shipRelation } from './sector/shapeData';

// ObjectMarker is the small inline SVG glyph next to each contact row in
// the "Контакты" list. Shape carries the kind/class (ship silhouette by
// hullCategory; ring/bracket/square for statics; violet rings for gates);
// colour carries relation (self/ally/neutral/hostile for ships; type/race
// tint for statics). Mirrors the SVG ObjectLayer glyphs — same shape and
// colour family so a contact row and its map marker read as one object.
type Props = {
  picked: PickedObject;
  ships: Map<number, TrackedShip>;
  ownPlayerID: number;
  // ownRace is the player's own faction — drives the ally/neutral split of
  // NPC ships, matching the map's relation colouring (phase 10.13).
  ownRace: number;
  size?: number;
};

export function ObjectMarker({ picked, ships, ownPlayerID, ownRace, size = 14 }: Props) {
  if (picked.kind === 'ship') {
    const ship = ships.get(picked.id);
    if (!ship) return null;
    const colour = relationColor(shipRelation(ship, ownPlayerID, ownRace));
    return <ShipHullIcon category={categoryForShip(ship)} color={colour} size={size} />;
  }

  if (picked.kind === 'gate') {
    // Concentric hollow rings (portal) — matches the canvas gate glyph and
    // reads apart from the trade-station ring (whose core is a filled dot).
    const c = 'var(--violet)';
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="sw-target-marker" aria-hidden>
        <circle cx="7" cy="7" r="5.4" fill="none" stroke={c} strokeWidth="1.2" />
        <circle cx="7" cy="7" r="2.4" fill="none" stroke={c} strokeWidth="1.1" />
      </svg>
    );
  }

  if (picked.kind === 'container') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="sw-target-marker" aria-hidden>
        <rect x="3" y="3" width="8" height="8" fill="none" stroke="var(--amber)" strokeWidth="1.2" />
        <path d="M3 5 L11 5" stroke="var(--amber)" strokeWidth="1.1" />
      </svg>
    );
  }

  if (picked.kind === 'asteroid') {
    // Irregular rock lump — mirrors the canvas AsteroidGlyph so a contact row
    // and its map marker read as the same object (phase 10.3.6).
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="sw-target-marker" aria-hidden>
        <path d="M2 5 L4 2 L9 2 L12 5 L11 10 L7 12 L3 11 L2 7 Z" fill="none" stroke="var(--steel, #8a98a6)" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    );
  }

  // dock kinds — shapes echo the original StarWind icons and the canvas
  // glyphs in SectorCanvas, so a contact row and its map marker read as the
  // same object. Trade station = ring + core, pirate base = nested square,
  // station/shipyard = L-corner brackets around a type letter. Stations carry
  // a per-type letter (picked.letter, e.g. E/O/R/L from the original sprite);
  // shipyards fall back to the fixed 'Y'.
  if (picked.ref.kind === EntityKind.TradeStation) {
    return <RingMarker size={size} colour="var(--green)" />;
  }
  if (picked.ref.kind === EntityKind.Pirbase) {
    return <NestedSquareMarker size={size} colour="var(--red)" />;
  }
  const letter = picked.letter ?? letterFor(picked.ref.kind);
  if (letter == null) return null;
  const c = colourFor(picked.ref.kind);
  return <BracketMarker size={size} colour={c} letter={letter} />;
}

function RingMarker({ size, colour }: { size: number; colour: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="sw-target-marker" aria-hidden>
      <circle cx="7" cy="7" r="5" fill="none" stroke={colour} strokeWidth="1.3" />
      <circle cx="7" cy="7" r="1.8" fill={colour} />
    </svg>
  );
}

function NestedSquareMarker({ size, colour }: { size: number; colour: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="sw-target-marker" aria-hidden>
      <rect x="2" y="2" width="10" height="10" fill="none" stroke={colour} strokeWidth="1.2" />
      <rect x="5" y="5" width="4" height="4" fill="none" stroke={colour} strokeWidth="1.1" />
    </svg>
  );
}

function BracketMarker({ size, colour, letter }: { size: number; colour: string; letter: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="sw-target-marker" aria-hidden>
      {/* 4 L-corner brackets */}
      <path d="M2 5 L2 2 L5 2" stroke={colour} strokeWidth="1.1" fill="none" />
      <path d="M9 2 L12 2 L12 5" stroke={colour} strokeWidth="1.1" fill="none" />
      <path d="M2 9 L2 12 L5 12" stroke={colour} strokeWidth="1.1" fill="none" />
      <path d="M9 12 L12 12 L12 9" stroke={colour} strokeWidth="1.1" fill="none" />
      <text
        x="7"
        y="9.6"
        fill={colour}
        fontFamily="ui-monospace, monospace"
        fontSize="7"
        fontWeight="700"
        textAnchor="middle"
      >
        {letter}
      </text>
    </svg>
  );
}

function letterFor(kind: number): string | null {
  switch (kind) {
    case EntityKind.Station: return 'S';
    case EntityKind.Shipyard: return 'Y';
    default: return null;
  }
}

function colourFor(kind: number): string {
  switch (kind) {
    case EntityKind.Station: return 'var(--cyan)';
    case EntityKind.Shipyard: return 'var(--amber)';
    default: return 'var(--ink-mute)';
  }
}
