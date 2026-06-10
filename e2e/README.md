# E2E + load tests (phase 8.9)

Browser e2e (Playwright) and a WebSocket load test. Both need a **running dev
stack** and extra dev deps not installed by default (so `npm install` /
`npm run build` stay lean and offline-friendly).

## Setup

```bash
cd front
npm i -D @playwright/test ws
npx playwright install chromium
```

Start the stack: backend on `:8080` (`cd back && make run`) and the SPA dev
server on `:5173` (`npm run dev`).

## Playwright smoke

```bash
npm run e2e            # → playwright test (uses playwright.config.ts)
# E2E_BASE_URL=https://staging.example.com npm run e2e
```

`e2e/smoke.spec.ts`: registers a fresh player, asserts the sector canvas
renders, clicks it (move command). Selectors mirror `src/auth/LoginPage.tsx`.

## WS load test

```bash
N=100 BASE_URL=http://localhost:8080 npm run loadtest
```

`e2e/ws-loadtest.mjs`: registers N players and opens N authenticated WS
subscriptions concurrently, then reports connected / frames / dropped. Exits
non-zero if any connection dropped or fewer than N connected — the 1.4
"100 simultaneous WS" check. Uses `ws` because the WHATWG global `WebSocket`
cannot set the session `Cookie` header the `/ws` auth gate requires.

## Status

Scaffolding committed; **running requires the deps above + a live stack +
(for Playwright) a browser download** — a CI/dev-with-network step, not run in
the offline build. Kept out of `src/` so `npm run build` does not type-check it.
