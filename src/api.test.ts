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
  ERROR_CODE,
  EntityKind,
  NetworkError,
  commandErrorText,
  friendlyError,
  installErrorText,
  isOutcomeUnknown,
  jumpDriveErrorText,
  netFetch,
  parseErrorBody,
  parseErrorPayload,
  STATIC_LIST_KIND,
  staticCombatMap,
  staticKey,
  staticListOf,
  type SectorStatics,
} from './api.ts';

test('jumpDriveErrorText maps each backend status to a Russian line', () => {
  assert.equal(jumpDriveErrorText(new ApiError(404, 'корабль не найден')), 'Корабль не найден.');
  assert.equal(jumpDriveErrorText(new ApiError(403, 'чужой корабль')), 'Это не ваш корабль.');
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'корабль пристыкован', ERROR_CODE.shipDocked)),
    'Нельзя прыгнуть пристыкованным — сначала отстыкуйтесь.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(429, 'прыжковый двигатель ещё не готов')),
    'Прыжковый двигатель ещё не готов — идёт перезарядка.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(503, 'сектор занят', ERROR_CODE.sectorBusy)),
    'Сектор занят, попробуйте ещё раз.',
  );
});

// TASK-157: 503 arrives from two places in back/internal/api/jump_drive.go, and
// only one of them is worth retrying — ErrInboxFull (:42-45, refused at the
// door) against ErrHandoffUnavailable (:75-76, raised by a worker built with no
// topology/bus, back/internal/sector/jumpdrive.go:69-70). The second is a
// process-wide misconfiguration: «попробуйте ещё раз» is advice that can never
// come true. Positive test on the retryable sentinel, as installErrorText does,
// so a proxy's own 503 body lands on the cautious side too.
test('jumpDriveErrorText separates a busy sector from an unavailable handoff', () => {
  const busy = jumpDriveErrorText(new ApiError(503, 'сектор занят', ERROR_CODE.sectorBusy));
  assert.equal(busy, 'Сектор занят, попробуйте ещё раз.');

  const unavailable = jumpDriveErrorText(new ApiError(503, 'передача сектора недоступна'));
  assert.notEqual(unavailable, busy);
  assert.doesNotMatch(unavailable, /попробуйте ещё раз/i);
  assert.match(unavailable, /недоступен на стороне сервера/);
  // Both branches are decided before the shield is drained and the cooldown
  // stamped (back/internal/sector/jumpdrive.go:138-145), so neither may borrow
  // the in-doubt wording: nothing of the player's was spent.
  assert.doesNotMatch(unavailable, /исход неизвестен/i);
  assert.match(unavailable, /Ничего не потрачено/);

  // An unrecognised body — a reworded sentinel, or a proxy's generic page —
  // must read like the misconfigured case, not like the retryable one.
  for (const body of ['Service Unavailable', 'передача сектора недоступна']) {
    assert.equal(jumpDriveErrorText(new ApiError(503, body)), unavailable, `503 «${body}»`);
  }
});

// TASK-157, the polarity TASK-149 fixed for the install commands. Why 504, 502
// and a dropped connection all mean "the command may already have applied" is
// stated once, on UNKNOWN_OUTCOME_STATUSES in api.ts; what this test pins is
// that the jump's line words that instead of asserting a failure, as the wording
// it replaced («Команда не успела выполниться, попробуйте ещё раз») did.
test('jumpDriveErrorText words a lost ack as an unknown outcome, not as a failure', () => {
  const timeout = jumpDriveErrorText(new ApiError(504, 'таймаут команды'));
  // The exact line, so a rewrite that keeps every property below but breaks the
  // sentence — «Прыжок мог состояться» drifting away from «Посмотрите, где он»,
  // for instance — has to be made deliberately rather than slipping through.
  assert.equal(
    timeout,
    'Ответ не получен, исход неизвестен. Прыжок мог состояться — карта сама отметит ' +
      'корабль в новом секторе. Посмотрите, где он, прежде чем повторять.',
  );
  // The properties that carry the polarity, kept separate from the golden string
  // so a reworded line still has to satisfy them.
  assert.match(timeout, /исход неизвестен/i);
  assert.match(timeout, /Прыжок мог состояться/);
  assert.doesNotMatch(timeout, /попробуйте ещё раз/i);
  assert.doesNotMatch(timeout, /не успела/i);
  // Not installUnknownOutcomeText's wording: a jump debits no goods and no
  // credits, so sending the player to their hold would be noise. What is in
  // doubt is which sector the ship is in.
  assert.doesNotMatch(timeout, /трюм/i);
  assert.match(timeout, /где он/i);

  const badGateway = jumpDriveErrorText(new ApiError(502, 'Bad Gateway'));
  assert.equal(badGateway, timeout);
  assert.doesNotMatch(badGateway, /Bad Gateway/);

  const dropped = jumpDriveErrorText(new NetworkError(new TypeError('Failed to fetch')));
  assert.equal(dropped, timeout);
  assert.doesNotMatch(dropped, /Failed to fetch/);
});

