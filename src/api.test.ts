// Unit tests for the pure Russian error mappers in api.ts: jumpDriveErrorText
// (up_jump_drive, TASK-129) and installErrorText (install-satellite /
// install-jammer, TASK-149). Run with the Node built-in test runner
// (`npm run test`, i.e. `node --test`); the mappers are DOM-free, so importing
// ./api.ts directly is safe (that module has no top-level browser access).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, installErrorText, isOutcomeUnknown, jumpDriveErrorText } from './api.ts';

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
  assert.match(misconfigured, /Установка сейчас недоступна на стороне сервера/);
  assert.doesNotMatch(misconfigured, /попробуйте ещё раз/i);
  // Cautious, but without claiming a later retry is pointless: the commonest
  // non-sentinel 503 is a backend that is simply down, and it will come back.
  assert.doesNotMatch(misconfigured, /не поможет/i);
  const busy = installErrorText(new ApiError(503, 'sector busy'), 'jammer');
  assert.equal(busy, 'Сектор занят, попробуйте ещё раз.');
  assert.notEqual(misconfigured, busy);
});

// Only the explicit ErrInboxFull sentinel earns the retryable line: "sector
// busy" is one hand-written literal away from a backend rewording, and 503 also
// arrives from proxies with a generic body. Anything unrecognised must fall to
// the cautious side, not to «попробуйте ещё раз».
test('installErrorText treats an unrecognised 503 as non-retryable', () => {
  for (const body of ['Service Unavailable', 'sector: static installer not wired']) {
    const text = installErrorText(new ApiError(503, body), 'jammer');
    assert.doesNotMatch(text, /попробуйте ещё раз/i, `503 «${body}» must not invite a retry`);
    assert.equal(text, installErrorText(new ApiError(503, 'install unavailable: server misconfigured'), 'jammer'));
  }
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

// The commonest way to lose an ack is not 504 but a dead connection: fetch
// rejects with a TypeError, which never reaches the status switch. It must read
// like 504 — «TypeError: Failed to fetch» says nothing and looks like "nothing
// happened", which is how a player ends up deploying a second ≈1.13M cr
// generator.
test('installErrorText gives a dropped connection the same unknown-outcome line as 504', () => {
  const dropped = installErrorText(new TypeError('Failed to fetch'), 'jammer');
  assert.equal(dropped, installErrorText(new ApiError(504, 'command timeout'), 'jammer'));
  assert.match(dropped, /исход неизвестен/i);
  assert.doesNotMatch(dropped, /Failed to fetch/);

  // Same for a non-Error rejection and for the satellite wording.
  assert.equal(
    installErrorText('boom', 'satellite'),
    installErrorText(new ApiError(504, 'command timeout'), 'satellite'),
  );
});

// In production Apache proxies to the Go process, so a backend that dies after
// the request was forwarded (restart, deploy, worker panic) surfaces as 502 —
// the request landed, the answer did not. Exactly 504's situation, and the one
// most likely to hit a player mid-deploy.
test('installErrorText 502 reads as an unknown outcome, not as a failure', () => {
  const badGateway = installErrorText(new ApiError(502, 'Bad Gateway'), 'jammer');
  assert.equal(badGateway, installErrorText(new ApiError(504, 'command timeout'), 'jammer'));
  assert.match(badGateway, /исход неизвестен/i);
  assert.doesNotMatch(badGateway, /не смог|не прошла/i);
  assert.doesNotMatch(badGateway, /Bad Gateway/);
});

// isOutcomeUnknown states the in-doubt set once, for installErrorText to ask.
// A proxy 503 stays out: it means the connection was never established, so the
// command cannot have been enqueued.
test('isOutcomeUnknown covers 502, 504 and non-ApiError failures only', () => {
  assert.equal(isOutcomeUnknown(new ApiError(504, 'command timeout')), true);
  assert.equal(isOutcomeUnknown(new ApiError(502, 'Bad Gateway')), true);
  assert.equal(isOutcomeUnknown(new TypeError('Failed to fetch')), true);
  assert.equal(isOutcomeUnknown('boom'), true);
  assert.equal(isOutcomeUnknown(new ApiError(400, 'no jammer in cargo')), false);
  assert.equal(isOutcomeUnknown(new ApiError(503, 'sector busy')), false);
  assert.equal(isOutcomeUnknown(new ApiError(503, 'Service Unavailable')), false);
  assert.equal(isOutcomeUnknown(new ApiError(500, 'boom')), false);
});

test('installErrorText hides raw 5xx bodies without asserting the install failed', () => {
  // install_satellite.go's default branch passes the repository error through
  // verbatim, so a Postgres message could otherwise land in the combat HUD.
  const text = installErrorText(
    new ApiError(500, 'ERROR: duplicate key value violates unique constraint "satellites_pkey"'),
    'satellite',
  );
  assert.doesNotMatch(text, /constraint/);
  // A RepoTimeout deadline struck on COMMIT answers 500 over a transaction that
  // may have committed, so the line may not flatly claim nothing happened.
  assert.doesNotMatch(text, /не смог выполнить/);
  assert.match(text, /проверьте трюм и радар/i);

  assert.equal(
    installErrorText(new ApiError(401, 'not authenticated'), 'jammer'),
    'Сессия истекла — войдите в игру заново.',
  );
});

test('installErrorText echoes unmapped non-5xx statuses', () => {
  assert.equal(installErrorText(new ApiError(409, 'unexpected conflict'), 'jammer'), 'unexpected conflict');
});
