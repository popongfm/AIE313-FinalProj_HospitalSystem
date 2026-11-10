import { validateSql } from './sqlGuard.ts';
export type Row = Record<string, unknown>;
export type Deps = {
  generateSql(question: string): Promise<string>;
  runQuery(sql: string): Promise<Row[]>;
  summarize(question: string, columns: string[], rows: unknown[][]): Promise<string>;
  log(entry: Row): Promise<void>;
};
export type ChatResult = { answer: string; sql: string; columns: string[]; rows: Row[]; error: string | null };
const fail = (error: string, sql = ''): ChatResult => ({ answer: '', sql, columns: [], rows: [], error });

export async function handleChat(deps: Deps, question: string, user: { id: string }): Promise<ChatResult> {
  const q = typeof question === 'string' ? question.trim() : '';
  if (q === '' || q.length > 500) return fail('กรุณาพิมพ์คำถาม (ไม่เกิน 500 ตัวอักษร)');
  const log = (e: Row) => deps.log({ user_id: user.id, question: q, ...e }).catch(() => {});

  let raw: string;
  try { raw = await deps.generateSql(q); }
  catch (e) { const why = String((e as Error)?.message ?? e).slice(0, 300); console.error('[chat] LLM call failed:', why);
    await log({ error: `llm_unavailable: ${why}` }); return fail('ระบบ AI ไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้ง'); }

  const guard = validateSql(raw);
  if (!guard.ok) { await log({ generated_sql: raw, error: 'rejected: ' + guard.reason }); return fail(guard.reason, raw); }

  let rows: Row[];
  try { rows = await deps.runQuery(guard.sql); }
  catch { await log({ generated_sql: guard.sql, error: 'query_failed' }); return fail('ไม่สามารถดึงข้อมูลได้ กรุณาลองถามด้วยถ้อยคำอื่น', guard.sql); }

  const columns = rows.length ? Object.keys(rows[0]) : [];
  let answer: string;
  if (rows.length === 0) answer = 'ไม่พบข้อมูลที่ตรงกับคำถาม';
  else {
    try { answer = await deps.summarize(q, columns, rows.map((r) => columns.map((c) => r[c]))); }
    catch (e) { console.error('[chat] LLM summary failed:', String((e as Error)?.message ?? e).slice(0, 300)); answer = `พบข้อมูล ${rows.length} แถว ดูรายละเอียดในตารางด้านล่าง`; }
  }
  await log({ generated_sql: guard.sql, tool_name: 'text-to-sql', row_count: rows.length });
  return { answer, sql: guard.sql, columns, rows, error: null };
}