// TASK-131: 409 is overloaded by the backend — ErrShipDocked and
// ErrJumpBlockedByAntijump (raised both by a powered up_antijump ship and by a
// deployed hyper-interference generator). Reported live: a jammed jump used to
// tell the player they were docked. Since TASK-185 the pair is told apart by the
// code, because the messages themselves are Russian and shown to the player.
test('jumpDriveErrorText disambiguates the two 409 branches by code', () => {
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'прыжок глушат гипер-помехи', ERROR_CODE.jumpBlockedAntijump)),
    'Гипер-помехи глушат прыжок: рядом генератор гипер-помех или корабль с полем подавления.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'корабль пристыкован', ERROR_CODE.shipDocked)),
    'Нельзя прыгнуть пристыкованным — сначала отстыкуйтесь.',
  );
  // An unrecognised 409 — an SPA newer than its backend, a 409 the backend adds
  // later, a proxy — gets neither line. Falling through to «вы пристыкованы» is
  // the TASK-131 defect itself: it is a specific claim about the ship, and it is
  // wrong for every 409 that is not the docked one.
  const neutral409 = 'Прыжок отклонён: сейчас корабль прыгнуть не может.';
  assert.equal(jumpDriveErrorText(new ApiError(409, 'конфликт')), neutral409);
  assert.equal(jumpDriveErrorText(new ApiError(409, 'нечто новое', 'jump_blocked_by_something_new')), neutral409);
  assert.doesNotMatch(neutral409, /пристыков|помех/);
});

test('jumpDriveErrorText disambiguates the two 422 branches by code', () => {
  assert.equal(
    jumpDriveErrorText(new ApiError(422, 'генератор щита повреждён или отсутствует', ERROR_CODE.shieldRequired)),
    'Нужен исправный генератор щита.',
  );
  // jump_drive_required is read, not inferred: the backend has always written it
  // (back/internal/api/jump_drive.go), and until this review the SPA reached the
  // same line by "not shield_required", which is the 409 mistake in another pair.
  assert.equal(
    jumpDriveErrorText(new ApiError(422, 'на корабле нет прыжкового двигателя (up_jump_drive)', ERROR_CODE.jumpDriveRequired)),
    'На корабле нет прыжкового двигателя (up_jump_drive).',
  );
  // Two different things to go and fix, so an unrecognised 422 is handed neither
  // — it names both.
  const neutral422 = 'Прыжок отклонён: корабль не готов к прыжку — проверьте прыжковый двигатель и щит.';
  assert.equal(jumpDriveErrorText(new ApiError(422, 'нельзя')), neutral422);
  assert.equal(jumpDriveErrorText(new ApiError(422, 'нечто новое', 'crew_required')), neutral422);
});

test('jumpDriveErrorText disambiguates the two 400 branches by code', () => {
  assert.equal(
    jumpDriveErrorText(new ApiError(400, 'прыжок из этого сектора запрещён', ERROR_CODE.jumpForbiddenSector)),
    'Прыжок из этого сектора запрещён.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(400, 'недопустимый сектор назначения')),
    'Недопустимый сектор назначения.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(400, 'некорректный запрос')),
    'Недопустимый сектор назначения.',
  );
});

test('jumpDriveErrorText echoes the raw message for an unmapped ApiError status', () => {
  assert.equal(jumpDriveErrorText(new ApiError(418, "I'm a teapot")), "I'm a teapot");
});

