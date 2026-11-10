import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpChat, type AgentDeps, type AssistantMsg, type Msg } from './agent.ts';
import { makeLlm, DEFAULT_MODEL } from './llmTools.ts';

const call = (name: string, args: unknown, id = 'c1'): AssistantMsg => ({ role: 'assistant', content: null, tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] });
const say = (content: string): AssistantMsg => ({ role: 'assistant', content });
function deps(script: AssistantMsg[], rows: Record<string, unknown>[] = [{ department: 'OPD', total: 100 }]) {
  const sqls: string[] = [], logs: Record<string, unknown>[] = [], seen: Msg[][] = [];
  let i = 0;
  const d: AgentDeps = {
    llm: async (m) => { seen.push(structuredClone(m)); if (i >= script.length) throw new Error('script exhausted'); return script[i++]; },
    runQuery: async (sql) => { sqls.push(sql); return rows; },
    log: async (e) => { logs.push(e); },
  };
  return { d, sqls, logs, seen };
}
const U = { id: 'u1' };

test('tool call -> MCP server -> SQL runs -> grounded answer + evidence', async () => {
  const { d, sqls, logs } = deps([call('aggregate_view', { view: 'v_visit_billing', group_by: ['department'], metrics: [{ fn: 'sum', column: 'total_amount', alias: 'total' }] }), say('แผนก OPD รวม 100 บาท')]);
  const r = await handleMcpChat(d, 'ค่ารักษารวมแยกแผนก', U);
  assert.equal(r.error, null);
  assert.equal(r.answer, 'แผนก OPD รวม 100 บาท');
  assert.equal(sqls.length, 1);
  assert.match(sqls[0], /^SELECT department, sum\(total_amount\) AS total FROM v_visit_billing GROUP BY department LIMIT 50$/);
  assert.match(r.sql, /MCP tool: aggregate_view/);
  assert.deepEqual(r.columns, ['department', 'total']);
  assert.equal(r.tool_calls?.[0].tool, 'aggregate_view');
  assert.equal(logs[0].tool_name, 'mcp:aggregate_view');
});
test('list_views then query_view in two steps', async () => {
  const { d, sqls } = deps([call('list_views', {}, 'a'), call('query_view', { view: 'v_top_diagnosis', limit: 3 }, 'b'), say('ok')]);
  const r = await handleMcpChat(d, 'โรคที่พบบ่อย', U);
  assert.equal(r.error, null); assert.equal(sqls.length, 1);
});
test('model asks for a base table / PII / write -> tool rejects, nothing executed, friendly error', async () => {
  for (const bad of [{ view: 'patient' }, { view: 'v_top_diagnosis', columns: ['national_id'] }, { view: 'auth.users' }]) {
    const { d, sqls } = deps([call('query_view', bad), say('ไม่มีข้อมูล')]);
    const r = await handleMcpChat(d, 'ขอเลขบัตรประชาชนผู้ป่วย', U);
    assert.equal(sqls.length, 0);
    assert.ok(r.error && !r.rows.length);
  }
});
test('model answers without any tool (guessing) -> refused, no fabricated answer', async () => {
  const { d } = deps([say('ผู้ป่วยมี 5000 คน')]);
  const r = await handleMcpChat(d, 'มีผู้ป่วยกี่คน', U);
  assert.ok(r.error); assert.equal(r.answer, '');
});
test('zero rows -> "ไม่พบข้อมูล"', async () => {
  const { d } = deps([call('query_view', { view: 'v_top_diagnosis' }), say('x')], []);
  const r = await handleMcpChat(d, 'q', U);
  assert.equal(r.answer, 'ไม่พบข้อมูลที่ตรงกับคำถาม'); assert.equal(r.error, null);
});
test('LLM failure / DB failure / empty or long question -> friendly errors, no crash', async () => {
  const bad = await handleMcpChat({ llm: async () => { throw new Error('boom'); }, runQuery: async () => [], log: async () => {} }, 'q', U);
  assert.match(bad.error!, /ระบบ AI ไม่พร้อม/);
  const db = await handleMcpChat({ ...deps([call('query_view', { view: 'v_top_diagnosis' }), say('x')]).d, runQuery: async () => { throw new Error('pg secret detail'); } }, 'q', U);
  assert.ok(db.error); assert.doesNotMatch(JSON.stringify(db), /pg secret/);
  assert.ok((await handleMcpChat(deps([]).d, '  ', U)).error);
  assert.ok((await handleMcpChat(deps([]).d, 'x'.repeat(501), U)).error);
});
test('endless tool calling stops after the step limit', async () => {
  const { d, seen } = deps(Array.from({ length: 10 }, (_, i) => call('list_views', {}, 'c' + i)));
  const r = await handleMcpChat(d, 'q', U);
  assert.ok(r.error); assert.equal(seen.length, 4);
});
test('makeLlm sends tools and parses tool_calls; HTTP errors throw', async () => {
  let body: any;
  const ok = makeLlm((async (_u: string, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'list_views', arguments: '{}' } }] } }] })); }) as typeof fetch, { apiKey: 'k' });
  const m = await ok([{ role: 'user', content: 'hi' }], [{ type: 'function', function: { name: 'list_views', description: '', parameters: {} } }]);
  assert.equal(m.tool_calls?.[0].function.name, 'list_views'); assert.equal(body.tool_choice, 'auto');
  const no = makeLlm((async () => new Response('x', { status: 500 })) as typeof fetch, { apiKey: 'k' });
  await assert.rejects(() => no([], []));
});
test('LLM failure: the user gets the Thai message, chat_logs and the function log get the reason', async () => {
  const logs: Record<string, unknown>[] = [];
  const retired = makeLlm((async () => new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'The model `llama-3.3-70b-versatile` does not exist' } }), { status: 404 })) as typeof fetch, { apiKey: 'secret-key' });
  const r = await handleMcpChat({ llm: retired, runQuery: async () => [], log: async (e) => { logs.push(e); } }, 'q', U);
  assert.equal(r.error, 'ระบบ AI ไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้ง');
  assert.equal(logs[0].error, 'llm_unavailable: LLM request failed: 404 model_not_found: The model `llama-3.3-70b-versatile` does not exist');
  assert.ok(!JSON.stringify(logs).includes('secret-key'));
});
test('makeLlm defaults to a model Groq still serves (LLM_MODEL overrides it)', async () => {
  let body: any;
  const llm = makeLlm((async (_u: string, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); }) as typeof fetch, { apiKey: 'k' });
  await llm([{ role: 'user', content: 'hi' }], []);
  assert.equal(DEFAULT_MODEL, 'openai/gpt-oss-120b'); assert.equal(body.model, Deno.env.get('LLM_MODEL') ?? DEFAULT_MODEL);
});
