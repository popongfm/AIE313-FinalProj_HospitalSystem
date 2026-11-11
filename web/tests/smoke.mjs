// Browser smoke test with a mocked Supabase client + stubbed Chart.js.  Run: node web/tests/smoke.mjs
import assert from 'node:assert/strict';
import { loadPlaywright, startServer, newMockedContext } from './harness.mjs';

const { chromium } = loadPlaywright();
const server = await startServer();
const { base } = server;
const browser = await chromium.launch();
const ctx = await newMockedContext(browser);
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = async (name, fn) => { try { await fn(); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };

await check('unauthenticated app.html redirects to login', async () => { await page.goto(base + '/app.html'); await page.waitForURL('**/index.html'); });
await check('wrong password shows Thai error', async () => {
  await page.fill('#email', 'a@b.th'); await page.fill('#password', 'wrongpw'); await page.click('#login');
  await page.waitForFunction(() => document.getElementById('err').textContent.length > 0);
  assert.equal(await page.textContent('#err'), 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'); });
await check('every page says which time zone it uses: Thailand, Asia/Bangkok (GMT+7)', async () => {
  for (const path of ['/index.html', '/register.html']) {
    await page.goto(base + path);
    const t = await page.textContent('#tz-clock'); assert.ok(t.includes('Asia/Bangkok') && t.includes('GMT+7') && t.includes('เวลาประเทศไทย'), path + ': ' + t);
  }
  await page.goto(base + '/index.html'); });
await check('login page links to the separate registration page', async () => {
  assert.equal(await page.getAttribute('#signup', 'href'), 'register.html'); });
const fillPatient = async (email, extra = {}) => {
  await page.goto(base + '/register.html');
  const f = { first_name: 'มานี', last_name: 'มีนา', national_id: '1234567890123', birth_date: '2000-01-31', email, password: 'secret1', password2: 'secret1', ...extra };
  for (const [k, v] of Object.entries(f)) await page.fill('#' + k, v); };
await check('register: patient sign-up sends the data the database trigger needs', async () => {
  await fillPatient('new@b.th', { phone: '0812345678' }); await page.click('#submit');
  await page.waitForFunction(() => document.getElementById('ok').textContent.includes('ยืนยันอีเมล'));
  assert.deepEqual(await page.evaluate(() => window.__signupData), { account_type: 'patient', first_name: 'มานี', last_name: 'มีนา', national_id: '1234567890123', birth_date: '2000-01-31', phone: '0812345678' });
  assert.ok(page.url().endsWith('/register.html')); });
await check('register: existing e-mail shows Thai duplicate message', async () => {
  await fillPatient('a@b.th'); await page.click('#submit');
  await page.waitForFunction(() => document.getElementById('err').textContent.length > 0);
  assert.equal(await page.textContent('#err'), 'อีเมลนี้ถูกใช้สมัครแล้ว'); assert.equal(await page.textContent('#ok'), ''); });
await check('register: refused patient data (trigger) shows a Thai explanation', async () => {
  await fillPatient('dup@b.th'); await page.click('#submit');
  await page.waitForFunction(() => document.getElementById('err').textContent.includes('เลขบัตรประชาชน')); });
await check('register: bad national ID / mismatched passwords are blocked before calling Supabase', async () => {
  // fillPatient loads a fresh page, so the mock's sign-up counter starts at 0 each time
  await fillPatient('x@b.th', { national_id: '12345' }); await page.click('#submit');
  assert.equal(await page.textContent('#err'), 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');
  assert.equal(await page.evaluate(() => window.__signups || 0), 0);
  await fillPatient('x@b.th', { password2: 'other12' }); await page.click('#submit');
  assert.equal(await page.textContent('#err'), 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
  assert.equal(await page.evaluate(() => window.__signups || 0), 0); });
await check('register: staff sign-up hides patient fields and sends only the account type', async () => {
  await page.goto(base + '/register.html'); await page.check('input[value=staff]');
  assert.equal(await page.isVisible('#national_id'), false); assert.equal(await page.isVisible('#staff-hint'), true);
  await page.fill('#email', 'stranger@b.th'); await page.fill('#password', 'secret1'); await page.fill('#password2', 'secret1'); await page.click('#submit');
  await page.waitForFunction(() => document.getElementById('ok').textContent.includes('รายชื่อเจ้าหน้าที่'));
  assert.deepEqual(await page.evaluate(() => window.__signupData), { account_type: 'staff' });
  assert.equal(await page.evaluate(() => localStorage.getItem('mock_session')), null, 'unlinked account is signed out'); });
await check('register: an account the trigger linked goes straight into the app', async () => {
  await fillPatient('pt2@b.th'); await page.click('#submit'); await page.waitForURL('**/app.html');
  await page.evaluate(() => localStorage.removeItem('mock_session')); await page.goto(base + '/index.html'); });
await check('correct password reaches app (approved account, no pending notice)', async () => {
  await page.fill('#email', 'a@b.th'); await page.fill('#password', 'secret1'); await page.click('#login'); await page.waitForURL('**/app.html'); await page.waitForSelector('#panel table');
  assert.equal(await page.locator('#pending').count(), 0); });
await check('app bar shows the account role', async () => { assert.equal(await page.textContent('#role-chip'), 'ผู้ดูแลระบบ'); });
await check('clicking the icon inside a nav button switches tab', async () => {
  await page.click('[data-tab=views] svg'); await page.waitForSelector('#v'); await page.click('[data-tab=data] svg'); await page.waitForSelector('#panel table'); });
await check('CRUD list shows patient row', async () => { assert.ok((await page.textContent('#panel table')).includes('HN1')); });
await check('delete patient with dependents shows Thai FK error', async () => {
  const del = page.locator('#panel button', { hasText: 'ลบ' }).first(); await del.click(); await page.locator('#panel button', { hasText: 'ยืนยันลบ?' }).click();
  await page.waitForFunction(() => document.querySelector('#err').textContent.includes('มีข้อมูลอื่นอ้างอิง')); });
await check('add patient with missing required field is blocked', async () => {
  await page.click('#new'); await page.fill('#f_hn', 'HN9'); await page.click('#form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#err').textContent.includes('กรุณากรอก')); });
await check('drawer: title, error inside it, Escape closes and focus returns to the add button', async () => {
  assert.equal(await page.textContent('#form h2'), 'เพิ่มผู้ป่วย');
  assert.ok((await page.textContent('#form-err')).includes('กรุณากรอก'));
  await page.keyboard.press('Escape'); await page.waitForSelector('#form', { state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'new'); });
await check('status select shows Thai labels with database values', async () => {
  await page.selectOption('#t', 'booking'); await page.click('#new');
  assert.deepEqual(await page.$$eval('#f_status option', (o) => o.slice(1).map((x) => [x.value, x.textContent])),
    [['pending', 'รอยืนยัน'], ['confirmed', 'ยืนยันแล้ว'], ['completed', 'เสร็จสิ้น'], ['cancelled', 'ยกเลิก']]);
  await page.click('#form .drawer-foot button[type=button]'); await page.waitForSelector('#form', { state: 'hidden' });
  await page.selectOption('#t', 'patient'); await page.waitForSelector('#list table'); });
await check('duplicate booking shows Thai duplicate error', async () => {
  await page.selectOption('#t', 'booking'); await page.click('#new');
  await page.fill('#f_patient_id', '1'); await page.fill('#f_staff_id', '1'); await page.fill('#f_booking_date', '2026-11-20'); await page.fill('#f_booking_time', '09:00'); await page.fill('#f_queue_no', '1'); await page.selectOption('#f_status', 'pending');
  await page.click('#form button[type=submit]'); await page.waitForFunction(() => document.querySelector('#err').textContent.includes('ข้อมูลซ้ำ')); });
await check('views page shows rows, and ไม่พบข้อมูล for an empty view', async () => {
  await page.click('[data-tab=views]'); await page.selectOption('#v', 'v_top_diagnosis'); await page.waitForSelector('#out table');
  await page.selectOption('#v', 'v_feedback_summary'); await page.waitForFunction(() => document.getElementById('out').textContent.includes('ไม่พบข้อมูล')); });
await check('views: report names in Thai, grouped by zone; status shown as a badge', async () => {
  await page.click('[data-tab=views]'); await page.selectOption('#v', 'v_inventory_stock_status'); await page.waitForSelector('#out table');
  assert.equal(await page.textContent('#v option[value=v_inventory_stock_status]'), 'สถานะสต็อกยา (v_inventory_stock_status)');
  assert.deepEqual(await page.$$eval('#v optgroup', (g) => g.map((x) => x.label)), ['นัดหมาย', 'เวชระเบียน', 'เภสัชกรรม']);
  assert.equal(await page.getAttribute('#out .badge', 'data-tone'), 'danger'); assert.equal(await page.textContent('#out .badge'), 'ต้องสั่งด่วน');
  assert.equal(await page.textContent('.zone-sign strong'), 'เภสัชกรรม'); });
await check('table search hides rows and updates the count', async () => {
  await page.click('[data-tab=dash]'); await page.click('[data-tab=data]'); await page.waitForSelector('#list table');
  await page.fill('#list .table-search', 'ไม่มีใครชื่อนี้');
  assert.equal(await page.locator('#list tbody tr:visible').count(), 0); assert.equal(await page.textContent('#list .table-count'), 'แสดง 0 จาก 1 รายการ');
  await page.fill('#list .table-search', 'hn1'); assert.equal(await page.locator('#list tbody tr:visible').count(), 1);
  assert.equal(await page.textContent('#list .table-count'), 'แสดง 1 จาก 1 รายการ'); });
const headings = () => page.$$eval('#panel h3', (h) => h.map((x) => x.textContent));
await check('admin dashboard draws all 5 staff charts in order', async () => {
  await page.evaluate(() => { window.__charts = []; });
  await page.click('[data-tab=dash]'); await page.waitForFunction(() => window.__charts.length === 5);
  assert.deepEqual((await headings()).map((h) => h.slice(0, 2)), ['D1', 'D2', 'D3', 'D4', 'D5']);
  assert.deepEqual(await page.$$eval('#panel .chart-card', (c) => c.map((x) => x.style.getPropertyValue('--zone').trim())), ['var(--z-appt)', 'var(--z-rec)', 'var(--z-rx)', 'var(--z-rec)', 'var(--z-rx)']);
  assert.equal(await page.textContent('#page-desc'), 'กราฟตามหน้าที่ของบัญชีนี้ ผู้ดูแลระบบเห็นทุกกราฟ');
  const c = await page.evaluate(() => window.__charts.map((x) => ({ labels: x.data.labels, data: x.data.datasets.map((d) => d.data) })));
  assert.deepEqual(c[1].data[0], [150]);
  assert.deepEqual(c[3], { labels: ['อายุรกรรม', 'ไม่ระบุแผนก'], data: [[4, 0], [2, 2]] });
  assert.deepEqual(c[4], { labels: ['Pending', 'Screened'], data: [[1, 1]] }); });
await check('app header shows the Thai time zone', async () => {
  const t = await page.textContent('#tz-clock'); assert.ok(t.includes('Asia/Bangkok, GMT+7') && /\d{2}:\d{2} น\./.test(t), t); });
await check('chat: answer, SQL evidence and raw table are shown; input disabled while processing', async () => {
  await page.click('[data-tab=chat]'); await page.fill('#q', 'มีแพทย์กี่คน'); await page.click('#send');
  assert.equal(await page.isDisabled('#send'), true); assert.ok((await page.textContent('#log')).includes('กำลังประมวลผล'));
  assert.equal(await page.locator('#log .msg.bot.pending .dot').count(), 3);
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('มีแพทย์ 8 คน'));
  assert.ok((await page.textContent('#log')).includes('มีแพทย์กี่คน'));
  assert.ok((await page.textContent('#log details')).includes('select count(*)'));
  assert.ok((await page.textContent('#log table')).includes('8')); assert.equal(await page.isDisabled('#send'), false); });
await check('chat: example chip fills the question box', async () => {
  await page.click('#ex button >> nth=0'); assert.equal(await page.inputValue('#q'), 'แพทย์คนไหนมีคิวจองมากที่สุด'); await page.fill('#q', ''); });
await check('chat: refused dangerous question shows the reason and no table', async () => {
  await page.fill('#q', 'ลบข้อมูลผู้ป่วยทั้งหมด'); await page.click('#send');
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('อนุญาตเฉพาะคำสั่ง SELECT'));
  assert.equal(await page.locator('#log .msg.bot').last().locator('table').count(), 0); });
await check('chat: empty result shows ไม่พบข้อมูล', async () => {
  await page.fill('#q', 'ผลว่างไหม'); await page.click('#send');
  await page.waitForFunction(() => [...document.querySelectorAll('#log .msg.bot')].some((m) => m.textContent.includes('ไม่พบข้อมูล'))); });
await check('chat: booking is only proposed; "ยืนยันนัด" sends it back to be saved; history goes with follow-ups', async () => {
  await page.fill('#q', 'ขอนัดพบแพทย์'); await page.click('#send');
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('นัดวันไหนครับ'));
  await page.fill('#q', 'พรุ่งนี้ 10 โมง'); await page.click('#send');
  await page.waitForSelector('#log .booking-card .confirm-booking');
  const card = await page.textContent('#log .booking-card');
  assert.ok(card.includes('แพทย์ ทดสอบ') && card.includes('2026-11-20') && card.includes('10:00'));
  assert.equal(await page.locator('#log .msg.bot').last().locator('table').count(), 0, 'proposal shows the card, not the raw table');
  const followUp = await page.evaluate(() => window.__chatBodies.at(-1));
  assert.deepEqual(followUp.history.slice(-2), [{ role: 'user', content: 'ขอนัดพบแพทย์' }, { role: 'assistant', content: 'นัดวันไหนครับ' }]);
  const before = await page.evaluate(() => window.__chatBodies.length);
  await page.click('#log .booking-card .confirm-booking');
  await page.waitForFunction(() => document.querySelector('#log').textContent.includes('บันทึกนัดแล้ว'));
  assert.deepEqual(await page.evaluate(() => window.__chatBodies.at(-1)), { confirm_booking: { doctor: '7', date: '2026-11-20', time: '10:00' } });
  assert.equal(await page.evaluate(() => window.__chatBodies.length), before + 1);
  assert.equal(await page.locator('#log .booking-card .confirm-booking').count(), 0, 'button gone once saved');
  assert.ok((await page.textContent('#log .booking-card')).includes('บันทึกแล้ว'));
  // a second proposal can be cancelled: nothing is sent
  await page.fill('#q', 'พรุ่งนี้ 10 โมง อีกครั้ง'); await page.click('#send');
  await page.waitForFunction(() => document.querySelectorAll('#log .booking-card .cancel-booking').length === 1);
  const n = await page.evaluate(() => window.__chatBodies.length);
  await page.click('#log .booking-card .cancel-booking');
  assert.ok((await page.locator('#log .booking-card').last().textContent()).includes('ไม่ได้บันทึก'));
  assert.equal(await page.evaluate(() => window.__chatBodies.length), n); });
await check('app.html#chat opens the Chat tab; an unknown hash like #constructor falls back to the data tab', async () => {
  await page.goto('about:blank'); await page.goto(base + '/app.html#chat');
  await page.waitForFunction(() => document.getElementById('page-title').textContent === 'ผู้ช่วย AI');
  await page.goto('about:blank'); await page.goto(base + '/app.html#constructor');
  await page.waitForSelector('#panel table'); assert.equal(await page.textContent('#page-title'), 'ข้อมูลในระบบ'); });
await check('account not linked yet sees the pending notice', async () => {
  await page.click('#logout'); await page.waitForURL('**/index.html');
  await page.fill('#email', 'new@b.th'); await page.fill('#password', 'secret1'); await page.click('#login'); await page.waitForURL('**/app.html');
  await page.waitForSelector('#pending'); assert.ok((await page.textContent('#pending')).includes('ยังไม่ได้ผูก')); });
await check('patient account: own-record tables only, book with a doctor list, no add/edit on read-only tables', async () => {
  await page.goto(base + '/index.html'); await page.evaluate(() => localStorage.removeItem('mock_session')); await page.goto(base + '/index.html');
  await page.fill('#email', 'pt@b.th'); await page.fill('#password', 'secret1'); await page.click('#login'); await page.waitForURL('**/app.html*');
  await page.waitForSelector('#t'); assert.equal(await page.locator('#pending').count(), 0);
  assert.equal(await page.textContent('#page-title'), 'ข้อมูลของฉัน');
  assert.equal(await page.textContent('#role-chip'), 'ผู้ป่วย');
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
  assert.deepEqual(await page.evaluate(() => window.__lastInsert), { staff_id: 7, booking_date: '2099-01-02', booking_time: '10:30', symptom: null });
  await page.waitForSelector('#toasts .toast'); assert.equal(await page.textContent('#toasts .toast'), 'เพิ่มข้อมูลแล้ว'); });
await check('patient: no reports tab, own-billing dashboard', async () => {
  assert.equal(await page.isVisible('[data-tab=views]'), false);
  assert.deepEqual(await page.$$eval('#nav button', (b) => b.filter((x) => !x.hidden).map((x) => x.dataset.tab)), ['data', 'dash', 'chat']);
  await page.evaluate(() => { window.__charts = []; });
  await page.click('[data-tab=dash]'); await page.waitForFunction(() => window.__charts.length === 1);
  assert.equal(await page.textContent('#page-title'), 'ภาพรวมของฉัน');
  assert.deepEqual(await headings(), ['ค่ารักษาของฉันรายเดือน (บาท)']);
  assert.deepEqual(await page.evaluate(() => window.__charts[0].data.datasets[0].data), [150]); });
await check('reports button starts hidden in app.html, so patients never see it flash', async () => {
  const html = await (await fetch(base + '/app.html')).text();
  assert.match(html, /<button data-tab="views"[^>]*\shidden[\s>]/); });
await check('patient: a scripted click on the hidden reports button changes nothing', async () => {
  const before = await page.evaluate(() => location.hash);
  await page.evaluate(() => document.querySelector('[data-tab=views]').click());
  assert.equal(await page.evaluate(() => location.hash), before); assert.equal(await page.locator('#v').count(), 0); });
await check('patient: app.html#views falls back to the data tab', async () => {
  await page.goto('about:blank'); await page.goto(base + '/app.html#views'); await page.waitForSelector('#t');
  assert.equal(await page.textContent('#page-title'), 'ข้อมูลของฉัน'); assert.equal(await page.locator('#v').count(), 0); });
const loginAs = async (email) => {
  await page.goto(base + '/index.html'); await page.evaluate(() => localStorage.removeItem('mock_session')); await page.goto(base + '/index.html');
  await page.fill('#email', email); await page.fill('#password', 'secret1'); await page.click('#login'); await page.waitForURL('**/app.html*'); await page.waitForSelector('#t'); };
await check('pharmacist dashboard shows only D5 then D3', async () => {
  await loginAs('ph@b.th'); await page.evaluate(() => { window.__charts = []; });
  await page.click('[data-tab=dash]'); await page.waitForFunction(() => window.__charts.length === 2);
  assert.deepEqual(await headings(), ['D5 ใบสั่งยารอคัดกรอง แยกตามสถานะ', 'D3 ยาที่ต่ำกว่าจุดสั่งซื้อ']); });
await check('nurse dashboard: one failing chart does not block the other', async () => {
  await loginAs('ns@b.th'); await page.evaluate(() => { window.__charts = []; window.__failView = 'v_bed_occupancy'; });
  await page.click('[data-tab=dash]'); await page.waitForFunction(() => window.__charts.length === 1);
  assert.deepEqual((await headings()).map((h) => h.slice(0, 2)), ['D4', 'D1']);
  assert.equal(await page.evaluate(() => window.__charts[0].data.datasets[0].label), 'pending');
  assert.ok((await page.textContent('#panel .err')).length > 0, 'error shown');
  assert.equal(await page.isVisible('#panel .card:first-child .empty'), true, 'D4 shows ไม่พบข้อมูล');
  await page.evaluate(() => { window.__failView = null; }); });
await check('a chart that throws while drawing shows ไม่พบข้อมูล and the error line', async () => {
  await loginAs('ph@b.th'); await page.evaluate(() => { window.__chartThrow = true; });
  await page.click('[data-tab=dash]'); await page.waitForFunction(() => document.querySelectorAll('#panel h3').length === 2 && document.querySelector('#panel .err').textContent.length > 0);
  assert.deepEqual(await page.$$eval('#panel .card .empty', (e) => e.map((x) => !x.hidden)), [true, true]);
  assert.equal(await page.locator('#panel canvas').count(), 0);
  await page.evaluate(() => { window.__chartThrow = false; }); });
await check('no uncaught page errors', async () => { assert.deepEqual(errors, [], JSON.stringify(errors)); });
console.log(results.join('\n'));
await browser.close(); server.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
