import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeHandler } from './serve.mjs';

const root = fileURLToPath(new URL('../web', import.meta.url));
const CONFIG = 'window.APP_CONFIG = {"SUPABASE_URL":"https://x.supabase.co"};\n';

async function withServer(fn) {
  const srv = createServer(makeHandler({ root, configJs: CONFIG })).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try { await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

test('serves index.html at / and the app pages', () => withServer(async (base) => {
  const r = await fetch(base + '/'); assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/); assert.match(await r.text(), /สมัครสมาชิก/);
  assert.equal((await fetch(base + '/app.html')).status, 200);
  const js = await fetch(base + '/js/auth.js'); assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
}));
test('config.js comes from the environment, never cached', () => withServer(async (base) => {
  const r = await fetch(base + '/config.js'); assert.equal(await r.text(), CONFIG); assert.equal(r.headers.get('cache-control'), 'no-store');
}));
test('health check for Render', () => withServer(async (base) => {
  const r = await fetch(base + '/healthz'); assert.equal(r.status, 200); assert.equal(await r.text(), 'ok');
}));
test('does not serve tests, dotfiles, or anything outside web/', () => withServer(async (base) => {
  for (const p of ['/tests/smoke.mjs', '/.env', '/%2e%2e/scripts/serve.mjs', '/..%2fREADME.md', '/js/../../README.md', '/nope.html']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
}));
test('only GET and HEAD', () => withServer(async (base) => {
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  const h = await fetch(base + '/', { method: 'HEAD' }); assert.equal(h.status, 200);
}));
test('refuses to start with a service_role key', async () => {
  const jwt = 'h.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.s';
  const p = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))],
    { env: { ...process.env, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: jwt, PORT: '0' } });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((r) => p.on('exit', r));
  assert.equal(code, 1); assert.match(err, /service_role/);
});
