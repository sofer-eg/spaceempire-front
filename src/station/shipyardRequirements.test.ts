// Unit tests for installRequirements — the pure shipyard install-gate logic
// (TASK-100.3.28). Run with the Node built-in test runner (`npm run test`,
// i.e. `node --test`); the module is DOM-free and its ./api import is
// type-only (stripped at runtime), so importing it directly is safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Equipment, Race } from './api.ts';
import { installRequirements, type InstallReqContext } from './shipyardRequirements.ts';

// mkEquip builds an Equipment with harmless defaults (all gates off), so each
// test only sets the field it exercises.
function mkEquip(over: Partial<Equipment> = {}): Equipment {
  return {
    id: 1,
    type: 'up_generator',
    description: 'Генератор',
    maxLevel: 1,
    race: 0,
    shipClass: 0,
    price: 100,
    pricePerLevel: 0,
    isBase: false,
    position: 0,
    dependance: 'none',
    energyUseType: 'none',
    energyUsage: 0,
    minWarRate: 0,
    minTradeRate: 0,
    minRaceRate: 0,
    ...over,
  };
}

const races: Race[] = [{ id: 2, name: 'Аргон', stateName: 'Аргон', color: '#0af' }];

const catalog: Equipment[] = [
  mkEquip({ id: 10, type: 'up_accumulator', description: 'Аккумулятор' }),
];

// baseCtx: standings known, everything satisfied. Individual tests override.
function baseCtx(over: Partial<InstallReqContext> = {}): InstallReqContext {
  return {
    installedTypes: new Set<string>(),
    repKnown: true,
    races,
    shipyardRace: 2,
    raceStanding: 0,
    warRate: 0,
    tradeRate: 0,
    ...over,
  };
}

test('requirement-free module (all thresholds 0, standings >= 0, dep none) → no requirements', () => {
  const e = mkEquip();
  assert.deepEqual(installRequirements(catalog, e, baseCtx()), []);
});

test('missing dependency → human-readable «Сначала установите» via depLabel', () => {
  const e = mkEquip({ type: 'up_pro', dependance: 'up_accumulator' });
  const reqs = installRequirements(catalog, e, baseCtx());
  assert.deepEqual(reqs, ['Сначала установите: Аккумулятор']);
});

test('satisfied dependency (installed) → not listed', () => {
  const e = mkEquip({ type: 'up_pro', dependance: 'up_accumulator' });
  const reqs = installRequirements(
    catalog,
    e,
    baseCtx({ installedTypes: new Set(['up_accumulator']) }),
  );
  assert.deepEqual(reqs, []);
});

test('race gate (minRaceRate=6, standing=0, repKnown) → blocked with threshold and current', () => {
  const e = mkEquip({ minRaceRate: 6 });
  const reqs = installRequirements(catalog, e, baseCtx({ raceStanding: 0 }));
  assert.deepEqual(reqs, ['Нужен ранг с расой Аргон ≥ 6 (у вас 0)']);
});

test('war gate (minWarRate=2, warRate=0) → blocked', () => {
  const e = mkEquip({ minWarRate: 2 });
  const reqs = installRequirements(catalog, e, baseCtx({ warRate: 0 }));
  assert.deepEqual(reqs, ['Нужен боевой ранг ≥ 2 (у вас 0)']);
});

test('trade gate (minTradeRate=3, tradeRate=0) → blocked', () => {
  const e = mkEquip({ minTradeRate: 3 });
  const reqs = installRequirements(catalog, e, baseCtx({ tradeRate: 0 }));
  assert.deepEqual(reqs, ['Нужен торговый ранг ≥ 3 (у вас 0)']);
});

test('standings unknown (repKnown=false) → no reputation lines, only dependency', () => {
  const e = mkEquip({ type: 'up_pro', dependance: 'up_accumulator', minRaceRate: 6, minWarRate: 2 });
  const reqs = installRequirements(catalog, e, baseCtx({ repKnown: false }));
  // Reputation axes suppressed; the dependency line still appears.
  assert.deepEqual(reqs, ['Сначала установите: Аккумулятор']);
});

test('standings unknown (repKnown=false), reputation-only module → no requirements', () => {
  const e = mkEquip({ minRaceRate: 6 });
  assert.deepEqual(installRequirements(catalog, e, baseCtx({ repKnown: false })), []);
});

test('negative standing at zero threshold (minRaceRate=0, standing=-5, repKnown) → blocked (server parity)', () => {
  const e = mkEquip({ minRaceRate: 0 });
  const reqs = installRequirements(catalog, e, baseCtx({ raceStanding: -5 }));
  assert.deepEqual(reqs, ['Нужен ранг с расой Аргон ≥ 0 (у вас -5)']);
});

test('unknown shipyard race falls back to «верфи» label', () => {
  const e = mkEquip({ minRaceRate: 1 });
  const reqs = installRequirements(catalog, e, baseCtx({ shipyardRace: 0, raceStanding: 0 }));
  assert.deepEqual(reqs, ['Нужен ранг с расой верфи ≥ 1 (у вас 0)']);
});
