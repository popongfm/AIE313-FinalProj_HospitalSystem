// Browser smoke test with a mocked Supabase client + stubbed Chart.js.  Run: node web/tests/smoke.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try { const p = join(ROOT, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]); res.writeHead(200, { 'content-type': (MIME[extname(p)] || 'text/plain') + '; charset=utf-8' }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end('nf'); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const MOCK_SUPABASE = `
const DB = { patient: [{ patient_id: 1, hn: 'HN1', national_id: '1100000000001', first_name: 'อนันต์', last_name: 'ใจดี' }],
  v_top_diagnosis: [{ icd_code: 'I10', description: 'ความดันโลหิตสูง', case_count: 9, rank_no: 1 }], v_feedback_summary: [],
  v_doctor_workload: [{ doctor_name: 'ก', status: 'pending', booking_count: 2 }, { doctor_name: 'ก', status: 'completed', booking_count: 1 }],
  v_visit_billing: [{ department: 'อายุรกรรม', month: '2026-10', total_amount: 100 }, { department: 'อายุรกรรม', month: '2026-10', total_amount: 50 }],
  v_inventory_stock_status: [{ generic_name: 'Warfarin', lot_number: 'L1', quantity_on_hand: 20, reorder_point: 100, stock_status: 'REORDER_URGENT' }], booking: [],
  profiles: [{ user_id: 'u-admin', role: 'admin' }, { user_id: 'u-patient', role: 'patient', patient_id: 1 }], visit: [{ visit_id: 5, patient_id: 1, visit_type: 'OPD' }] };
