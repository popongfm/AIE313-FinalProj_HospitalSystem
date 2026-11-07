import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSql, summarize, extractSql } from './llm.ts';

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
test('summarize sends the question and data and returns the model text', async () => {
  const calls: Call[] = [];
  const text = await summarize('มีแพทย์กี่คน', ['n'], [[8]], fakeFetch('มีแพทย์ 8 คน', 200, calls), opts);
  assert.equal(text, 'มีแพทย์ 8 คน');
  assert.ok(String(JSON.parse(calls[0].init.body as string).messages[1].content).includes('"n"'));
});
