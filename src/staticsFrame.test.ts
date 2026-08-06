// Unit tests for applyStaticsFrame — the pure fold of the WS `statics` frame
// (TASK-186). Run with the Node built-in runner (`npm run test`). The module is
// React-free and DOM-free, so importing it directly is safe.
//
// What these hold down is the seed: the frame is the only message carrying the
// live hull/shield of a sector's statics, and before TASK-186 this code path
// EMPTIED staticCombat instead — which is why a reloaded page, or a jump to the
// neighbour and back, showed the «Бой» panel nothing but the spawn layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EntityKind, staticKey, type DestructibleStatic, type StaticsMessage } from './api.ts';
import { applyStaticsFrame } from './staticsFrame.ts';
import type { TrackedShip, WorldState } from './useWorldState.ts';

const JAMMER: DestructibleStatic = { ref: { kind: EntityKind.Jammer, id: 10 }, hp: 2500, shield: 0, maxShield: 0 };
const TOWER: DestructibleStatic = { ref: { kind: EntityKind.LaserTower, id: 1 }, hp: 50000, shield: 50000, maxShield: 50000 };

// A previous state with the fields the fold reads, and a stale combat map to
// prove the frame replaces it rather than merging into it.
function prevState(over: Partial<WorldState> = {}): WorldState {
  return {
    sectorID: 1,
    statics: {},
    staticCombat: new Map([['stale', { ref: { kind: EntityKind.Station, id: 99 }, hp: 1, shield: 1, maxShield: 1 }]]),
    ships: new Map<number, TrackedShip>([[1283, { id: 1283 } as TrackedShip]]),
    asteroids: new Map(),
    tickIntervalMs: 3000,
    sectorBoundsRadius: 1000,
    nearZoomRadius: 500,
    dockRange: 30,
    gateRange: 40,
    ...over,
  } as WorldState;
}

function frame(over: Partial<StaticsMessage> = {}): StaticsMessage {
  return {
    type: 'statics',
    sectorID: 1,
    tickIntervalMs: 0,
    sectorBoundsRadius: 0,
    nearZoomRadius: 0,
    dockRange: 0,
    gateRange: 0,
    statics: {},
    ...over,
  } as StaticsMessage;
}

test('applyStaticsFrame seeds staticCombat from the frame', () => {
  const next = applyStaticsFrame(prevState(), frame({ destructibles: [JAMMER, TOWER] }), null);

  assert.equal(next.staticCombat.size, 2, 'every live static of the frame must be in the map');
  assert.deepEqual(next.staticCombat.get(staticKey(JAMMER.ref)), JAMMER);
  assert.deepEqual(next.staticCombat.get(staticKey(TOWER.ref)), TOWER);
  // The jammer's live hull, not the spawn figure the layout would carry: this is
  // the whole point of the frame's second set.
  assert.equal(next.staticCombat.get(staticKey(JAMMER.ref))?.hp, 2500);
  assert.equal(next.staticCombat.has('stale'), false, 'the frame is total for its sector — no stale entry survives');
});

test('applyStaticsFrame seeds on a plain re-subscribe too, not only on a sector change', () => {
  // fresh === null is the reconnect/subscribe case (same sector). Gating the seed
  // on a sector change would leave a reloaded page with an empty combat map,
  // which is exactly the bug: the sector did not change, the socket did.
  const next = applyStaticsFrame(prevState(), frame({ destructibles: [JAMMER] }), null);

  assert.equal(next.staticCombat.size, 1);
  assert.equal(next.staticCombat.get(staticKey(JAMMER.ref))?.hp, 2500);
});

test('applyStaticsFrame yields an empty combat map when the frame carries no destructibles', () => {
  // A sector with no statics sends no list at all (omitempty on the wire).
  const next = applyStaticsFrame(prevState(), frame(), null);

  assert.equal(next.staticCombat.size, 0);
});

test('applyStaticsFrame swaps in the fresh maps only on a sector change', () => {
  const prev = prevState();
  const fresh = { ships: new Map<number, TrackedShip>(), asteroids: new Map() };

  const jumped = applyStaticsFrame(prev, frame({ sectorID: 2 }), fresh);
  assert.equal(jumped.sectorID, 2);
  assert.equal(jumped.ships, fresh.ships, 'a jump drops the old sector’s contacts');
  assert.equal(jumped.asteroids, fresh.asteroids);

  const stayed = applyStaticsFrame(prev, frame(), null);
  assert.equal(stayed.ships, prev.ships, 'a re-subscribe to the same sector keeps them');
  assert.equal(stayed.asteroids, prev.asteroids);
});

test('applyStaticsFrame keeps the previous scalars when the frame omits them', () => {
  // Guards the viewport: a frame with a zeroed range must not collapse the map.
  const prev = prevState();
  const next = applyStaticsFrame(prev, frame({ sectorID: 0 }), null);

  assert.equal(next.sectorID, prev.sectorID);
  assert.equal(next.tickIntervalMs, prev.tickIntervalMs);
  assert.equal(next.sectorBoundsRadius, prev.sectorBoundsRadius);
  assert.equal(next.nearZoomRadius, prev.nearZoomRadius);
  assert.equal(next.dockRange, prev.dockRange);
  assert.equal(next.gateRange, prev.gateRange);

  const carried = applyStaticsFrame(
    prev,
    frame({ tickIntervalMs: 1000, sectorBoundsRadius: 2000, nearZoomRadius: 600, dockRange: 35, gateRange: 45 }),
    null,
  );
  assert.equal(carried.tickIntervalMs, 1000);
  assert.equal(carried.sectorBoundsRadius, 2000);
  assert.equal(carried.nearZoomRadius, 600);
  assert.equal(carried.dockRange, 35);
  assert.equal(carried.gateRange, 45);
});
