import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const cfg = window.APP_CONFIG;
if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  throw new Error('config.js missing: copy web/config.example.js to web/config.js');
}
export const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
