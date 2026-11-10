// Builds web/config.js from environment variables and refuses secret keys. Used by scripts/serve.mjs at container start
// (Docker / Render) and, when run directly, as the Vercel build step.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function buildConfig(env) {
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) if (!env[k]) throw new Error(`${k} is not set`);
  const key = env.SUPABASE_ANON_KEY;
  if (key.startsWith('sb_secret_')) throw new Error('SUPABASE_ANON_KEY is a secret key — use the publishable/anon key');
  const parts = key.split('.');
  if (parts.length === 3) {
    let role; try { role = JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role; } catch { /* not a decodable JWT: let Supabase reject it */ }
    if (role === 'service_role') throw new Error('SUPABASE_ANON_KEY is a service_role key — it must never be shipped to the browser');
  }
  return `window.APP_CONFIG = ${JSON.stringify({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: key, ...(env.CHAT_FUNCTION ? { CHAT_FUNCTION: env.CHAT_FUNCTION } : {}) }, null, 2)};\n`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../web/config.js', import.meta.url), buildConfig(process.env));
  console.log('wrote web/config.js');
}
