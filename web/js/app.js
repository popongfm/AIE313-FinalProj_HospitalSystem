import { requireSession, signOut, hasAccess } from './auth.js';
const mounts = {
  data:  async (el) => (await import('./crud.js')).mountCrudPage(el),
  views: async (el) => (await import('./views.js')).mountViewsPage(el),
  dash:  async (el) => (await import('./dashboard.js')).mountDashboard(el),
  chat:  async (el) => (await import('./chat.js')).mountChat(el),
};
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
  panel.innerHTML = '';
  try { await mounts[tab](panel); } catch (e) { panel.innerHTML = '<div class="card err">โหลดหน้านี้ไม่สำเร็จ</div>'; console.error(e); }
}
document.getElementById('nav').addEventListener('click', (e) => { if (e.target.dataset.tab) show(e.target.dataset.tab); });
document.getElementById('logout').addEventListener('click', async () => { await signOut(); location.href = 'index.html'; });
show('data');
}
const session = await requireSession();
if (session) init(session);