const sess = () => JSON.parse(localStorage.getItem('mock_session') || 'null');
export function createClient() {
  const qb = (table) => { const st = { op: 'select', filters: [] };
    const b = { select() { return b; }, maybeSingle() { st.single = true; return b; }, order() { return b; }, limit() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; },
      insert(row) { st.op = 'insert'; st.row = row; window.__lastInsert = row; return b; }, update() { st.op = 'update'; return b; }, delete() { st.op = 'delete'; return b; },
      then(res) { if (st.op === 'insert' && table === 'booking' && st.row.queue_no != null) return res({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
        if (st.op === 'delete' && table === 'patient') return res({ data: null, error: { code: '23503', message: 'violates foreign key' } });
        if (st.op === 'insert') { DB[table] = [...(DB[table] || []), st.row]; return res({ data: null, error: null }); }
        let rows = DB[table] || []; st.filters.forEach(([k, v]) => { rows = rows.filter((r) => r[k] === v); }); res({ data: st.single ? (rows[0] || null) : rows, error: null }); } };
    return b; };
  const invoke = async (name, { body }) => { await new Promise((r) => setTimeout(r, 300));
    if (body.question.includes('ลบ')) return { data: { answer: '', sql: 'DELETE FROM patient', columns: [], rows: [], error: 'อนุญาตเฉพาะคำสั่ง SELECT เท่านั้น' }, error: null };
    if (body.question.includes('ว่าง')) return { data: { answer: 'ไม่พบข้อมูลที่ตรงกับคำถาม', sql: 'select 1', columns: [], rows: [], error: null }, error: null };
    return { data: { answer: 'มีแพทย์ 8 คน', sql: 'select count(*) as n from v_doctor_workload LIMIT 100', columns: ['n'], rows: [{ n: 8 }], error: null }, error: null }; };
  const rpc = async (name) => ({ data: name === 'doctor_directory' ? [{ staff_id: 7, doctor_name: 'แพทย์ ทดสอบ', department: 'อายุรกรรม' }] : null, error: null });
  return { from: qb, rpc, functions: { invoke }, auth: {
    async signInWithPassword({ email, password }) { if (password !== 'secret1') return { error: { message: 'Invalid login credentials' } };
      localStorage.setItem('mock_session', JSON.stringify({ user: { id: email === 'new@b.th' ? 'u-new' : email === 'pt@b.th' ? 'u-patient' : 'u-admin' } })); return { error: null }; },
    async signUp({ email }) { window.__signups = (window.__signups || 0) + 1;
      if (email === 'a@b.th') return { data: { user: { identities: [] }, session: null }, error: null };   // existing e-mail, confirm-email on
      return { data: { user: { identities: [{}] }, session: null }, error: null }; },
    async signOut() { localStorage.removeItem('mock_session'); },
    async getSession() { return { data: { session: sess() } }; } } };
}`;
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.APP_CONFIG={SUPABASE_URL:"http://x",SUPABASE_ANON_KEY:"k"}' }));
await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK_SUPABASE }));
await ctx.route('**/cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.Chart=function(c,cfg){(window.__charts=window.__charts||[]).push(cfg)}' }));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = async (name, fn) => { try { await fn(); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };

await check('unauthenticated app.html redirects to login', async () => { await page.goto(base + '/app.html'); await page.waitForURL('**/index.html'); });
await check('wrong password shows Thai error', async () => {
  await page.fill('#email', 'a@b.th'); await page.fill('#password', 'wrongpw'); await page.click('#login');
  await page.waitForFunction(() => document.getElementById('err').textContent.length > 0);
  assert.equal(await page.textContent('#err'), 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'); });
await check('sign-up with an existing e-mail shows Thai duplicate message', async () => {
  await page.fill('#email', 'a@b.th'); await page.fill('#password', 'secret1'); await page.click('#signup');
  await page.waitForFunction(() => document.getElementById('err').textContent.length > 0);
  assert.equal(await page.textContent('#err'), 'อีเมลนี้ถูกใช้สมัครแล้ว'); assert.equal(await page.textContent('#ok'), ''); });
await check('sign-up with a new e-mail stays on the page and says to wait for approval', async () => {
  await page.fill('#email', 'new@b.th'); await page.click('#signup');
  await page.waitForFunction(() => document.getElementById('ok').textContent.includes('ผู้ดูแลระบบอนุมัติ'));
  assert.equal(await page.textContent('#err'), ''); assert.ok(page.url().endsWith('/index.html')); });
await check('sign-up with a too-short password is blocked before calling Supabase', async () => {
  const before = await page.evaluate(() => window.__signups); await page.fill('#password', '123'); await page.click('#signup');
  assert.equal(await page.evaluate(() => window.__signups), before); });
await check('correct password reaches app (approved account, no pending notice)', async () => {
  await page.fill('#email', 'a@b.th'); await page.fill('#password', 'secret1'); await page.click('#login'); await page.waitForURL('**/app.html'); await page.waitForSelector('#panel table');
  assert.equal(await page.locator('#pending').count(), 0); });
await check('CRUD list shows patient row', async () => { assert.ok((await page.textContent('#panel table')).includes('HN1')); });
await check('delete patient with dependents shows Thai FK error', async () => {
  const del = page.locator('#panel button', { hasText: 'ลบ' }).first(); await del.click(); await page.locator('#panel button', { hasText: 'ยืนยันลบ?' }).click();
  await page.waitForFunction(() => document.querySelector('#err').textContent.includes('มีข้อมูลอื่นอ้างอิง')); });
await check('add patient with missing required field is blocked', async () => {
  await page.click('#new'); await page.fill('#f_hn', 'HN9'); await page.click('#form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#err').textContent.includes('กรุณากรอก')); });
await check('duplicate booking shows Thai duplicate error', async () => {
  await page.selectOption('#t', 'booking'); await page.click('#new');
  await page.fill('#f_patient_id', '1'); await page.fill('#f_staff_id', '1'); await page.fill('#f_booking_date', '2026-11-20'); await page.fill('#f_booking_time', '09:00'); await page.fill('#f_queue_no', '1'); await page.selectOption('#f_status', 'pending');
  await page.click('#form button[type=submit]'); await page.waitForFunction(() => document.querySelector('#err').textContent.includes('ข้อมูลซ้ำ')); });
await check('views page shows rows, and ไม่พบข้อมูล for an empty view', async () => {
  await page.click('[data-tab=views]'); await page.selectOption('#v', 'v_top_diagnosis'); await page.waitForSelector('#out table');
  await page.selectOption('#v', 'v_feedback_summary'); await page.waitForFunction(() => document.getElementById('out').textContent.includes('ไม่พบข้อมูล')); });
await check('dashboard draws 3 charts with merged D2 totals', async () => {
  await page.click('[data-tab=dash]'); await page.waitForFunction(() => (window.__charts || []).length === 3);
  const d2 = await page.evaluate(() => window.__charts[1].data.datasets[0].data); assert.deepEqual(d2, [150]); });
await check('chat: answer, SQL evidence and raw table are shown; input disabled while processing', async () => {
  await page.click('[data-tab=chat]'); await page.fill('#q', 'มีแพทย์กี่คน'); await page.click('#send');
  assert.equal(await page.isDisabled('#send'), true); assert.ok((await page.textContent('#log')).includes('กำลังประมวลผล'));
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('มีแพทย์ 8 คน'));
  assert.ok((await page.textContent('#log')).includes('มีแพทย์กี่คน'));
  assert.ok((await page.textContent('#log details')).includes('select count(*)'));
  assert.ok((await page.textContent('#log table')).includes('8')); assert.equal(await page.isDisabled('#send'), false); });
await check('chat: refused dangerous question shows the reason and no table', async () => {
  await page.fill('#q', 'ลบข้อมูลผู้ป่วยทั้งหมด'); await page.click('#send');
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('อนุญาตเฉพาะคำสั่ง SELECT'));
  assert.equal(await page.locator('#log .msg.bot').last().locator('table').count(), 0); });
await check('chat: empty result shows ไม่พบข้อมูล', async () => {
  await page.fill('#q', 'ผลว่างไหม'); await page.click('#send');
  await page.waitForFunction(() => [...document.querySelectorAll('#log .msg.bot')].some((m) => m.textContent.includes('ไม่พบข้อมูล'))); });
await check('app.html#chat opens the Chat tab; an unknown hash like #constructor falls back to the data tab', async () => {
  await page.goto('about:blank'); await page.goto(base + '/app.html#chat');
  await page.waitForFunction(() => document.getElementById('page-title').textContent === 'ผู้ช่วย AI');
  await page.goto('about:blank'); await page.goto(base + '/app.html#constructor');
  await page.waitForSelector('#panel table'); assert.equal(await page.textContent('#page-title'), 'ข้อมูลในระบบ'); });
await check('account without an approved profile sees the pending notice', async () => {
  await page.click('#logout'); await page.waitForURL('**/index.html');
  await page.fill('#email', 'new@b.th'); await page.fill('#password', 'secret1'); await page.click('#login'); await page.waitForURL('**/app.html');
  await page.waitForSelector('#pending'); assert.ok((await page.textContent('#pending')).includes('ยังไม่ได้รับสิทธิ์')); });
await check('patient account: own-record tables only, book with a doctor list, no add/edit on read-only tables', async () => {
  await page.goto(base + '/index.html'); await page.evaluate(() => localStorage.removeItem('mock_session')); await page.goto(base + '/index.html');
  await page.fill('#email', 'pt@b.th'); await page.fill('#password', 'secret1'); await page.click('#login'); await page.waitForURL('**/app.html*');
  await page.waitForSelector('#t'); assert.equal(await page.locator('#pending').count(), 0);
  assert.equal(await page.textContent('#page-title'), 'ข้อมูลของฉัน');
  assert.deepEqual(await page.$$eval('#t option', (o) => o.map((x) => x.value)), ['patient', 'booking', 'visit', 'prescription']);
  assert.equal(await page.isVisible('#new'), false, 'patients cannot add patient rows');
  await page.selectOption('#t', 'visit'); await page.waitForSelector('#list table');
  assert.equal(await page.locator('#list th', { hasText: 'จัดการ' }).count(), 0, 'visits are read-only');
  assert.equal(await page.isVisible('#new'), false);
  await page.selectOption('#t', 'booking'); await page.waitForFunction(() => document.querySelector('#list').textContent !== 'กำลังโหลด...');
  assert.equal(await page.isVisible('#new'), true); assert.equal(await page.textContent('#new'), '+ จองคิว'); await page.click('#new');
  assert.deepEqual(await page.$$eval('#f_staff_id option', (o) => o.map((x) => x.textContent)), ['', 'แพทย์ ทดสอบ (อายุรกรรม)']);
  assert.ok(await page.getAttribute('#f_booking_date', 'min'), 'no booking in the past');
  assert.equal(await page.locator('#f_queue_no, #f_patient_id, #f_status').count(), 0, 'set by the database');
  await page.selectOption('#f_staff_id', '7'); await page.fill('#f_booking_date', '2099-01-02'); await page.fill('#f_booking_time', '10:30');
  await page.click('#form button[type=submit]'); await page.waitForSelector('#form', { state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.__lastInsert), { staff_id: 7, booking_date: '2099-01-02', booking_time: '10:30', symptom: null }); });
await check('no uncaught page errors', async () => { assert.deepEqual(errors, [], JSON.stringify(errors)); });
console.log(results.join('\n'));
await browser.close(); server.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