// jump_drive.go:77-78 answers 500 with the worker's own error string, and that
// string is not a promise that nothing happened: executeJump saves the ship row
// naming the target sector before publishing the handoff event
// (sector/handoff.go:155), a publish that misses its deadline is routine since
// TASK-148, and the compensating re-save is best-effort (handoff.go:189-210).
test('jumpDriveErrorText hides raw 5xx bodies without asserting the jump failed', () => {
  const text = jumpDriveErrorText(new ApiError(500, 'publish jump event: context deadline exceeded'));
  assert.doesNotMatch(text, /publish jump event|deadline/i);
  // May not flatly deny the jump, and may not invite a blind repeat either: what
  // is in doubt is which sector the ship is in, so the line hedges and points at
  // the map.
  assert.match(text, /Скорее всего/);
  assert.doesNotMatch(text, /попробуйте ещё раз/i);
  assert.match(text, /где корабль/i);
  // A jump debits no goods and no credits — the hold has nothing to do with it.
  assert.doesNotMatch(text, /трюм/i);

  // Not the lost-ack line: 500 is a rarer, differently-worded member of the same
  // in-doubt class (TASK-157 AC #1).
  assert.notEqual(text, jumpDriveErrorText(new ApiError(504, 'таймаут команды')));
  // Every other 5xx the switch does not word lands on the same cautious line.
  assert.equal(jumpDriveErrorText(new ApiError(507, 'Insufficient Storage')), text);
});

// An expired session is answered by the auth middleware
// (back/internal/auth/middleware.go:39) before the handler runs, so «not
// authenticated» used to reach the Russian map footer verbatim. Same literal as
// installErrorText's — both read it from ERR_SESSION_EXPIRED.
test('jumpDriveErrorText words an expired session in Russian', () => {
  assert.equal(
    jumpDriveErrorText(new ApiError(401, 'not authenticated')),
    'Сессия истекла — войдите в игру заново.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(401, 'not authenticated')),
    installErrorText(new ApiError(401, 'not authenticated'), 'jammer'),
  );
});

// This used to assert `String(err)`, i.e. it pinned the leak: a NetworkError
// reached the galaxy-map footer as «NetworkError: Нет связи с сервером…», class
// name and all. TASK-168 removed exactly that from the set-course branch eight
// lines below in GalaxyMap.tsx and left the jump branch alone; TASK-157 finishes
// it by routing everything that is not an ApiError through friendlyError (the
// dropped connection is handled before the switch — see the test above).
test('jumpDriveErrorText words non-ApiError failures through friendlyError', () => {
  const bug = new TypeError("Cannot read properties of null (reading 'lots')");
  assert.equal(jumpDriveErrorText(bug), friendlyError(bug));
  assert.match(jumpDriveErrorText(bug), /Ошибка в интерфейсе игры/);

  // A plain Error keeps its message, but without the «Error: » prefix String()
  // put in front of it.
  assert.equal(jumpDriveErrorText(new Error('boom')), 'boom');
  assert.equal(jumpDriveErrorText('plain string failure'), 'plain string failure');
});

// --- installErrorText (TASK-149) -------------------------------------------
// Messages and codes mirror back/internal/api/install_satellite.go +
// install_jammer.go.

test('installErrorText maps the unambiguous install statuses', () => {
  assert.equal(installErrorText(new ApiError(404, 'корабль не найден'), 'satellite'), 'Корабль не найден.');
  assert.equal(installErrorText(new ApiError(403, 'чужой корабль'), 'jammer'), 'Это не ваш корабль.');
});

test('installErrorText disambiguates the three 400 branches by code', () => {
  assert.equal(
    installErrorText(new ApiError(400, 'корабль пристыкован', ERROR_CODE.shipDocked), 'satellite'),
    'Нельзя разворачивать оборудование пристыкованным — сначала отстыкуйтесь.',
  );
  assert.equal(
    installErrorText(new ApiError(400, 'в трюме нет спутников', ERROR_CODE.cargoInsufficient), 'satellite'),
    'В трюме нет спутников.',
  );
  assert.equal(
    installErrorText(new ApiError(400, 'в трюме нет генераторов гипер-помех', ERROR_CODE.cargoInsufficient), 'jammer'),
    'В трюме нет генераторов гипер-помех.',
  );
  assert.equal(
    installErrorText(new ApiError(400, 'некорректные поля запроса'), 'jammer'),
    'Некорректный запрос на установку.',
  );
});

