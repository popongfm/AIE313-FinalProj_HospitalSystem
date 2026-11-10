import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat, type Deps } from './handler.ts';

function deps(over: Partial<Deps> = {}) {
  const calls = { run: 0, summarize: 0, logs: [] as Record<string, unknown>[] };
  const d: Deps = {
    generateSql: async () => 'select * from v_doctor_workload',
    runQuery: async () => { calls.run++; return [{ doctor_name: 'ก', booking_count: 2 }]; },
    summarize: async () => { calls.summarize++; return 'มี 1 แถว'; },
    log: async (r) => { calls.logs.push(r); },
    ...over,
  };
  return { d, calls };
}
const user = { id: 'u1' };

test('happy path returns answer, sql, columns and raw rows, and logs once', async () => {
  const { d, calls } = deps();
  const r = await handleChat(d, 'แพทย์คนไหนมีคิวมากสุด', user);
  assert.equal(r.error, null); assert.match(r.sql, /LIMIT 100$/);
  assert.deepEqual(r.columns, ['doctor_name', 'booking_count']); assert.equal(r.rows.length, 1);
  assert.equal(r.answer, 'มี 1 แถว'); assert.equal(calls.logs.length, 1); assert.equal(calls.logs[0].row_count, 1);
});
test('LLM returns a destructive statement -> rejected, database never called (Review Focus 1)', async () => {
  const { d, calls } = deps({ generateSql: async () => 'DELETE FROM patient' });
  const r = await handleChat(d, 'ลบข้อมูลผู้ป่วยทั้งหมด', user);
  assert.ok(r.error); assert.equal(calls.run, 0); assert.equal(r.rows.length, 0); assert.equal(calls.logs.length, 1);
});
test('LLM returns prose / empty text -> friendly error, no crash (Review Focus 2)', async () => {
  for (const text of ['Sorry, I cannot do that.', '']) {
    const { d, calls } = deps({ generateSql: async () => text });
    const r = await handleChat(d, 'x', user); assert.ok(r.error); assert.equal(calls.run, 0);
  }
});
test('LLM request fails -> friendly error, still logged', async () => {
  const { d, calls } = deps({ generateSql: async () => { throw new Error('LLM request failed: 500'); } });
  const r = await handleChat(d, 'x', user); assert.ok(r.error); assert.ok(!String(r.error).includes('500')); assert.equal(calls.logs.length, 1);
  assert.equal((calls.logs[0] as { error: string }).error, 'llm_unavailable: LLM request failed: 500', 'the reason is kept in chat_logs for troubleshooting');
});
test('database error -> friendly error without the raw message', async () => {
  const { d } = deps({ runQuery: async () => { throw new Error('relation "x" does not exist'); } });
  const r = await handleChat(d, 'x', user); assert.ok(r.error); assert.ok(!String(r.error).includes('relation'));
});
test('zero rows -> "ไม่พบข้อมูล" and the LLM summary is not called (Review Focus 3)', async () => {
  const { d, calls } = deps({ runQuery: async () => [] });
  const r = await handleChat(d, 'x', user);
  assert.equal(r.error, null); assert.equal(r.answer, 'ไม่พบข้อมูลที่ตรงกับคำถาม'); assert.equal(calls.summarize, 0); assert.deepEqual(r.rows, []);
});
test('summary failure falls back to a row count answer', async () => {
  const { d } = deps({ summarize: async () => { throw new Error('boom'); } });
  const r = await handleChat(d, 'x', user); assert.equal(r.error, null); assert.match(r.answer, /1/);
});
test('rejects empty or oversized questions before calling anything', async () => {
  const { d, calls } = deps();
  for (const q of ['', '   ', 'x'.repeat(501)]) { const r = await handleChat(d, q, user); assert.ok(r.error); }
  assert.equal(calls.run, 0);
});
