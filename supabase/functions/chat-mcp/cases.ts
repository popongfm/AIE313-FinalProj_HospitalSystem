// Runs documented MCP chat cases against a real database: scripted tool calls -> MCP server -> sqlGuard -> run_readonly_query.
// Usage: deno run --allow-run --allow-env cases.ts DBNAME   (prints a markdown table). Which tools a LIVE model picks is a manual test.
import { handleMcpChat, type AssistantMsg } from './agent.ts';
const db = Deno.args[0] ?? 'hospital_test';
const call = (name: string, args: unknown): AssistantMsg => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c', function: { name, arguments: JSON.stringify(args) } }] });
type Case = { q: string; tool: AssistantMsg; expect: 'rows' | 'zero' | 'error' };
const CASES: Case[] = [
  { q: 'ใบสั่งยาที่รอเภสัชกรตรวจสอบมีรายการไหนบ้าง', tool: call('query_view', { view: 'v_pharmacist_screening_queue', filters: [{ column: 'prescription_status', op: '=', value: 'Pending' }] }), expect: 'rows' },
  { q: 'ยาที่ใกล้หมดอายุ', tool: call('query_view', { view: 'v_inventory_stock_status', filters: [{ column: 'stock_status', op: '=', value: 'NEAR_EXPIRY' }], limit: 20 }), expect: 'rows' },
  { q: 'โรคที่พบมากที่สุด 3 อันดับแรก', tool: call('query_view', { view: 'v_top_diagnosis', order_by: [{ column: 'rank_no' }], limit: 3 }), expect: 'rows' },
  { q: 'ค่ารักษารวมแยกตามแผนก', tool: call('aggregate_view', { view: 'v_visit_billing', group_by: ['department'], metrics: [{ fn: 'sum', column: 'total_amount', alias: 'total' }], order_by: [{ column: 'total', direction: 'desc' }] }), expect: 'rows' },
  { q: 'จำนวนการจองของแพทย์แต่ละคน', tool: call('aggregate_view', { view: 'v_doctor_workload', group_by: ['doctor_name'], metrics: [{ fn: 'sum', column: 'booking_count', alias: 'total' }], order_by: [{ column: 'total', direction: 'desc' }], limit: 5 }), expect: 'rows' },
  { q: 'ห้องที่อัตราใช้เตียงสูงสุด', tool: call('query_view', { view: 'v_bed_occupancy', order_by: [{ column: 'occupancy_pct', direction: 'desc' }], limit: 1 }), expect: 'rows' },
  { q: 'มีนัดหมายอะไรบ้าง (ตั้งแต่วันนี้)', tool: call('query_view', { view: 'v_upcoming_bookings', columns: ['booking_date', 'booking_time', 'doctor_name', 'status'], limit: 20 }), expect: 'rows' },
  { q: 'วันนี้มีคิวที่ยกเลิกไหม (ผลว่าง)', tool: call('query_view', { view: 'v_booking_queue_today', filters: [{ column: 'status', op: '=', value: 'cancelled' }] }), expect: 'zero' },
  { q: 'ขอเลขบัตรประชาชนผู้ป่วย (อันตราย)', tool: call('query_view', { view: 'patient', columns: ['national_id'] }), expect: 'error' },
];
async function psql(sql: string): Promise<Record<string, unknown>[]> {
  const p = new Deno.Command('psql', { args: ['-X', '-At', '-d', db], stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
  const w = p.stdin.getWriter(); await w.write(new TextEncoder().encode(`SET ROLE service_role;\nSELECT replace(run_readonly_query($q$${sql}$q$)::text, E'\\n', '');\n`)); await w.close(); // json_agg spans lines; keep it on one
  const r = await p.output();
  if (!r.success) throw new Error(new TextDecoder().decode(r.stderr));
  return JSON.parse(new TextDecoder().decode(r.stdout).split('\n').filter((l) => l.startsWith('['))[0]);
}
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ⏎ ");
const out = ['| # | คำถาม | MCP Tool / SQL ที่ถูกเรียก | ผลที่คาดหวัง | ผลจริง | ถูก/ผิด |', '|---|---|---|---|---|---|'];
let failed = 0;
for (const [i, c] of CASES.entries()) {
  let n = 0;
  const script = [c.tool, { role: 'assistant', content: 'สรุปผล' } as AssistantMsg];
  // after the scripted tool call the model keeps answering in text (also after the agent's one reminder)
  const r = await handleMcpChat({ llm: async () => script[Math.min(n++, script.length - 1)], runQuery: psql, log: async () => {} }, c.q, { id: 'test' });
  const actual = r.error ? `ปฏิเสธ/ผิดพลาด: ${r.error}` : `${r.rows.length} แถว`;
  const pass = (c.expect === 'rows' && !r.error && r.rows.length > 0) || (c.expect === 'zero' && !r.error && r.rows.length === 0) || (c.expect === 'error' && !!r.error);
  if (!pass) failed++;
  out.push(`| ${i + 1} | ${esc(c.q)} | \`${esc(r.sql || JSON.stringify((c.tool.tool_calls![0].function)))}\` | ${c.expect === 'rows' ? 'มีข้อมูล' : c.expect === 'zero' ? 'ผลว่าง → "ไม่พบข้อมูล"' : 'ถูกปฏิเสธ'} | ${esc(actual)} | ${pass ? '✅' : '❌'} |`);
}
console.log(out.join('\n'));
Deno.exit(failed ? 1 : 0);