// AC-3: ErrInstallerUnavailable is a server wiring fault, so it must not read as
// the retryable «сектор занят» (ErrInboxFull) line.
test('installErrorText separates the misconfigured installer from a busy sector', () => {
  const misconfigured = installErrorText(
    new ApiError(503, 'установка недоступна: ошибка конфигурации сервера'),
    'jammer',
  );
  assert.match(misconfigured, /Установка сейчас недоступна на стороне сервера/);
  assert.doesNotMatch(misconfigured, /попробуйте ещё раз/i);
  // Cautious, but without claiming a later retry is pointless: the commonest
  // non-sentinel 503 is a backend that is simply down, and it will come back.
  assert.doesNotMatch(misconfigured, /не поможет/i);
  const busy = installErrorText(new ApiError(503, 'сектор занят', ERROR_CODE.sectorBusy), 'jammer');
  assert.equal(busy, 'Сектор занят, попробуйте ещё раз.');
  assert.notEqual(misconfigured, busy);
});

// Only the explicit ErrInboxFull sentinel earns the retryable line: "sector
// busy" is one hand-written literal away from a backend rewording, and 503 also
// arrives from proxies with a generic body. Anything unrecognised must fall to
// the cautious side, not to «попробуйте ещё раз».
test('installErrorText treats an unrecognised 503 as non-retryable', () => {
  for (const body of ['Service Unavailable', 'установка недоступна: ошибка конфигурации сервера']) {
    const text = installErrorText(new ApiError(503, body), 'jammer');
    assert.doesNotMatch(text, /попробуйте ещё раз/i, `503 «${body}» must not invite a retry`);
    assert.equal(text, installErrorText(new ApiError(503, 'установка недоступна'), 'jammer'));
  }
});

// AC-2: since TASK-144 the goods debit commits with the object INSERT, so 504
// means "outcome unknown" — the line must not tell the player to just retry.
test('installErrorText 504 says the outcome is unknown instead of inviting a retry', () => {
  const satellite = installErrorText(new ApiError(504, 'таймаут команды'), 'satellite');
  assert.match(satellite, /исход неизвестен/i);
  assert.match(satellite, /Спутник мог быть уже развёрнут/);
  assert.match(satellite, /Проверьте трюм и радар/);
  assert.doesNotMatch(satellite, /попробуйте ещё раз/i);

  const jammer = installErrorText(new ApiError(504, 'таймаут команды'), 'jammer');
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
  assert.equal(dropped, installErrorText(new ApiError(504, 'таймаут команды'), 'jammer'));
  assert.match(dropped, /исход неизвестен/i);
  assert.doesNotMatch(dropped, /Failed to fetch/);

  // Same for a non-Error rejection and for the satellite wording.
  assert.equal(
    installErrorText('boom', 'satellite'),
    installErrorText(new ApiError(504, 'таймаут команды'), 'satellite'),
  );
});

// In production Apache proxies to the Go process, so a backend that dies after
// the request was forwarded (restart, deploy, worker panic) surfaces as 502 —
// the request landed, the answer did not. Exactly 504's situation, and the one
// most likely to hit a player mid-deploy.
test('installErrorText 502 reads as an unknown outcome, not as a failure', () => {
  const badGateway = installErrorText(new ApiError(502, 'Bad Gateway'), 'jammer');
  assert.equal(badGateway, installErrorText(new ApiError(504, 'таймаут команды'), 'jammer'));
  assert.match(badGateway, /исход неизвестен/i);
  assert.doesNotMatch(badGateway, /не смог|не прошла/i);
  assert.doesNotMatch(badGateway, /Bad Gateway/);
});

