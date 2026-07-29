// Unit tests for the Russian error mappers in api.ts: friendlyError (reads,
// TASK-140), commandErrorText (anything that spends credits or moves goods),
// jumpDriveErrorText (up_jump_drive, TASK-129) and installErrorText
// (install-satellite / install-jammer, TASK-149), plus the netFetch wrapper the
// first two classify by. Run with the Node built-in test runner (`npm run
// test`, i.e. `node --test`); the mappers are DOM-free, so importing ./api.ts
// directly is safe (that module has no top-level browser access).
//
// The mappers are deterministic but not side-effect-free: each one console.errors
// the raw failure before returning its Russian line, so a run prints the sample
// errors below to stderr. That is the intended behaviour, not test noise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  NetworkError,
  commandErrorText,
  friendlyError,
  installErrorText,
  isOutcomeUnknown,
  jumpDriveErrorText,
  netFetch,
} from './api.ts';

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

// The commonest way to lose an ack is not 504 but a dead connection: netFetch
// rejects with a NetworkError, which never reaches the status switch. It must
// read like 504 — «Failed to fetch» says nothing and looks like "nothing
// happened", which is how a player ends up deploying a second ≈1.13M cr
// generator.
test('installErrorText gives a dropped connection the same unknown-outcome line as 504', () => {
  const dropped = installErrorText(new NetworkError(new TypeError('Failed to fetch')), 'jammer');
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
  assert.equal(isOutcomeUnknown(new NetworkError(new TypeError('Failed to fetch'))), true);
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

test('friendlyError strips the route prefix off a backend error', () => {
  assert.equal(
    friendlyError(new ApiError(400, 'POST /api/auction/4/bid: bid below current price')),
    'bid below current price',
  );
  // insuranceApi throws a plain Error with the same prefix shape.
  assert.equal(friendlyError(new Error('GET /api/insurance: not found')), 'not found');
});

test('friendlyError words a dead connection in Russian', () => {
  // netFetch rejects with a NetworkError when the request never got an answer —
  // the native cause is the English "Failed to fetch" the UI used to show.
  const text = friendlyError(new NetworkError(new TypeError('Failed to fetch')));
  assert.doesNotMatch(text, /Failed to fetch/);
  assert.match(text, /Нет связи с сервером/);
  // A read may be retried freely, but this same line reaches the player after a
  // POST too if a caller forgets commandErrorText, so it no longer *invites* a
  // retry. The tab's own «Повторить» button is the affordance for that.
  assert.doesNotMatch(text, /повтор/i);
});

test('friendlyError stringifies a non-Error rejection', () => {
  assert.equal(friendlyError('boom'), 'boom');
});

// --- Review of TASK-140 -----------------------------------------------------

// The old mapper branched on `err instanceof TypeError`, which is also what a
// bug in this SPA throws. Demonstrated live: a 200 with a null body makes
// fetchAuctionLots read `.lots` off null, and the tab announced «Нет связи с
// сервером» while the server had answered.
test('friendlyError does not blame the network for a TypeError thrown by our own code', () => {
  const bug = new TypeError("Cannot read properties of null (reading 'lots')");
  const text = friendlyError(bug);
  assert.doesNotMatch(text, /Нет связи с сервером/);
  assert.doesNotMatch(text, /подключение/i);
  // Nor is the V8 sentence itself an answer for a player: it gets its own line,
  // and the raw error stays in the console for whoever reports it.
  assert.doesNotMatch(text, /Cannot read properties/);
  assert.match(text, /Ошибка в интерфейсе игры/);

  // Still distinct from a backend refusal, which is echoed as before.
  assert.equal(friendlyError(new Error('GET /api/insurance: not found')), 'not found');
});

// AC #3: 502/504 come from Apache in front of the Go process, so their body is
// HTML and parseErrorBody falls back to statusText — the English "Bad Gateway"
// the market tab used to print after its Russian prefix.
test('friendlyError words a proxy 502/504 in Russian', () => {
  const badGateway = friendlyError(new ApiError(502, 'POST /api/cmd/trade/buy: Bad Gateway'));
  assert.doesNotMatch(badGateway, /Bad Gateway/);
  assert.match(badGateway, /Сервер не ответил \(502\)/);

  const timeout = friendlyError(new ApiError(504, 'GET /api/auction: Gateway Timeout'));
  assert.match(timeout, /Сервер не ответил \(504\)/);
});

// Over HTTP/2 statusText is always empty, so parseErrorBody returned "" and the
// caller's line ended at its colon: «Покупка 50 × Энергоэлементы: ».
test('friendlyError never returns an empty line for a body-less error', () => {
  const text = friendlyError(new ApiError(500, 'POST /api/cmd/trade/buy: '));
  assert.notEqual(text.trim(), '');
  assert.match(text, /Сервер вернул ошибку 500/);
});

// --- commandErrorText -------------------------------------------------------

// AC #3 + the money half of AC #5: a lost ack does not mean "nothing happened".
// The station commands all charge or move goods inside the same transaction that
// answers, so «повторите» is how a 1 200 000 cr hull gets bought twice.
test('commandErrorText says the outcome is unknown instead of inviting a retry', () => {
  const dropped = commandErrorText(new NetworkError(new TypeError('Failed to fetch')));
  assert.match(dropped, /исход неизвестен/i);
  assert.match(dropped, /Проверьте кошелёк и трюм/);
  assert.doesNotMatch(dropped, /повторите\./i);
  assert.doesNotMatch(dropped, /Failed to fetch/);

  // A proxy answering for a backend that died mid-deploy is the same situation.
  for (const status of [502, 504]) {
    const text = commandErrorText(new ApiError(status, `POST /api/cmd/trade/buy: ${status}`));
    assert.equal(text, dropped, `${status} must read like a dropped connection`);
  }
});

// The unknown-outcome line must stay the exception: a plain refusal is still
// reported verbatim, or the caution becomes noise the player learns to ignore.
test('commandErrorText passes a decided failure through friendlyError', () => {
  const refused = new ApiError(400, 'POST /api/cmd/trade/buy: not enough cash');
  assert.equal(commandErrorText(refused), 'not enough cash');
  assert.equal(commandErrorText(refused), friendlyError(refused));
  assert.doesNotMatch(commandErrorText(refused), /исход неизвестен/i);

  // 503 stays out of the in-doubt set (the connection was never established),
  // exactly as UNKNOWN_OUTCOME_STATUSES states for the install commands.
  assert.doesNotMatch(commandErrorText(new ApiError(503, 'sector busy')), /исход неизвестен/i);
});

// --- netFetch ---------------------------------------------------------------

// The wrapper is the whole reason the mappers can tell "no answer" from "our own
// code threw": it labels the rejection at the call, where the distinction is
// still known.
test('netFetch wraps a fetch rejection in NetworkError and passes a response through', async () => {
  const original = globalThis.fetch;
  try {
    const cause = new TypeError('Failed to fetch');
    globalThis.fetch = () => Promise.reject(cause);
    const err: unknown = await netFetch('/api/state').then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof NetworkError, 'a fetch rejection must arrive as NetworkError');
    assert.equal(err.cause, cause);
    // isOutcomeUnknown (install commands) keeps treating it as in-doubt.
    assert.equal(isOutcomeUnknown(err), true);
    // Views outside the station tabs (clans, bounties, fleet, the galaxy map)
    // render err.message with no mapper at all, so the message itself has to be
    // the Russian line — not "Failed to fetch" under a new name.
    assert.equal(err.message, friendlyError(err));
    assert.match(err.message, /Нет связи с сервером/);

    const ok = new Response('{}', { status: 200 });
    globalThis.fetch = () => Promise.resolve(ok);
    assert.equal(await netFetch('/api/state'), ok);
  } finally {
    globalThis.fetch = original;
  }
});
