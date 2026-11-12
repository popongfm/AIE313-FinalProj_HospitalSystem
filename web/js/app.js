import { requireSession, signOut, getAccess } from './auth.js';
import { tabsFor, roleLabel } from './roleUi.js';
import { icon } from './icons.js';
import { mountClock } from './clock.js';

mountClock(document.getElementById('tz-clock'));   // the app's time zone: Thailand, Asia/Bangkok (GMT+7)
// --appbar-h = the app bar's height, so the edit drawer opens below it and the tabs stay usable
const bar = document.querySelector('.app-bar');
const syncBar = () => document.documentElement.style.setProperty('--appbar-h', bar.offsetHeight + 'px');
syncBar(); if (window.ResizeObserver) new ResizeObserver(syncBar).observe(bar);
const mounts = {
  data:  async (el, access) => (await import('./crud.js')).mountCrudPage(el, access),
  views: async (el) => (await import('./views.js')).mountViewsPage(el),
  dash:  async (el, access) => (await import('./dashboard.js')).mountDashboard(el, access),
  chat:  async (el) => (await import('./chat.js')).mountChat(el),
};
const HEADINGS = {
  data:  ['ข้อมูลในระบบ', 'เพิ่ม แก้ไข และลบข้อมูลผู้ป่วย การจองคิว การเข้ารับบริการ ใบสั่งยา ยา และสต็อกยา'],
  views: ['รายงาน', 'รายงาน 10 ชุดจากฐานข้อมูล ไม่แสดงเลขบัตรประชาชน เบอร์โทร หรืออีเมลของผู้ป่วย'],
  dash:  ['Dashboard', 'กราฟตามหน้าที่ของบัญชีนี้ ผู้ดูแลระบบเห็นทุกกราฟ'],
  chat:  ['ผู้ช่วย AI', 'ถามเป็นภาษาไทยหรืออังกฤษ ทุกคำตอบแสดง SQL และตารางข้อมูลที่ใช้'],
};
// patient accounts see only their own records (RLS) and have no reports tab; the headings say so
const PATIENT_HEADINGS = {
  data:  ['ข้อมูลของฉัน', 'ดูประวัติการรักษาและใบสั่งยาของคุณ จองหรือยกเลิกคิว และแก้เบอร์โทร อีเมล ที่อยู่'],
  dash:  ['ภาพรวมของฉัน', 'ค่ารักษารายเดือนของคุณ'],
  chat:  ['ผู้ช่วย AI', 'ถามเกี่ยวกับคิว นัดหมาย ค่ารักษา หรือใบสั่งยาของคุณ คำตอบมาจากข้อมูลของคุณเท่านั้น'],
};
// app.html#chat etc. opens that tab; the landing page's shortcuts link here, and the tab survives the sign-in detour.
const NEXT_KEY = 'aie313.nextTab';
// own keys only: mounts['constructor'] / ['toString'] come from Object.prototype and would break show()
const wanted = Object.hasOwn(mounts, location.hash.slice(1)) ? location.hash.slice(1) : '';
const store = (fn) => { try { fn(sessionStorage); } catch { /* storage blocked: just open the default tab */ } };

async function init(session) {
const panel = document.getElementById('panel');
const access = await getAccess(session);
if (!access.linked) {
  const note = document.createElement('div');
  note.id = 'pending'; note.className = 'card err'; note.setAttribute('role', 'alert');
  note.textContent = 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลเจ้าหน้าที่ จึงยังไม่เห็นข้อมูล กรุณาให้ผู้ดูแลระบบเพิ่มอีเมลของคุณในข้อมูลเจ้าหน้าที่ แล้วเข้าสู่ระบบใหม่';
  panel.before(note);
}
// tabs this account may open (patients: no reports); the others are hidden and ignored, also when asked for by #hash
const chip = document.getElementById('role-chip');
chip.replaceChildren(icon('user'), document.createTextNode(roleLabel(access))); chip.hidden = false;
const tabs = tabsFor(access);
document.querySelectorAll('#nav button').forEach((b) => { b.hidden = !tabs.includes(b.dataset.tab); });
async function show(tab) {
  if (!tabs.includes(tab)) return;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const [title, desc] = (access.patient && PATIENT_HEADINGS[tab]) || HEADINGS[tab];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-desc').textContent = desc;
  // each visit gets its own container: a tab still loading when the user switches away fills a detached node, not the new tab
  const host = document.createElement('div');
  panel.replaceChildren(host);
  try { await mounts[tab](host, access); } catch (e) { host.innerHTML = '<div class="card err">โหลดหน้านี้ไม่สำเร็จ</div>'; console.error(e); }
}
document.getElementById('nav').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]')?.dataset.tab;   // the click may land on the icon inside the button
  if (!tab || !tabs.includes(tab)) return;   // a hidden tab: leave the URL and the page as they are
  history.replaceState(null, '', '#' + tab);   // a reload keeps the current tab
  show(tab);
});
document.getElementById('logout').addEventListener('click', async () => { await signOut(); location.href = 'index.html'; });
show(tabs.includes(wanted) ? wanted : 'data');
}
if (wanted) store((s) => s.setItem(NEXT_KEY, wanted));   // used by index.html if we get sent to sign in
const session = await requireSession();
if (session) { store((s) => s.removeItem(NEXT_KEY)); init(session); }
