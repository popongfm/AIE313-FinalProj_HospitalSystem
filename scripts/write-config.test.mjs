import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from './write-config.mjs';

const jwt = (role) => 'h.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.s';
test('builds config.js from the anon key', () => {
  const js = buildConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: jwt('anon') });
  assert.match(js, /window\.APP_CONFIG/); assert.match(js, /https:\/\/x\.supabase\.co/);
});
test('refuses a service_role key (it must never reach the browser)', () => {
  assert.throws(() => buildConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: jwt('service_role') }), /service_role/);
});
test('refuses missing variables', () => {
  assert.throws(() => buildConfig({ SUPABASE_URL: 'https://x.supabase.co' }), /SUPABASE_ANON_KEY/);
});
test('accepts new-style publishable keys that are not JWTs', () => {
  assert.match(buildConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_abc' }), /sb_publishable_abc/);
  assert.throws(() => buildConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'sb_secret_abc' }), /secret/);
});
