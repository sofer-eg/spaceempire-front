// Unit tests for the pure viewport helpers in sectorViewport.ts. Run with the
// Node built-in test runner (`npm run test:unit`, i.e. `node --test`) — the
// project has no browser-test framework, and these helpers are DOM-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radarFitHalfSide } from './sectorViewport.ts';

// The fit-to-radar half-side must be large enough that a circle of radius R
// still sits inside the square window (halfSide >= R) with a real margin, so
// the dashed radar ring never grazes the shorter canvas edge.
test('radarFitHalfSide wraps the radar circle with ~10% margin', () => {
  const r = 3500; // e.g. an M5 class radar
  const half = radarFitHalfSide(r);
  assert.ok(half >= r, `expected halfSide (${half}) >= radar (${r})`);
  assert.ok(half > r, 'expected a strictly positive margin, not a tight fit');
  assert.equal(half, r * 1.1);
});

test('radarFitHalfSide never drops below the readable floor', () => {
  // A tiny radar still yields a legible window (MIN_HALF_MAX = 300).
  assert.equal(radarFitHalfSide(100), 300);
});

test('radarFitHalfSide handles degenerate radii (no class radar)', () => {
  // Spacesuit / legacy ship: radarRange 0 or missing. The caller gates this
  // mode out, but the helper must still return a safe, finite floor.
  assert.equal(radarFitHalfSide(0), 300);
  assert.equal(radarFitHalfSide(-500), 300);
  assert.equal(radarFitHalfSide(Number.NaN), 300);
  assert.equal(radarFitHalfSide(Number.POSITIVE_INFINITY), 300);
});