// isOutcomeUnknown states the in-doubt set once, for installErrorText to ask.
// A proxy 503 stays out: it means the connection was never established, so the
// command cannot have been enqueued.
test('isOutcomeUnknown covers 502, 504 and non-ApiError failures only', () => {
  assert.equal(isOutcomeUnknown(new ApiError(504, 'таймаут команды')), true);
  assert.equal(isOutcomeUnknown(new ApiError(502, 'Bad Gateway')), true);
  assert.equal(isOutcomeUnknown(new NetworkError(new TypeError('Failed to fetch'))), true);
  assert.equal(isOutcomeUnknown('boom'), true);
  assert.equal(isOutcomeUnknown(new ApiError(400, 'в трюме нет генераторов гипер-помех', ERROR_CODE.cargoInsufficient)), false);
  assert.equal(isOutcomeUnknown(new ApiError(503, 'сектор занят', ERROR_CODE.sectorBusy)), false);
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

// TASK-185: the code decides, the wording does not. Both halves matter — a
// reworded message must keep mapping (the backend is free to reword a player-
// facing line), and the same message under two codes must map two ways (the
// codes are what the branches are for). Together they say the coupling to the
// English sentinel text is gone rather than translated.
test('jumpDriveErrorText branches on the code, not on the message wording', () => {
  const jammed = 'Гипер-помехи глушат прыжок: рядом генератор гипер-помех или корабль с полем подавления.';
  const docked = 'Нельзя прыгнуть пристыкованным — сначала отстыкуйтесь.';

  // Same status, same message, different code → different advice.
  assert.equal(jumpDriveErrorText(new ApiError(409, 'нельзя', ERROR_CODE.jumpBlockedAntijump)), jammed);
  assert.equal(jumpDriveErrorText(new ApiError(409, 'нельзя', ERROR_CODE.shipDocked)), docked);

  // Reworded backend messages keep their branch.
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'прыжок подавлен полем', ERROR_CODE.jumpBlockedAntijump)),
    jammed,
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(422, 'щит не заряжен', ERROR_CODE.shieldRequired)),
    'Нужен исправный генератор щита.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(400, 'отсюда не прыгнуть', ERROR_CODE.jumpForbiddenSector)),
    'Прыжок из этого сектора запрещён.',
  );
  assert.equal(
    jumpDriveErrorText(new ApiError(503, 'подождите', ERROR_CODE.sectorBusy)),
    'Сектор занят, попробуйте ещё раз.',
  );

  // And the old coupling is really gone: the English sentinels that used to
  // drive these branches now decide nothing. They carry no code either, so they
  // land on the neutral line rather than on the other half of the pair.
  assert.equal(
    jumpDriveErrorText(new ApiError(409, 'jump blocked by antijump field')),
    'Прыжок отклонён: сейчас корабль прыгнуть не может.',
  );
  assert.notEqual(jumpDriveErrorText(new ApiError(409, 'jump blocked by antijump field')), docked);
  assert.equal(
    jumpDriveErrorText(new ApiError(422, 'shield generator damaged or missing')),
    'Прыжок отклонён: корабль не готов к прыжку — проверьте прыжковый двигатель и щит.',
  );
});

// TASK-185 review: every other assertion in this file compares ERROR_CODE with
// itself, so renaming a value here would keep all of them green while the
// backend — which spells the same strings out in its own constants — stops being
// understood. Its twin is TestUnit_ErrorCodeWireValues in back/internal/api;
// the two pin the wire contract from either end, and changing a value has to
// fail on both sides at once.
test('ERROR_CODE spells the wire values the backend writes', () => {
  assert.deepEqual(
    { ...ERROR_CODE },
    {
      sectorBusy: 'sector_busy',
      shipDocked: 'ship_docked',
      jumpBlockedAntijump: 'jump_blocked_antijump',
      jumpDriveRequired: 'jump_drive_required',
      shieldRequired: 'shield_required',
      jumpForbiddenSector: 'jump_forbidden_sector',
      cargoInsufficient: 'cargo_insufficient',
    },
  );
});

test('installErrorText branches on the code, not on the message wording', () => {
  const undock = 'Нельзя разворачивать оборудование пристыкованным — сначала отстыкуйтесь.';

  assert.equal(installErrorText(new ApiError(400, 'нельзя', ERROR_CODE.shipDocked), 'jammer'), undock);
  assert.equal(
    installErrorText(new ApiError(400, 'нельзя', ERROR_CODE.cargoInsufficient), 'jammer'),
    'В трюме нет генераторов гипер-помех.',
  );
  assert.equal(
    installErrorText(new ApiError(503, 'подождите', ERROR_CODE.sectorBusy), 'satellite'),
    'Сектор занят, попробуйте ещё раз.',
  );

  // The word "docked" in a body no longer routes anything, and an uncoded 400
  // is the malformed-request branch.
  assert.equal(
    installErrorText(new ApiError(400, 'ship is docked'), 'jammer'),
    'Некорректный запрос на установку.',
  );
});

