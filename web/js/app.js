import { requireSession, signOut, hasAccess } from './auth.js';
const mounts = {
  data:  async (el) => (await import('./crud.js')).mountCrudPage(el),
  views: async (el) => (await import('./views.js')).mountViewsPage(el),
  dash:  async (el) => (await import('./dashboard.js')).mountDashboard(el),
  chat:  async (el) => (await import('./chat.js')).mountChat(el),
};
const HEADINGS = {
  data:  ['ข้อมูลในระบบ', 'เพิ่ม แก้ไข และลบข้อมูลผู้ป่วย การจองคิว การเข้ารับบริการ ใบสั่งยา ยา และสต็อกยา'],
  views: ['รายงาน', 'รายงาน 9 ชุดจากฐานข้อมูล ไม่แสดงเลขบัตรประชาชน เบอร์โทร หรืออีเมลของผู้ป่วย'],
  dash:  ['Dashboard', 'ภาพรวมการจองคิวของแพทย์ ค่ารักษารายเดือน และยาที่ต่ำกว่าจุดสั่งซื้อ'],
  chat:  ['ผู้ช่วย AI', 'ถามเป็นภาษาไทยหรืออังกฤษ ทุกคำตอบแสดง SQL และตารางข้อมูลที่ใช้'],
};
// app.html#chat etc. opens that tab; the landing page's shortcuts link here, and the tab survives the sign-in detour.
const NEXT_KEY = 'aie313.nextTab';
const wanted = location.hash.slice(1);
const store = (fn) => { try { fn(sessionStorage); } catch { /* storage blocked: just open the default tab */ } };

async function init(session) {
const panel = document.getElementById('panel');
if (!(await hasAccess(session))) {
  const note = document.createElement('div');
  note.id = 'pending'; note.className = 'card err'; note.setAttribute('role', 'alert');
  note.textContent = 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน จึงยังไม่เห็นข้อมูล กรุณาติดต่อผู้ดูแลระบบเพื่ออนุมัติ';
  panel.before(note);
}
async function show(tab) {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const [title, desc] = HEADINGS[tab];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-desc').textContent = desc;
  // each visit gets its own container: a tab still loading when the user switches away fills a detached node, not the new tab
  const host = document.createElement('div');
  panel.replaceChildren(host);
  try { await mounts[tab](host); } catch (e) { host.innerHTML = '<div class="card err">โหลดหน้านี้ไม่สำเร็จ</div>'; console.error(e); }
}
document.getElementById('nav').addEventListener('click', (e) => {
  const tab = e.target.dataset.tab;
  if (!tab) return;
  history.replaceState(null, '', '#' + tab);   // a reload keeps the current tab
  show(tab);
});
document.getElementById('logout').addEventListener('click', async () => { await signOut(); location.href = 'index.html'; });
show(mounts[wanted] ? wanted : 'data');
}
if (mounts[wanted]) store((s) => s.setItem(NEXT_KEY, wanted));   // used by index.html if we get sent to sign in
const session = await requireSession();
if (session) { store((s) => s.removeItem(NEXT_KEY)); init(session); }
