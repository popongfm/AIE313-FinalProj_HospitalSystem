// Shared by smoke.mjs and screens.mjs: static server for web/, mocked Supabase, stubbed Chart.js.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export function loadPlaywright() { return createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright'); }
const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
export function startServer() {
  const server = createServer(async (req, res) => {
    try { const p = join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]); res.writeHead(200, { 'content-type': (MIME[extname(p)] || 'text/plain') + '; charset=utf-8' }); res.end(await readFile(p)); }
    catch { res.writeHead(404); res.end('nf'); }
  }).listen(0);
  return new Promise((ok) => server.on('listening', () => ok({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
export const MOCK_SUPABASE = `
const DB = { patient: [{ patient_id: 1, hn: 'HN1', national_id: '1100000000001', first_name: 'อนันต์', last_name: 'ใจดี' }],
  v_top_diagnosis: [{ icd_code: 'I10', description: 'ความดันโลหิตสูง', case_count: 9, rank_no: 1 }], v_feedback_summary: [],
  v_doctor_workload: [{ doctor_name: 'ก', status: 'pending', booking_count: 2 }, { doctor_name: 'ก', status: 'completed', booking_count: 1 }],
  v_visit_billing: [{ department: 'อายุรกรรม', month: '2026-10', total_amount: 100 }, { department: 'อายุรกรรม', month: '2026-10', total_amount: 50 }],
  v_inventory_stock_status: [{ generic_name: 'Warfarin', lot_number: 'L1', quantity_on_hand: 20, reorder_point: 100, stock_status: 'REORDER_URGENT' }], booking: [],
  v_bed_occupancy: [{ department: 'อายุรกรรม', occupied_beds: 3, available_beds: 1 }, { department: 'อายุรกรรม', occupied_beds: 1, available_beds: 1 }, { department: null, occupied_beds: 0, available_beds: 2 }],
  v_pharmacist_screening_queue: [{ prescription_id: 1, prescription_status: 'Pending' }, { prescription_id: 1, prescription_status: 'Pending' }, { prescription_id: 2, prescription_status: 'Screened' }],
  visit: [{ visit_id: 5, patient_id: 1, visit_type: 'OPD' }] };
const sess = () => JSON.parse(localStorage.getItem('mock_session') || 'null');
// my_role(): what staff.user_id / patient.user_id say about the signed-in account (u-new: not linked yet)
const ROLES = { 'u-admin': 'admin', 'u-patient': 'patient', 'u-pharm': 'pharmacist', 'u-nurse': 'nurse' };
export function createClient() {
  const qb = (table) => { const st = { op: 'select', filters: [] };
    const b = { select() { return b; }, maybeSingle() { st.single = true; return b; }, order() { return b; }, limit() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; },
      insert(row) { st.op = 'insert'; st.row = row; window.__lastInsert = row; return b; }, update() { st.op = 'update'; return b; }, delete() { st.op = 'delete'; return b; },
      then(res) { if (window.__failView === table) return res({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
        if (st.op === 'insert' && table === 'booking' && st.row.queue_no != null) return res({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
        if (st.op === 'delete' && table === 'patient') return res({ data: null, error: { code: '23503', message: 'violates foreign key' } });
        if (st.op === 'insert') { DB[table] = [...(DB[table] || []), st.row]; return res({ data: null, error: null }); }
        let rows = DB[table] || []; st.filters.forEach(([k, v]) => { rows = rows.filter((r) => r[k] === v); }); res({ data: st.single ? (rows[0] || null) : rows, error: null }); } };
    return b; };
  const BOOK = { hn: 'HN0001', patient_name: 'อนันต์ ใจดี', staff_id: 7, doctor_name: 'แพทย์ ทดสอบ', department: 'อายุรกรรม', booking_date: '2026-11-20', booking_time: '10:00', queue_no: 3 };
  const invoke = async (name, { body }) => { await new Promise((r) => setTimeout(r, 300)); (window.__chatBodies = window.__chatBodies || []).push(body);
    if (body.confirm_booking) return { data: { answer: 'บันทึกนัดแล้ว: แพทย์ ทดสอบ วันที่ 2026-11-20 เวลา 10:00 น. คิวที่ 3 (HN HN0001)', sql: '-- chat_book_appointment', columns: Object.keys(BOOK), rows: [{ ...BOOK, booking_id: 9 }], error: null }, error: null };
    if (body.question.includes('ขอนัด')) return { data: { answer: 'นัดวันไหนครับ', sql: '', columns: [], rows: [], error: null }, error: null };
    if (body.question.includes('พรุ่งนี้')) return { data: { answer: 'ตรวจสอบรายละเอียดแล้วกดยืนยันนัด', sql: '-- propose_booking', columns: Object.keys(BOOK), rows: [BOOK], error: null,
      action: { type: 'book_appointment', args: { doctor: '7', date: '2026-11-20', time: '10:00' } } }, error: null };
    if (body.question.includes('ลบ')) return { data: { answer: '', sql: 'DELETE FROM patient', columns: [], rows: [], error: 'อนุญาตเฉพาะคำสั่ง SELECT เท่านั้น' }, error: null };
    if (body.question.includes('ว่าง')) return { data: { answer: 'ไม่พบข้อมูลที่ตรงกับคำถาม', sql: 'select 1', columns: [], rows: [], error: null }, error: null };
    return { data: { answer: 'มีแพทย์ 8 คน', sql: 'select count(*) as n from v_doctor_workload LIMIT 100', columns: ['n'], rows: [{ n: 8 }], error: null }, error: null }; };
  const rpc = async (name) => {
    if (name === 'my_role') { const s = sess(); return { data: (s && ROLES[s.user.id]) || null, error: null }; }
    return { data: name === 'doctor_directory' ? [{ staff_id: 7, doctor_name: 'แพทย์ ทดสอบ', department: 'อายุรกรรม' }] : null, error: null }; };
  return { from: qb, rpc, functions: { invoke }, auth: {
    async signInWithPassword({ email, password }) { if (password !== 'secret1') return { error: { message: 'Invalid login credentials' } };
      localStorage.setItem('mock_session', JSON.stringify({ user: { id: email === 'new@b.th' ? 'u-new' : email === 'pt@b.th' ? 'u-patient' : email === 'ph@b.th' ? 'u-pharm' : email === 'ns@b.th' ? 'u-nurse' : 'u-admin' } })); return { error: null }; },
    async signUp({ email, options }) { window.__signups = (window.__signups || 0) + 1; window.__signupData = options && options.data;
      if (email === 'a@b.th') return { data: { user: { identities: [] }, session: null }, error: null };   // existing e-mail, confirm-email on
      if (email === 'dup@b.th') return { data: null, error: { message: 'Database error saving new user' } };   // trigger refused the patient data
      // confirm-email off: signed in at once; pt2 is linked by the trigger, stranger is a staff e-mail nobody added
      if (email === 'pt2@b.th' || email === 'stranger@b.th') { localStorage.setItem('mock_session', JSON.stringify({ user: { id: email === 'pt2@b.th' ? 'u-patient' : 'u-new' } }));
        return { data: { user: { identities: [{}] }, session: {} }, error: null }; }
      return { data: { user: { identities: [{}] }, session: null }, error: null }; },
    async signOut() { localStorage.removeItem('mock_session'); },
    async getSession() { return { data: { session: sess() } }; } } };
}`;
export async function newMockedContext(browser, options = {}) {
  const ctx = await browser.newContext(options);
  await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.APP_CONFIG={SUPABASE_URL:"http://x",SUPABASE_ANON_KEY:"k"}' }));
  await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK_SUPABASE }));
  await ctx.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.Chart=function(c,cfg){if(window.__chartThrow)throw new Error("bad chart data");(window.__charts=window.__charts||[]).push(cfg)}' }));
  return ctx;
}
