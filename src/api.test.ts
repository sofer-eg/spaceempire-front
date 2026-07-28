// Unit tests for the pure Russian error mappers in api.ts: jumpDriveErrorText
// (up_jump_drive, TASK-129) and installErrorText (install-satellite /
// install-jammer, TASK-149). Run with the Node built-in test runner
// (`npm run test`, i.e. `node --test`); the mappers are DOM-free, so importing
// ./api.ts directly is safe (that module has no top-level browser access).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, installErrorText, jumpDriveErrorText } from './api.ts';

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

// TASK-131: 409 is overloaded by the backend — ErrShipDocked ("ship is docked")
// and ErrJumpBlockedByAntijump ("jump blocked by antijump field", raised both by
// a powered up_antijump ship and by a deployed hyper-interference generator).
// Reported live: a jammed jump used to tell the player they were docked.
test('jumpDriveErrorText disambiguates the two 409 branches by sentinel text', () => {
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'jump blocked by antijump field')),
    'Гипер-помехи глушат прыжок: рядом генератор гипер-помех или корабль с полем подавления.',
  );
  // Case-insensitive substring match.
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'Jump blocked by ANTIJUMP field')),
    'Гипер-помехи глушат прыжок: рядом генератор гипер-помех или корабль с полем подавления.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'ship is docked')),
    'Нельзя прыгнуть пристыкованным — сначала отстыкуйтесь.',
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

// --- installErrorText (TASK-149) -------------------------------------------
// Sentinels mirror back/internal/api/install_satellite.go + install_jammer.go.

test('installErrorText maps the unambiguous install statuses', () => {
  assert.equal(installErrorText(new ApiError(404, 'ship not found'), 'satellite'), 'Корабль не найден.');
  assert.equal(
    installErrorText(new ApiError(403, 'ship belongs to another player'), 'jammer'),
    'Это не ваш корабль.',
  );
});

test('installErrorText disambiguates the three 400 branches by sentinel text', () => {
  assert.equal(
    installErrorText(new ApiError(400, 'ship is docked'), 'satellite'),
    'Нельзя разворачивать оборудование пристыкованным — сначала отстыкуйтесь.',
  );
  assert.equal(
    installErrorText(new ApiError(400, 'no satellite in cargo'), 'satellite'),
    'В трюме нет спутников.',
  );
  assert.equal(
    installErrorText(new ApiError(400, 'no jammer in cargo'), 'jammer'),
    'В трюме нет генераторов гипер-помех.',
  );
  assert.equal(
    installErrorText(new ApiError(400, 'invalid request fields'), 'jammer'),
    'Некорректный запрос на установку.',
  );
});

// AC-3: ErrInstallerUnavailable is a server wiring fault, so it must not read as
// the retryable «сектор занят» (ErrInboxFull) line.
test('installErrorText separates the misconfigured installer from a busy sector', () => {
  const misconfigured = installErrorText(
    new ApiError(503, 'install unavailable: server misconfigured'),
    'jammer',
  );
  assert.equal(
    misconfigured,
    'Установка недоступна: сервер не сконфигурирован. Повтор не поможет — сообщите администрации.',
  );
  const busy = installErrorText(new ApiError(503, 'sector busy'), 'jammer');
  assert.equal(busy, 'Сектор занят, попробуйте ещё раз.');
  assert.notEqual(misconfigured, busy);
});

// AC-2: since TASK-144 the goods debit commits with the object INSERT, so 504
// means "outcome unknown" — the line must not tell the player to just retry.
test('installErrorText 504 says the outcome is unknown instead of inviting a retry', () => {
  const satellite = installErrorText(new ApiError(504, 'command timeout'), 'satellite');
  assert.match(satellite, /исход неизвестен/i);
  assert.match(satellite, /Спутник мог быть уже развёрнут/);
  assert.match(satellite, /Проверьте трюм и радар/);
  assert.doesNotMatch(satellite, /попробуйте ещё раз/i);

  const jammer = installErrorText(new ApiError(504, 'command timeout'), 'jammer');
  assert.match(jammer, /Генератор гипер-помех мог быть уже развёрнут/);
  assert.doesNotMatch(jammer, /попробуйте ещё раз/i);
});

test('installErrorText echoes unmapped statuses and stringifies non-ApiError inputs', () => {
  assert.equal(
    installErrorText(new ApiError(500, 'satellite goods type missing'), 'satellite'),
    'satellite goods type missing',
  );
  assert.equal(installErrorText(new Error('boom'), 'jammer'), 'Error: boom');
  assert.equal(installErrorText('plain string failure', 'jammer'), 'plain string failure');
});
