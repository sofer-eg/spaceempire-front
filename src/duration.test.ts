// Boundary tests for the shared duration formatter (TASK-142, TASK-174). Every
// one of these was reachable during verification only by pinning the browser
// clock and forcing a re-render — a procedure nobody will repeat for a routine
// refactor, which is exactly why the regimes need pinning here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatDuration, formatTtl } from './duration.ts';

const NOW = Date.parse('2026-07-29T12:00:00.000Z');
// at(seconds) builds an endsAt that is `seconds` in the future from NOW.
const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

test('formatDuration keeps MM:SS below an hour, where seconds still matter', () => {
  assert.equal(formatDuration(1), '00:01');
  assert.equal(formatDuration(59), '00:59');
  assert.equal(formatDuration(60), '01:00');
  assert.equal(formatDuration(3599), '59:59');
});

// The regime switch is the whole point of the task: unbounded minutes rendered
// «119:25» for a two-hour lot, which reads as 119 hours just as easily.
test('formatDuration switches to hours exactly at 3600s, not one second early or late', () => {
  assert.equal(formatDuration(3599), '59:59', 'one second before is still MM:SS');
  assert.equal(formatDuration(3600), '1 ч 0 мин');
  assert.equal(formatDuration(3601), '1 ч 0 мин');
  assert.equal(formatDuration(4 * 3600 + 21 * 60), '4 ч 21 мин');
});

test('formatDuration switches to days exactly at 24h', () => {
  assert.equal(formatDuration(86399), '23 ч 59 мин', 'one second before is still hours');
  assert.equal(formatDuration(86400), '1 д 0 ч');
  assert.equal(formatDuration(86401), '1 д 0 ч');
  // The backend caps an auction lot at 7 days (auction.MaxDuration), so this is
  // the widest string the «До конца» column ever has to fit.
  assert.equal(formatDuration(7 * 86400), '7 д 0 ч');
  // A quest deadline is not capped by that, and «72ч 0м» is what the quest panel
  // printed here before it shared this formatter (TASK-174).
  assert.equal(formatDuration(3 * 86400), '3 д 0 ч');
  // A leftover half-day: the day count truncates, it does not round to the
  // nearest day, or a lot with 36h left would claim two days.
  assert.equal(formatDuration(36 * 3600), '1 д 12 ч');
  assert.equal(formatDuration(11 * 86400 + 3 * 3600), '11 д 3 ч');
});

// The production chip is the caller that supplies seconds directly, and the one
// whose own formatter had no ceiling on minutes: a cycle over an hour printed
// «72:30» while the auction column on the same screen said «1 ч 12 мин».
test('formatDuration gives a production cycle longer than an hour a named unit', () => {
  assert.equal(formatDuration(72 * 60 + 30), '1 ч 12 мин');
  assert.equal(formatDuration(150), '02:30', 'a minute-scale cycle still counts down');
});

test('formatDuration shows an elapsed or unusable count as 00:00, never a negative', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(-1), '00:00');
  assert.equal(formatDuration(-3600), '00:00');
  assert.equal(formatDuration(Number.NaN), '00:00');
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), '00:00');
});

// Fractional seconds reach formatDuration through formatTtl, which divides a
// millisecond difference by 1000, so the floor has to live in the formatter. The
// other two callers hand it integers -- MarketView seeds its countdown with
// Math.ceil(prod.secondsRemaining) and the quest panel subtracts unix stamps --
// so formatTtl is the only path that actually exercises this.
test('formatDuration floors a fractional count instead of printing a fraction', () => {
  assert.equal(formatDuration(59.9), '00:59');
  assert.equal(formatDuration(3599.9), '59:59');
  assert.equal(formatDuration(0.4), '00:00');
});

test('formatTtl converts an ISO end stamp against an explicit now', () => {
  assert.equal(formatTtl(at(1), NOW), '00:01');
  assert.equal(formatTtl(at(3599), NOW), '59:59');
  assert.equal(formatTtl(at(3600), NOW), '1 ч 0 мин');
  assert.equal(formatTtl(at(86400), NOW), '1 д 0 ч');
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

// AuctionView calls formatTtl with one argument, so `now = Date.now()` is
// production code — but every test above passes NOW explicitly, which leaves a
// mutant in the default alive (a stuck epoch would report every lot as «00:00»
// and no test would notice). These two read the real clock instead. The 30s of
// slack keeps the first assertion off a regime boundary: anywhere in 7200-7230s
// the answer is «2 ч 0 мин», so it cannot flake on how long the run takes.
test('formatTtl reads the real clock when now is omitted', () => {
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
  assert.equal(formatTtl(iso(2 * 3600_000 + 30_000)), '2 ч 0 мин');
  assert.equal(formatTtl(iso(-3600_000)), '00:00');
});
