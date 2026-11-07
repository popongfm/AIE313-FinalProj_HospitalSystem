// Supabase Edge Function (METHOD C - MCP): POST /functions/v1/chat-mcp  { question } -> { answer, sql, columns, rows, error, tool_calls }
// The MCP server (read-only view tools) and MCP client/agent both run server-side inside this function; the browser only sees results.
// Secrets (never in the repo): GROQ_API_KEY, optional LLM_MODEL; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handleMcpChat } from './agent.ts';
import { makeLlm } from './llmTools.ts';

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

  let question = '';
  try { question = (await req.json()).question; } catch { /* handled as empty question */ }

  const result = await handleMcpChat({
    llm: makeLlm(),
    runQuery: async (sql) => {
      const { data, error } = await admin.rpc('run_readonly_query', { q: sql });
      if (error) throw new Error(error.message);
      return data as Record<string, unknown>[];
    },
    log: async (entry) => { await admin.from('chat_logs').insert(entry); },
  }, question, { id: auth.user.id });
  return json(result);
});
