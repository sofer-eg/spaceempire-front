// Boundary tests for formatTtl (TASK-142). Every one of these was reachable
// during verification only by pinning the browser clock and forcing a
// re-render — a procedure nobody will repeat for a routine refactor, which is
// exactly why the regimes need pinning here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatTtl } from './lotTtl.ts';

const NOW = Date.parse('2026-07-29T12:00:00.000Z');
// at(seconds) builds an endsAt that is `seconds` in the future from NOW.
const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

test('formatTtl keeps MM:SS below an hour, where seconds still matter', () => {
  assert.equal(formatTtl(at(1), NOW), '00:01');
  assert.equal(formatTtl(at(59), NOW), '00:59');
  assert.equal(formatTtl(at(60), NOW), '01:00');
  assert.equal(formatTtl(at(3599), NOW), '59:59');
});

// The regime switch is the whole point of the task: unbounded minutes rendered
// «119:25» for a two-hour lot, which reads as 119 hours just as easily.
test('formatTtl switches to hours exactly at 3600s, not one second early or late', () => {
  assert.equal(formatTtl(at(3599), NOW), '59:59', 'one second before is still MM:SS');
  assert.equal(formatTtl(at(3600), NOW), '1 ч 0 мин');
  assert.equal(formatTtl(at(3601), NOW), '1 ч 0 мин');
  assert.equal(formatTtl(at(4 * 3600 + 21 * 60), NOW), '4 ч 21 мин');
});

test('formatTtl switches to days exactly at 24h', () => {
  assert.equal(formatTtl(at(86399), NOW), '23 ч 59 мин', 'one second before is still hours');
  assert.equal(formatTtl(at(86400), NOW), '1 д 0 ч');
  assert.equal(formatTtl(at(86401), NOW), '1 д 0 ч');
  // The backend caps a lot at 7 days (auction.MaxDuration), so this is the
  // widest string the column ever has to fit.
  assert.equal(formatTtl(at(7 * 86400), NOW), '7 д 0 ч');
});

test('formatTtl shows an expired lot as 00:00 rather than counting backwards', () => {
  assert.equal(formatTtl(at(0), NOW), '00:00');
  assert.equal(formatTtl(at(-1), NOW), '00:00');
  assert.equal(formatTtl(at(-3600), NOW), '00:00');
});

// NaN fails every comparison, so without its own test the guard can be dropped
// and only an unparseable date from the backend would reveal it — as «NaN:NaN».
test('formatTtl survives a date it cannot parse', () => {
  assert.equal(formatTtl('not a date', NOW), '00:00');
  assert.equal(formatTtl('', NOW), '00:00');
});
