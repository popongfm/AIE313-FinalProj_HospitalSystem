import { requireSession, signOut } from './auth.js';
const mounts = {
  data:  async (el) => (await import('./crud.js')).mountCrudPage(el),
  views: async (el) => (await import('./views.js')).mountViewsPage(el),
  dash:  async (el) => (await import('./dashboard.js')).mountDashboard(el),
  chat:  async (el) => (await import('./chat.js')).mountChat(el),
};
async function init() {
const panel = document.getElementById('panel');
async function show(tab) {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  panel.innerHTML = '';
  try { await mounts[tab](panel); } catch (e) { panel.innerHTML = '<div class="card err">โหลดหน้านี้ไม่สำเร็จ</div>'; console.error(e); }
}
document.getElementById('nav').addEventListener('click', (e) => { if (e.target.dataset.tab) show(e.target.dataset.tab); });
document.getElementById('logout').addEventListener('click', async () => { await signOut(); location.href = 'index.html'; });
show('data');
}
if (await requireSession()) init();
