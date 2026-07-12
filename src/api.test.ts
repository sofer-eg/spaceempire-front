// Unit tests for jumpDriveErrorText — the pure Russian error mapper for the
// up_jump_drive command (TASK-129). Run with the Node built-in test runner
// (`npm run test`, i.e. `node --test`); the mapper is DOM-free, so importing
// ./api.ts directly is safe (that module has no top-level browser access).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, jumpDriveErrorText } from './api.ts';

test('jumpDriveErrorText maps each backend status to a Russian line', () => {
  assert.equal(jumpDriveErrorText(new ApiError(404, 'ship not found')), 'Корабль не найден.');
  assert.equal(
    jumpDriveErrorText(new ApiError(403, 'ship belongs to another player')),
    'Это не ваш корабль.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'ship is docked')),
    'Нельзя прыгнуть пристыкованным — сначала отстыкуйтесь.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(429, 'jump drive not ready')),
    'Прыжковый двигатель ещё не готов — идёт перезарядка.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(503, 'sector busy / handoff unavailable')),
    'Сектор занят, попробуйте ещё раз.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(504, 'command timeout')),
    'Команда не успела выполниться, попробуйте ещё раз.',
  );
});

test('jumpDriveErrorText disambiguates the two 422 branches by sentinel text', () => {
  assert.equal(
    jumpDriveErrorText(new ApiError(422, 'shield generator damaged or missing')),
    'Нужен исправный генератор щита.',
  );
  // Case-insensitive substring match.
  assert.equal(
    jumpDriveErrorText(new ApiError(422, 'SHIELD generator damaged or missing')),
    'Нужен исправный генератор щита.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(422, 'ship has no jump drive')),
    'На корабле нет прыжкового двигателя (up_jump_drive).',
  );
});

test('jumpDriveErrorText disambiguates the two 400 branches by sentinel text', () => {
  assert.equal(
    jumpDriveErrorText(new ApiError(400, 'jump blocked in this sector')),
    'Прыжок из этого сектора запрещён.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(400, 'invalid target sector')),
    'Недопустимый сектор назначения.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(400, 'invalid json')),
    'Недопустимый сектор назначения.',
  );
});

test('jumpDriveErrorText echoes the raw message for an unmapped ApiError status', () => {
  assert.equal(jumpDriveErrorText(new ApiError(418, "I'm a teapot")), "I'm a teapot");
});

test('jumpDriveErrorText stringifies non-ApiError inputs', () => {
  assert.equal(jumpDriveErrorText(new Error('boom')), 'Error: boom');
  assert.equal(jumpDriveErrorText('plain string failure'), 'plain string failure');
});
