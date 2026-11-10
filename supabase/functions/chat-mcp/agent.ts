// MCP client / agent loop: the LLM chooses MCP tools (function calling), the client executes them on the in-process MCP
// server, and the final answer is grounded ONLY in tool results. Returns the same shape as the text-to-SQL chat function.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createViewMcpServer, type Row, type ToolOutcome } from './mcpServer.ts';

export type ToolCall = { id: string; function: { name: string; arguments: string } };
export type AssistantMsg = { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] };
export type Msg = { role: 'system' | 'user' | 'tool' | 'assistant'; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[] };
export type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: unknown } };
export type AgentDeps = {
  llm(messages: Msg[], tools: ToolDef[]): Promise<AssistantMsg>;
  runQuery(sql: string): Promise<Row[]>;
  log(entry: Row): Promise<void>;
};
export type ChatResult = { answer: string; sql: string; columns: string[]; rows: Row[]; error: string | null; tool_calls?: { tool: string; args: unknown }[] };

export const SYSTEM_PROMPT = `You are a data assistant for a hospital information system. Answer the user's question (Thai or English) using ONLY the MCP tools.
Never guess numbers: call a tool, then answer from its result. Call list_views if unsure about view or column names.
Use aggregate_view for totals/averages/counts and query_view for lookups. "Today" questions use v_booking_queue_today; appointments from today on ("มีนัดอะไรบ้าง") use v_upcoming_bookings.
You cannot modify data. If the question is outside the available views, say so briefly. Answer in the language of the question, concisely.`;
const MAX_STEPS = 4;
const fail = (error: string): ChatResult => ({ answer: '', sql: '', columns: [], rows: [], error });

export async function handleMcpChat(deps: AgentDeps, question: string, user: { id: string }): Promise<ChatResult> {
  const q = typeof question === 'string' ? question.trim() : '';
  if (q === '' || q.length > 500) return fail('กรุณาพิมพ์คำถาม (ไม่เกิน 500 ตัวอักษร)');
  const log = (e: Row) => deps.log({ user_id: user.id, question: q, ...e }).catch(() => {});

  const outcomes: ToolOutcome[] = [];
  const server = createViewMcpServer(deps.runQuery, (o) => outcomes.push(o));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'hospital-chat-agent', version: '1.0.0' });
  await server.connect(st);
  await client.connect(ct);
  try {
    const listed = await client.listTools();
    const tools: ToolDef[] = listed.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema } }));
    const messages: Msg[] = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: q }];
    let answer = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      let reply: AssistantMsg;
      try { reply = await deps.llm(messages, tools); }
      catch (e) { const why = String((e as Error)?.message ?? e).slice(0, 300); console.error('[chat-mcp] LLM call failed:', why);
        await log({ error: `llm_unavailable: ${why}` }); return fail('ระบบ AI ไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้ง'); }
      if (!reply.tool_calls?.length) { answer = (reply.content ?? '').trim(); break; }
      messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls });
      for (const tc of reply.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* reported to the model below */ }
        let content: string;
        try {
          const res = await client.callTool({ name: tc.function.name, arguments: args });
          content = ((res.content as { text?: string }[] | undefined)?.[0]?.text) ?? '';
        } catch (e) { content = `Tool error: ${(e as Error).message.slice(0, 200)}`; }
        messages.push({ role: 'tool', tool_call_id: tc.id, content });
      }
    }
    const last = outcomes[outcomes.length - 1];
    if (!last) {
      await log({ error: 'no_tool_result', tool_name: 'mcp' });
      return fail('ไม่สามารถหาคำตอบจากข้อมูลของระบบได้ กรุณาถามเกี่ยวกับข้อมูลในระบบโรงพยาบาล เช่น คิวนัดหมาย เตียง ยา หรือค่ารักษา');
    }
    if (last.rows.length === 0) answer = 'ไม่พบข้อมูลที่ตรงกับคำถาม';
    else if (!answer) answer = `พบข้อมูล ${last.rows.length} แถว ดูรายละเอียดในตารางด้านล่าง`;
    const trace = outcomes.map((o) => ({ tool: o.tool, args: o.args }));
    await log({ generated_sql: last.sql, tool_name: 'mcp:' + trace.map((t) => t.tool).join(','), row_count: last.rows.length });
    return { answer, sql: `-- MCP tool: ${last.tool}(${JSON.stringify(last.args)})\n${last.sql}`, columns: last.columns, rows: last.rows, error: null, tool_calls: trace };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