// parseErrorPayload is what puts the code on the ApiError. The three senders
// whose failures reach the two mappers read the body through it; everything else
// keeps parseErrorBody, whose contract (message only) must not change.
test('parseErrorPayload carries the code beside the message', async () => {
  const coded = await parseErrorPayload(
    new Response('{"error":"корабль пристыкован","code":"ship_docked"}', { status: 409 }),
  );
  assert.deepEqual(coded, { message: 'корабль пристыкован', code: ERROR_CODE.shipDocked });

  // Most failures carry no code: '' rather than undefined, so every reader
  // compares strings and none has to guard a missing field.
  const uncoded = await parseErrorPayload(new Response('{"error":"корабль не найден"}', { status: 404 }));
  assert.deepEqual(uncoded, { message: 'корабль не найден', code: '' });

  // Not JSON at all (a proxy error page): same fallback line parseErrorBody uses.
  const proxied = await parseErrorPayload(new Response('Service Unavailable', { status: 503 }));
  assert.deepEqual(proxied, { message: 'Сервер вернул ошибку 503.', code: '' });

  // An ApiError built without a code reports '', not undefined.
  assert.equal(new ApiError(404, 'корабль не найден').code, '');
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
// HTML rather than the usual {"error":…} — the English "Bad Gateway" the market
// tab used to print after its Russian prefix. (Since TASK-168 parseErrorBody no
// longer produces that reason phrase at all; these cases construct the message by
// hand, so they still pin friendlyError's own wording.)
test('friendlyError words a proxy 502/504 in Russian', () => {
  const badGateway = friendlyError(new ApiError(502, 'POST /api/cmd/trade/buy: Bad Gateway'));
  assert.doesNotMatch(badGateway, /Bad Gateway/);
  assert.match(badGateway, /Сервер не ответил \(502\)/);

  const timeout = friendlyError(new ApiError(504, 'GET /api/auction: Gateway Timeout'));
  assert.match(timeout, /Сервер не ответил \(504\)/);
});

// A body-less failure used to leave the caller's line ending at its colon:
// «Покупка 50 × Энергоэлементы: ». Reachable now only via an explicit
// {"error":""} from the backend, since parseErrorBody words the empty case
// itself — but the guard has to hold either way.
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
  assert.match(dropped, /Проверьте, что изменилось/);
  assert.doesNotMatch(dropped, /повторите\./i);
  assert.doesNotMatch(dropped, /Failed to fetch/);
  // The line names no particular resource, and that is load-bearing rather than
  // vague: this one mapper is shared by market buy/sell and cargo transfer (wallet
  // and hold), setBounty (wallet or clan treasury), sellShip (wallet and a hull),
  // claimStation, insurance, and the ordnance launches / pickup / dismantle (hold
  // only). It used to end «Проверьте кошелёк и трюм», which was false for every
  // consumer that touches no hold — and the same wording was then used as a reason
  // to keep sendSetCourse off the mapper, holding it to a standard its own users
  // did not meet.
  assert.doesNotMatch(dropped, /кошел[её]к/i);
  assert.doesNotMatch(dropped, /трюм/i);

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

// The NetworkError branch of friendlyError returns the same constant the error
// already carries in .message, so deleting it changes nothing a player sees and
// no assert on the return value can notice — a review mutation proved the branch
// survived removal with the whole suite green. Its one unique effect is putting
// the NATIVE cause in the console: "Failed to fetch" vs "NetworkError when
// attempting to fetch resource" is the only clue left when a player reports
// "the market won't load". Pin that, or the next simplification drops it.
test('friendlyError logs the native cause behind a dead connection', () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    const cause = new TypeError('Failed to fetch');
    assert.equal(friendlyError(new NetworkError(cause)), 'Нет связи с сервером. Проверьте подключение.');
    assert.equal(logged.length, 1, 'the branch must log exactly once');
    assert.ok(
      logged[0].includes(cause),
      'the native cause itself must reach the console, not just the Russian line',
    );
  } finally {
    console.error = original;
  }
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
    // Some views still render err.message with no mapper at all —
    // ObjectActionsMenu.formatError (which also writes it to the journal),
    // TargetsPanel.onRowClick, SpacePointMenu, CombatHUD.run for the commands that
    // pass no toText — so the message itself has to be the Russian line, not
    // "Failed to fetch" under a new name. (Clans, bounties, fleet and the galaxy map
    // were the examples here until TASK-168 put all four on a mapper; PilotPanel's
    // console was one until TASK-187 put its four on friendlyError. They no longer
    // make the point.)
    assert.equal(err.message, friendlyError(err));
    assert.match(err.message, /Нет связи с сервером/);

    const ok = new Response('{}', { status: 200 });
    globalThis.fetch = () => Promise.resolve(ok);
    assert.equal(await netFetch('/api/state'), ok);
  } finally {
    globalThis.fetch = original;
  }
});

