// Runs the documented chat cases against a real database: guard -> run_readonly_query as service_role.
// Usage: deno run --allow-run --allow-env cases.ts DBNAME   (prints a markdown table)
import { validateSql } from './sqlGuard.ts';
const db = Deno.args[0] ?? 'hospital_test';
type Case = { q: string; sql: string; expect: 'rows' | 'zero' | 'one' | 'rejected'; note?: string };
const CASES: Case[] = [
  { q: 'มียาอะไรบ้างที่ใกล้หมดอายุภายใน 90 วัน', sql: "select generic_name, lot_number, expiry_date from v_inventory_stock_status where stock_status = 'NEAR_EXPIRY'", expect: 'rows' },
  { q: 'วันนี้มีคิวนัดอะไรบ้าง', sql: 'select queue_no, booking_time, doctor_name, status from v_booking_queue_today', expect: 'rows' },
  { q: 'ใบสั่งยาที่รอเภสัชกรตรวจสอบมีรายการไหนบ้าง', sql: 'select prescription_id, generic_name, prescription_status from v_pharmacist_screening_queue', expect: 'rows' },
  { q: 'แพทย์คนไหนมีคิวจองมากที่สุด', sql: 'select doctor_name, sum(booking_count) as total from v_doctor_workload group by doctor_name order by total desc limit 1', expect: 'one' },
  { q: 'ห้องไหนมีอัตราการใช้เตียงสูงสุด', sql: 'select room_no, occupancy_pct from v_bed_occupancy order by occupancy_pct desc limit 1', expect: 'one' },
  { q: 'โรคที่พบมากที่สุด 3 อันดับแรก', sql: 'select icd_code, description, case_count from v_top_diagnosis order by rank_no limit 3', expect: 'rows' },
  { q: 'ค่ารักษารวมแยกตามแผนก', sql: 'select department, sum(total_amount) as total from v_visit_billing group by department order by total desc', expect: 'rows' },
  { q: 'ยาอะไรต้องสั่งซื้อเพิ่ม', sql: "select generic_name, lot_number, quantity_on_hand, reorder_point from v_inventory_stock_status where stock_status = 'REORDER_URGENT' order by quantity_on_hand", expect: 'rows' },
  { q: 'มีแพทย์ที่มีการจองกี่คน', sql: 'select count(distinct staff_id) as doctors from v_doctor_workload', expect: 'one' },
  { q: 'How many bookings does each doctor have per status?', sql: 'select doctor_name, status, booking_count from v_doctor_workload order by doctor_name', expect: 'rows' },
  { q: 'วันนี้มีการจองที่ถูกยกเลิกไหม', sql: "select * from v_booking_queue_today where status = 'cancelled'", expect: 'zero', note: 'ผลว่าง → UI แสดง "ไม่พบข้อมูล"' },
  { q: 'ลบข้อมูลผู้ป่วยทั้งหมด (อันตราย)', sql: 'DELETE FROM patient', expect: 'rejected' },
  { q: 'แสดงเลขบัตรประชาชนของผู้ป่วยทุกคน (อันตราย)', sql: 'select national_id, first_name from patient', expect: 'rejected' },
  { q: 'ลบข้อมูลแล้วแสดงรายชื่อแพทย์ (อันตราย)', sql: 'select * from v_doctor_workload; drop table patient', expect: 'rejected' },
];
async function psql(sql: string): Promise<{ ok: boolean; out: string }> {
  const p = new Deno.Command('psql', { args: ['-X', '-At', '-d', db], stdin: 'piped', stdout: 'piped', stderr: 'piped' }).spawn();
  const w = p.stdin.getWriter(); await w.write(new TextEncoder().encode(`SET ROLE service_role;\nSELECT run_readonly_query($q$${sql}$q$)::text;\n`)); await w.close();
  const r = await p.output();
  return { ok: r.success, out: new TextDecoder().decode(r.stdout).split('\n').filter((l) => l.startsWith('[')).join('') + new TextDecoder().decode(r.stderr) };
}
const esc = (s: string) => s.replace(/\|/g, '\\|');
const rows: string[] = ['| # | คำถาม | SQL / Tool ที่ถูกเรียก | ผลที่คาดหวัง | ผลจริง | ถูก/ผิด |', '|---|---|---|---|---|---|'];
let failed = 0;
for (const [i, c] of CASES.entries()) {
  const g = validateSql(c.sql);
  let actual: string, pass: boolean;
  if (!g.ok) { actual = `ถูกปฏิเสธโดย guard: ${g.reason}`; pass = c.expect === 'rejected'; }
  else {
    const r = await psql(g.sql);
    const n = r.ok && r.out.startsWith('[') ? (JSON.parse(r.out).length as number) : -1;
    actual = n < 0 ? `ผิดพลาด: ${r.out.trim().split('\n')[0]}` : `${n} แถว`;
    pass = (c.expect === 'rows' && n >= 1) || (c.expect === 'one' && n === 1) || (c.expect === 'zero' && n === 0);
  }
  if (!pass) failed++;
  const sql = g.ok ? g.sql : c.sql;
  rows.push(`| ${i + 1} | ${esc(c.q)} | \`${esc(sql)}\` | ${{ rows: '≥ 1 แถว', one: '1 แถว', zero: '0 แถว (ไม่พบข้อมูล)', rejected: 'ถูกปฏิเสธ ไม่ถึงฐานข้อมูล' }[c.expect]} | ${esc(actual)} | ${pass ? '✅ ถูก' : '❌ ผิด'} |`);
}
// defence in depth: even if the guard were bypassed, the database role refuses base tables
const bypass = await psql('select national_id from patient');
const dbDenied = !bypass.ok || bypass.out.includes('permission denied');
rows.push(`| ${CASES.length + 1} | (ข้าม guard) อ่านตาราง patient ตรง ๆ ผ่าน RPC | \`select national_id from patient\` | DB ปฏิเสธ (insufficient_privilege) | ${dbDenied ? 'permission denied' : 'อ่านได้!'} | ${dbDenied ? '✅ ถูก' : '❌ ผิด'} |`);
if (!dbDenied) failed++;
console.log(rows.join('\n'));
Deno.exit(failed ? 1 : 0);
