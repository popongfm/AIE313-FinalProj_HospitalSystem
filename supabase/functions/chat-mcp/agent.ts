// MCP client / agent loop: the LLM chooses MCP tools (function calling), the client executes them on the in-process MCP
// server, and the final answer is grounded ONLY in tool results. Returns the same shape as the text-to-SQL chat function.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createViewMcpServer, DATE_RE, TIME_RE, type BookingArgs, type ChatActions, type Row, type ToolOutcome } from './mcpServer.ts';

export type ToolCall = { id: string; function: { name: string; arguments: string } };
export type AssistantMsg = { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] };
export type Msg = { role: 'system' | 'user' | 'tool' | 'assistant'; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[] };
export type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: unknown } };
export type AgentDeps = {
  llm(messages: Msg[], tools: ToolDef[]): Promise<AssistantMsg>;
  runQuery(sql: string): Promise<Row[]>;
  log(entry: Row): Promise<void>;
  actions?: ChatActions;   // booking tools; without it the assistant stays read-only
};
// action: an appointment the assistant proposed; the page shows it with a "ยืนยันนัด" button that sends it back as
// { confirm_booking: action.args } (confirmBooking below). Nothing is saved before that.
export type ChatAction = { type: 'book_appointment'; args: BookingArgs };
export type ChatResult = { answer: string; sql: string; columns: string[]; rows: Row[]; error: string | null; tool_calls?: { tool: string; args: unknown }[]; action?: ChatAction };
export type HistoryItem = { role: 'user' | 'assistant'; content: string };
export type ChatUser = { id: string; role?: string | null };

export const SYSTEM_PROMPT = `You are a data assistant for a hospital information system. Answer the user's question (Thai or English) using ONLY the MCP tools.
Never guess numbers: call a tool, then answer from its result. Call list_views if unsure about view or column names.
Use aggregate_view for totals/averages/counts and query_view for lookups. "Today" questions use v_booking_queue_today; appointments from today on ("มีนัดอะไรบ้าง") use v_upcoming_bookings.
All dates and times in this system are Thailand time (Asia/Bangkok, GMT+7).
If the question is outside the available views, say so briefly. Answer in the language of the question, concisely, in plain text (no Markdown: no ** or #).`;
export const READ_ONLY_RULE = 'You cannot modify data.';
export const BOOKING_RULES = `The only change you can make is an appointment (booking, e.g. "นัดครั้งหน้า"): call propose_booking with the doctor, date (YYYY-MM-DD) and time (HH:MM).
propose_booking does NOT save: say the appointment is ready and ask the user to check it and press ยืนยันนัด; never say it is saved.
Use list_doctors to find a doctor. Turn relative dates ("พรุ่งนี้", "สัปดาห์หน้า", "อีก 2 สัปดาห์") into dates from today's date below.
A day number alone ("วันที่ 13") is the next such date from today (this month, or next month if it has passed). Thai times: "8 โมง"/"8 โมงเช้า" = 08:00,
"เที่ยง" = 12:00, "บ่ายโมง" = 13:00, "บ่าย 2 (โมง)" = 14:00, "4 โมงเย็น" = 16:00, "ครึ่ง" = :30 (e.g. "9 โมงครึ่ง" = 09:30).
Never answer in plain text: every reply goes through a tool (use ask_user to ask).
If the doctor, date or time is missing, or the HN for a staff account, call ask_user with one short question.
You cannot change or delete anything else; if asked, say so briefly.`;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Today in Bangkok (UTC+7, no daylight saving), e.g. "2026-11-12 (Thursday)".
export function bangkokToday(now = new Date()): string {
  const d = new Date(now.getTime() + 7 * 3600_000);
  return `${d.toISOString().slice(0, 10)} (${WEEKDAYS[d.getUTCDay()]})`;
}
export function systemPrompt(user: ChatUser, now = new Date(), canBook = false): string {
  if (!canBook) return `${SYSTEM_PROMPT}\n${READ_ONLY_RULE}`;
  const who = user.role === 'patient' ? 'a patient: appointments are always for themselves (no HN needed)'
    : user.role ? `staff (${user.role}): appointments are for a patient they name by HN` : 'unknown';
  return `${SYSTEM_PROMPT}\n${BOOKING_RULES}\nToday's date (Asia/Bangkok): ${bangkokToday(now)}. The signed-in user is ${who}.`;
}
// The last few turns of this chat, so a follow-up ("พรุ่งนี้ 10 โมง") is understood. Text only, trimmed and capped;
// it comes from the browser, so it can only add context, never permissions (the database checks every booking).
export function cleanHistory(h: unknown): HistoryItem[] {
  if (!Array.isArray(h)) return [];
  return h.filter((m): m is HistoryItem => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== '')
    .slice(-6).map((m) => ({ role: m.role, content: m.content.trim().slice(0, 1000) }));
}
const MAX_STEPS = 6;
// sent once when the model answers in plain text without using any tool (e.g. asks "เดือนไหน?" as text)
export const NUDGE = 'Reply only through the tools: call a data tool, propose_booking, or ask_user if you need to ask the user something. Do not answer in plain text.';
const fail = (error: string): ChatResult => ({ answer: '', sql: '', columns: [], rows: [], error });

