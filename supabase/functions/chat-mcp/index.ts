// Supabase Edge Function (METHOD C - MCP): POST /functions/v1/chat-mcp
//   { question, history? }   -> { answer, sql, columns, rows, error, tool_calls, action? }   (action = appointment to confirm)
//   { confirm_booking: args } -> the same shape; saves the appointment the user just confirmed (no LLM involved)
// The MCP server (read-only view tools) and MCP client/agent both run server-side inside this function; the browser only sees results.
// Secrets (never in the repo): GROQ_API_KEY, optional LLM_MODEL; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { confirmBooking, handleMcpChat, type AgentDeps } from './agent.ts';
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
  // Signed in is not enough: the account must be linked to a staff or patient row. Staff/admin see every row; a patient
  // sees only its own rows, because run_readonly_query applies the views' access rule for the user passed as as_user.
  // role_of(): staff.role or 'patient' from the user_id link in staff / patient; null = not linked yet
  const { data: role } = await admin.rpc('role_of', { uid: auth.user.id });
  if (!role) return json({ error: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาติดต่อผู้ดูแลระบบ' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled as empty question */ }

  const deps: AgentDeps = {
    llm: makeLlm(),
    runQuery: async (sql) => {
      const { data, error } = await admin.rpc('run_readonly_query', { q: sql, as_user: auth.user.id });
      if (error) throw new Error(error.message);
      return data as Record<string, unknown>[];
    },
    log: async (entry) => { await admin.from('chat_logs').insert(entry); },
    // the only writes: fixed functions that act as this user (db/08_chat_actions.sql), never SQL from the model
    actions: {
      book: async (a, confirm) => {
        const { data, error } = await admin.rpc('chat_book_appointment', { as_user: auth.user.id, p_doctor: a.doctor, p_date: a.date, p_time: a.time,
          p_symptom: a.symptom ?? null, p_hn: a.hn ?? null, p_confirm: confirm });
        if (error) throw new Error(error.message);
        return data as Record<string, unknown>;
      },
      listDoctors: async () => {
        const { data, error } = await admin.rpc('chat_doctor_directory', { as_user: auth.user.id });
        if (error) throw new Error(error.message);
        return data as Record<string, unknown>[];
      },
    },
  };
  const user = { id: auth.user.id, role: role as string };
  const result = body.confirm_booking !== undefined
    ? await confirmBooking(deps, body.confirm_booking, user)
    : await handleMcpChat(deps, body.question as string, user, body.history);
  return json(result);
});
