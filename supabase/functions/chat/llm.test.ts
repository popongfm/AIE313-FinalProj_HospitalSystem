import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSql, summarize, extractSql, DEFAULT_MODEL } from './llm.ts';

type Call = { url: string; init: RequestInit };
function fakeFetch(content: string, status = 200, calls: Call[] = []) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
  }) as unknown as typeof fetch;
}
const opts = { apiKey: 'test-key', model: 'test-model' };

test('extractSql pulls bare SQL out of a fenced block', () => {
  assert.equal(extractSql('Here:\n```sql\nselect 1;\n```\nDone'), 'select 1;');
});
test('extractSql returns prose unchanged when there is no SQL (the guard rejects it later)', () => {
  assert.equal(extractSql('Sorry, I cannot help.'), 'Sorry, I cannot help.');
});
test('generateSql calls the chat API with temperature 0, the schema prompt and the key', async () => {
  const calls: Call[] = [];
  const sql = await generateSql('มีแพทย์กี่คน', 'SCHEMA', fakeFetch('```sql\nselect 1\n```', 200, calls), opts);
  assert.equal(sql, 'select 1');
  assert.match(calls[0].url, /chat\/completions$/);
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.temperature, 0); assert.equal(body.model, 'test-model');
  assert.equal(body.messages[0].content, 'SCHEMA'); assert.equal(body.messages[1].content, 'มีแพทย์กี่คน');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-key');
});
test('generateSql throws on an HTTP error so the handler can answer gracefully', async () => {
  await assert.rejects(() => generateSql('q', 'S', fakeFetch('x', 500), opts), /LLM request failed: 500/);
});
test('the error names the provider\'s reason (e.g. a retired model) but never the key', async () => {
  const groq404 = (async () => new Response(JSON.stringify({ error: { message: 'The model `llama-3.3-70b-versatile` has been decommissioned', type: 'invalid_request_error', code: 'model_decommissioned' } }), { status: 400 })) as unknown as typeof fetch;
  const err = await generateSql('q', 'S', groq404, opts).then(() => new Error('no error'), (e: Error) => e);
  assert.match(err.message, /^LLM request failed: 400 model_decommissioned: The model `llama-3.3-70b-versatile` has been decommissioned$/);
  assert.ok(!err.message.includes('test-key'));
  const plain = await generateSql('q', 'S', (async () => new Response('<html>bad gateway</html>', { status: 502 })) as unknown as typeof fetch, opts).then(() => new Error('no error'), (e: Error) => e);
  assert.equal(plain.message, 'LLM request failed: 502');
});
test('default model is one Groq still serves (LLM_MODEL overrides it)', async () => {
  assert.equal(DEFAULT_MODEL, 'openai/gpt-oss-120b');
  const calls: Call[] = [];
  await generateSql('q', 'S', fakeFetch('select 1', 200, calls), { apiKey: 'k' });
  const sent = JSON.parse(calls[0].init.body as string).model;
  assert.equal(sent, Deno.env.get('LLM_MODEL') ?? DEFAULT_MODEL);
});
test('summarize sends the question and data and returns the model text', async () => {
  const calls: Call[] = [];
  const text = await summarize('มีแพทย์กี่คน', ['n'], [[8]], fakeFetch('มีแพทย์ 8 คน', 200, calls), opts);
  assert.equal(text, 'มีแพทย์ 8 คน');
  assert.ok(String(JSON.parse(calls[0].init.body as string).messages[1].content).includes('"n"'));
});