export async function handleMcpChat(deps: AgentDeps, question: string, user: ChatUser, history: unknown = [], now = new Date()): Promise<ChatResult> {
  const q = typeof question === 'string' ? question.trim() : '';
  if (q === '' || q.length > 500) return fail('กรุณาพิมพ์คำถาม (ไม่เกิน 500 ตัวอักษร)');
  const log = (e: Row) => deps.log({ user_id: user.id, question: q, ...e }).catch(() => {});

  const outcomes: ToolOutcome[] = [];
  const server = createViewMcpServer(deps.runQuery, (o) => outcomes.push(o), deps.actions);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'hospital-chat-agent', version: '1.0.0' });
  await server.connect(st);
  await client.connect(ct);
  try {
    const listed = await client.listTools();
    const tools: ToolDef[] = listed.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema } }));
    const messages: Msg[] = [{ role: 'system', content: systemPrompt(user, now, !!deps.actions) }, ...cleanHistory(history), { role: 'user', content: q }];
    let answer = '', nudged = false;
    const attempts: { tool: string; error?: string }[] = [];   // every tool call, also the refused ones (for chat_logs)
    for (let step = 0; step < MAX_STEPS; step++) {
      let reply: AssistantMsg;
      try { reply = await deps.llm(messages, tools); }
      catch (e) { const why = String((e as Error)?.message ?? e).slice(0, 300); console.error('[chat-mcp] LLM call failed:', why);
        await log({ error: `llm_unavailable: ${why}` }); return fail('ระบบ AI ไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้ง'); }
      if (!reply.tool_calls?.length) {
        answer = (reply.content ?? '').trim();
        if (outcomes.length === 0 && !nudged && step < MAX_STEPS - 1) {   // plain text with no evidence: remind once
          nudged = true;
          messages.push({ role: 'assistant', content: reply.content ?? '' }, { role: 'user', content: NUDGE });
          continue;
        }
        break;
      }
      messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls });
      for (const tc of reply.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* reported to the model below */ }
        let content: string;
        try {
          const res = await client.callTool({ name: tc.function.name, arguments: args });
          content = ((res.content as { text?: string }[] | undefined)?.[0]?.text) ?? '';
          attempts.push(res.isError ? { tool: tc.function.name, error: content.slice(0, 300) } : { tool: tc.function.name });
        } catch (e) { content = `Tool error: ${(e as Error).message.slice(0, 200)}`; attempts.push({ tool: tc.function.name, error: content }); }
        messages.push({ role: 'tool', tool_call_id: tc.id, content });
      }
      if (outcomes.some((o) => o.question)) break;   // asked the user something: wait for the reply
    }
    const last = outcomes[outcomes.length - 1];
    const trace = outcomes.map((o) => ({ tool: o.tool, args: o.args }));
    const toolNames = 'mcp:' + trace.map((t) => t.tool).join(',');
    if (last?.question) {   // the assistant asks back (ask_user); show the question, no data
      await log({ tool_name: toolNames, row_count: 0 });
      return { answer: last.question, sql: '', columns: [], rows: [], error: null, tool_calls: trace };
    }
    const proposal = outcomes.findLast((o) => o.action);
    if (proposal?.action) {   // an appointment to confirm; nothing is saved until the user presses the button
      await log({ generated_sql: proposal.sql, tool_name: toolNames, row_count: 0 });
      return { answer: answer || 'ตรวจสอบรายละเอียดนัดด้านล่าง แล้วกด "ยืนยันนัด" เพื่อบันทึก', sql: `-- MCP tool: propose_booking (ยังไม่บันทึก)\n${proposal.sql}`,
        columns: proposal.columns, rows: proposal.rows, error: null, tool_calls: trace, action: { type: 'book_appointment', args: proposal.action } };
    }
    if (!last) {
      const tried = 'mcp:' + attempts.map((a) => a.tool + (a.error ? '!' : '')).join(',');
      const refusedBooking = attempts.findLast((a) => a.tool === 'propose_booking' && a.error);
      if (refusedBooking) {   // the database refused the appointment: say why (in Thai) instead of a generic message
        await log({ error: `booking_refused: ${refusedBooking.error}`, tool_name: tried });
        return fail(bookingError(refusedBooking.error!));
      }
      const why = attempts.findLast((a) => a.error)?.error ?? (answer ? `text only: ${answer.slice(0, 150)}` : 'no answer');
      await log({ error: `no_tool_result: ${why}`, tool_name: tried });
      return fail('ไม่สามารถหาคำตอบจากข้อมูลของระบบได้ กรุณาถามเกี่ยวกับข้อมูลในระบบโรงพยาบาล เช่น คิวนัดหมาย เตียง ยา หรือค่ารักษา');
    }
    if (last.rows.length === 0) answer = 'ไม่พบข้อมูลที่ตรงกับคำถาม';
    else if (!answer) answer = `พบข้อมูล ${last.rows.length} แถว ดูรายละเอียดในตารางด้านล่าง`;
    await log({ generated_sql: last.sql, tool_name: toolNames, row_count: last.rows.length });
    return { answer, sql: `-- MCP tool: ${last.tool}(${JSON.stringify(last.args)})\n${last.sql}`, columns: last.columns, rows: last.rows, error: null, tool_calls: trace };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