// --- staticListOf (TASK-165) -------------------------------------------------
// The kind→list mapping used to be hand-copied into SectorView (panel row +
// canvas ring), ObjectLayer (marker position) and SectorCanvas (keeping a canvas
// menu open), and the copies drifted on every new static type.
//
// The expected set is not written out here — it is read from api.ts's
// STATIC_LIST_KIND, which is `Record<keyof SectorStatics, number>` and therefore
// as complete as tsc can force it to be. That makes the two gates bite in
// sequence when a static type is added: `npm run build` fails first (api.ts owes
// the new list a kind), and once the kind is named `npm test` fails here (the
// fixture below owes it a list). Listing the kinds by hand — what this test did
// first — guarded neither step: a kind that neither the helper nor the fixture
// knew about was invisible in both directions, and a review mutation adding
// `mines?: Jammer[]` to SectorStatics plus `Mine: 15` to EntityKind left all 54
// tests green. tsconfig.app.json excludes src/**/*.test.ts, so a type-level trick
// inside this file (a Required<SectorStatics> fixture, say) would not have been
// checked by any gate at all.
const STATICS: Required<SectorStatics> = {
  stations: [{ id: 1, sectorID: 1, x: 0, y: 0, hp: 1, shield: 0, race: 1, built: true, type: 7 }],
  shipyards: [{ id: 2, sectorID: 1, x: 0, y: 0, hp: 1, shield: 0, race: 1, built: true }],
  tradeStations: [{ id: 3, sectorID: 1, x: 0, y: 0, hp: 1, shield: 0, race: 1, built: true, type: 1 }],
  pirbases: [{ id: 4, sectorID: 1, x: 0, y: 0, hp: 1, shield: 0, race: 6, built: true, angle: 0 }],
  laserTowers: [{ id: 5, sectorID: 1, x: 0, y: 0, hp: 1, shield: 0, race: 1, built: true }],
  satellites: [{ id: 6, sectorID: 1, x: 0, y: 0, hp: 1, shield: 0, race: 1, built: true }],
  jammers: [{ id: 7, sectorID: 1, x: 120, y: -80, hp: 7500, shield: 4000, race: 1, built: true }],
};

test('staticListOf maps every static EntityKind to its own list', () => {
  assert.equal(staticListOf(STATICS, EntityKind.Station), STATICS.stations);
  assert.equal(staticListOf(STATICS, EntityKind.Shipyard), STATICS.shipyards);
  assert.equal(staticListOf(STATICS, EntityKind.TradeStation), STATICS.tradeStations);
  assert.equal(staticListOf(STATICS, EntityKind.Pirbase), STATICS.pirbases);
  assert.equal(staticListOf(STATICS, EntityKind.LaserTower), STATICS.laserTowers);
  assert.equal(staticListOf(STATICS, EntityKind.Satellite), STATICS.satellites);
  // The case TASK-165 came from: reachable from the navigation panel and the map
  // menu, absent from SectorView's copy of the switch, so the generator got no
  // row highlight and no ring.
  assert.equal(staticListOf(STATICS, EntityKind.Jammer), STATICS.jammers);
});

test('staticListOf resolves every list SectorStatics declares, one kind each', () => {
  const fields = Object.keys(STATIC_LIST_KIND) as (keyof SectorStatics)[];
  const resolved = new Set<unknown>();
  for (const field of fields) {
    const list = staticListOf(STATICS, STATIC_LIST_KIND[field]);
    // assert.ok before assert.equal on purpose: a field the fixture has no list
    // for makes both sides undefined, and an equality check alone would pass a
    // list nobody can reach.
    assert.ok(list, `${field}: kind ${STATIC_LIST_KIND[field]} resolved to no list`);
    assert.equal(list, STATICS[field], `${field} must resolve to its own list`);
    resolved.add(list);
  }
  // Seven fields, seven distinct lists: two fields sharing a kind (the copy-paste
  // slip this helper exists to prevent) would make one of them return the other's
  // array, which the equality above catches, and this counts.
  assert.equal(resolved.size, fields.length);

  // isStaticTargetKind is the weapon-target set, which is not the same set: a gate
  // can be shot at but is delivered in its own /api/world payload, not in
  // SectorStatics. Asserting the difference keeps it deliberate.
  assert.equal(staticListOf(STATICS, EntityKind.Gate), undefined, 'gates live in /api/world');
});

