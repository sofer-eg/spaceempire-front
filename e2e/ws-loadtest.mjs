// WS load-test (phase 8.9): registers N players against a running server and
// opens N authenticated WebSocket subscriptions concurrently, reporting how
// many connected and how many snapshot frames arrived. Verifies the server
// sustains many simultaneous WS without dropping connections (the 1.4
// follow-up). Requires the `ws` package (global WebSocket cannot set the
// session Cookie header): `npm i -D ws`.
//
// Usage: BASE_URL=http://localhost:8080 N=100 node e2e/ws-loadtest.mjs
import WebSocket from 'ws';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const N = Number(process.env.N ?? 100);
const HOLD_MS = Number(process.env.HOLD_MS ?? 5000);

// register returns the session cookie for a fresh login.
async function register(login) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: 'loadtest' }),
  });
  if (!res.ok) throw new Error(`register ${login}: ${res.status}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error(`register ${login}: no session cookie`);
  return cookie.split(';')[0]; // name=value
}

function openWS(cookie) {
  return new Promise((resolve) => {
    const wsURL = BASE.replace(/^http/, 'ws') + '/ws';
    const sock = new WebSocket(wsURL, { headers: { Cookie: cookie } });
    let frames = 0;
    sock.on('message', () => {
      frames++;
    });
    sock.on('open', () => resolve({ sock, ok: () => true, frames: () => frames }));
    sock.on('error', () => resolve({ sock: null, ok: () => false, frames: () => 0 }));
  });
}

const stamp = Date.now();
const conns = [];
let connected = 0;

console.log(`load-test: ${N} WS against ${BASE}`);
for (let i = 0; i < N; i++) {
  try {
    const cookie = await register(`lt_${stamp}_${i}`);
    const c = await openWS(cookie);
    if (c.ok()) {
      connected++;
      conns.push(c);
    }
  } catch (e) {
    console.error('connect failed:', e.message);
  }
}

console.log(`connected ${connected}/${N}; holding ${HOLD_MS}ms…`);
await new Promise((r) => setTimeout(r, HOLD_MS));

const totalFrames = conns.reduce((s, c) => s + c.frames(), 0);
const dead = conns.filter((c) => c.sock.readyState !== WebSocket.OPEN).length;
console.log(`frames received: ${totalFrames}; still open: ${connected - dead}/${connected}; dropped: ${dead}`);
for (const c of conns) c.sock.close();
process.exit(dead === 0 && connected === N ? 0 : 1);