// The user pressed "ยืนยันนัด": save the proposed appointment. No LLM here. The arguments come back from the browser,
// so they are checked again here and, above all, by chat_book_appointment, which acts as the signed-in user: editing
// them in the browser cannot book anything that user could not book through the website anyway.
export async function confirmBooking(deps: AgentDeps, raw: unknown, user: ChatUser): Promise<ChatResult> {
  const a = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
  if (!deps.actions || !str(a.doctor, 100) || !str(a.date, 10) || !DATE_RE.test(String(a.date)) || !str(a.time, 5) || !TIME_RE.test(String(a.time))
      || (a.symptom != null && !str(a.symptom, 300)) || (a.hn != null && !str(a.hn, 20))) return fail('ข้อมูลนัดไม่ถูกต้อง กรุณาขอนัดใหม่อีกครั้ง');
  const args: BookingArgs = { doctor: String(a.doctor), date: String(a.date), time: String(a.time),
    ...(a.symptom ? { symptom: String(a.symptom) } : {}), ...(a.hn ? { hn: String(a.hn) } : {}) };
  const sql = `-- chat_book_appointment(<the signed-in user>, ${JSON.stringify(args)}, confirm => true)`;
  const log = (e: Row) => deps.log({ user_id: user.id, question: `[ยืนยันนัด] ${JSON.stringify(args)}`, tool_name: 'mcp:confirm_booking', generated_sql: sql, ...e }).catch(() => {});
  let row: Row;
  try { row = await deps.actions.book(args, true); }
  catch (e) {
    const why = String((e as Error).message ?? e);
    await log({ error: `booking_refused: ${why.slice(0, 300)}` });
    return fail(bookingError(why));
  }
  await log({ row_count: 1 });
  return { answer: `บันทึกนัดแล้ว: ${row.doctor_name} วันที่ ${row.booking_date} เวลา ${row.booking_time} น. (เวลาไทย GMT+7) คิวที่ ${row.queue_no} (HN ${row.hn})`,
    sql, columns: Object.keys(row), rows: [row], error: null };
}
// Thai message for a refused booking (the database's reasons are in English for the model).
export function bookingError(why: string): string {
  if (/function .*(chat_book_appointment|chat_doctor_directory)|schema cache/.test(why)) return 'ระบบนัดหมายยังไม่พร้อมใช้งาน (ผู้ดูแลระบบต้องรัน migration 2026-11-12_chat_booking.sql)';
  if (/already has an appointment/.test(why)) return 'ช่วงเวลานี้มีนัดแล้ว กรุณาขอนัดเวลาอื่น';
  if (/in the past/.test(why)) return 'วันที่นัดผ่านมาแล้ว กรุณาเลือกวันใหม่';
  if (/may not|only for itself|permission denied/.test(why)) return 'บัญชีนี้ไม่มีสิทธิ์ทำนัดนี้';
  if (/HN/.test(why)) return 'ไม่พบผู้ป่วยตาม HN ที่ระบุ';
  if (/doctor/.test(why)) return 'ไม่พบแพทย์ที่ระบุ';
  return 'บันทึกนัดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}