test('staticListOf returns undefined for an unknown kind and for an absent list', () => {
  // Unknown kind: a ref the panel can hold but SectorStatics has no list for —
  // both an existing non-static kind and a value no EntityKind uses at all.
  assert.equal(staticListOf(STATICS, EntityKind.Container), undefined);
  assert.equal(staticListOf(STATICS, EntityKind.Ship), undefined);
  assert.equal(staticListOf(STATICS, 99), undefined);
  assert.equal(staticListOf(STATICS, -1), undefined);
  // A known kind whose list the server did not send (every SectorStatics field
  // is optional) — callers must see the same undefined, not a crash.
  assert.equal(staticListOf({}, EntityKind.Jammer), undefined);
  assert.equal(staticListOf({ stations: [] }, EntityKind.Station)?.length, 0);
});

// --- parseErrorBody (TASK-168) ----------------------------------------------
// The reason phrase used to be the fallback for every failure with no usable
// {"error":…} body, which is how the market screen came to read «Не удалось
// загрузить рынок: Internal Server Error» — a Russian wrapper around an English
// HTTP reason phrase. It is also not a stable string: HTTP/2 carries no reason
// phrase, so the same 500 read one way through the dev proxy and blank in
// production.
test('parseErrorBody returns the backend message and never an HTTP reason phrase', async () => {
  // The normal case: the backend's own {"error":…} is what the player should see.
  assert.equal(
    await parseErrorBody(new Response('{"error":"вход на этот корабль закрыт"}', { status: 403 })),
    'вход на этот корабль закрыт',
  );

  // A proxy error page is not JSON — Vite's dev proxy answers exactly this.
  const proxied = await parseErrorBody(new Response('Internal Server Error', { status: 500 }));
  assert.doesNotMatch(proxied, /Internal Server Error/);
  assert.equal(proxied, 'Сервер вернул ошибку 500.');

  // Valid JSON without an `error` field, and an empty body, land on the same line.
  assert.equal(await parseErrorBody(new Response('{}', { status: 404 })), 'Сервер вернул ошибку 404.');
  assert.equal(await parseErrorBody(new Response(null, { status: 502 })), 'Сервер вернул ошибку 502.');
});

// End to end over the shape requireOk builds: a 500 with a proxy body must reach
// the view as one Russian sentence, with the route prefix stripped and no reason
// phrase inside. This is the combination TASK-168 AC #2 is about — the mapper was
// already reached by MarketView, and still leaked English.
test('friendlyError turns a body-less backend failure into one Russian sentence', async () => {
  const msg = await parseErrorBody(new Response('Internal Server Error', { status: 500 }));
  const text = friendlyError(new ApiError(500, `GET /api/station/1/market: ${msg}`));
  assert.equal(text, 'Сервер вернул ошибку 500.');
  assert.doesNotMatch(text, /api\//);
  assert.doesNotMatch(text, /[A-Za-z]/, 'no English and no route left in the player-facing line');
});

// --- staticCombatMap (TASK-186) ----------------------------------------------
// The `statics` welcome frame now carries the live hull/shield of every static
// next to the spawn layout, and the client seeds its combat map from it instead
// of clearing. The key format is the contract: CombatHUD and ObjectLayer both
// look live vitals up as `${kind}:${id}` written out by hand, so a change here
// silently blanks the hull readout and every shield bar on the canvas.
test('staticCombatMap indexes a welcome frame by kind:id', () => {
  const jammer = { ref: { kind: EntityKind.Jammer, id: 7 }, hp: 3000, shield: 200, maxShield: 4000 };
  const station = { ref: { kind: EntityKind.Station, id: 7 }, hp: 7500, shield: 0, maxShield: 500 };
  const map = staticCombatMap([jammer, station]);

  assert.equal(map.size, 2);
  // Same id, different kind — the key must keep them apart, which is why it is
  // not the bare id.
  assert.equal(map.get(`${EntityKind.Jammer}:7`), jammer);
  assert.equal(map.get(`${EntityKind.Station}:7`), station);
  assert.equal(map.get(staticKey(jammer.ref)), jammer);
});

test('staticCombatMap yields an empty map when the frame omits destructibles', () => {
  // A sector with no statics sends no list at all (omitempty on the wire), and
  // the seeding path must not throw on it.
  assert.equal(staticCombatMap(undefined).size, 0);
  assert.equal(staticCombatMap([]).size, 0);
});
