// Supabase Edge Function: POST /functions/v1/chat  { question }  ->  { answer, sql, columns, rows, error }
// Secrets (never in the repo): GROQ_API_KEY, optional LLM_MODEL; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleChat } from './handler.ts';
import { generateSql, summarize } from './llm.ts';
import { SCHEMA_PROMPT } from './schemaPrompt.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth?.user) return json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' }, 401);
  // Signed in is not enough: only accounts an admin linked to a staff/admin profile may query (same rule as is_app_user()).
  const { data: prof } = await admin.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle();
  if (!prof || prof.role === 'patient') return json({ error: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาติดต่อผู้ดูแลระบบ' }, 403);

  let question = '';
  try { question = (await req.json()).question; } catch { /* handled below as empty question */ }

  const result = await handleChat({
    generateSql: (q) => generateSql(q, SCHEMA_PROMPT, fetch),
    runQuery: async (sql) => {
      const { data, error } = await admin.rpc('run_readonly_query', { q: sql });
      if (error) throw new Error(error.message);
      return data as Record<string, unknown>[];
    },
    summarize: (q, columns, rows) => summarize(q, columns, rows, fetch),
    log: async (entry) => { await admin.from('chat_logs').insert(entry); },
  }, question, { id: auth.user.id });
  return json(result);
});
