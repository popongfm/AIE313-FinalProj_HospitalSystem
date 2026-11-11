import { supabase } from './supabaseClient.js';
import { friendlyError } from './errors.js';
import { renderTable } from './table.js';
import { VIEWS } from './zones.js';
export { VIEWS };

export async function mountViewsPage(el) {
  el.innerHTML = '<div class="card"><div class="row"><label for="v">เลือก View</label><select id="v"></select></div><div id="err" class="err" role="alert"></div><div id="out"></div></div>';
  const sel = el.querySelector('#v'), out = el.querySelector('#out'), err = el.querySelector('#err');
  VIEWS.forEach((v) => sel.add(new Option(v, v)));
  async function load() {
    err.textContent = ''; out.textContent = 'กำลังโหลด...';
    const { data, error } = await supabase.from(sel.value).select('*').limit(200);
    out.textContent = '';
    if (error) { err.textContent = friendlyError(error); return; }
    out.appendChild(renderTable(data));
  }
  sel.addEventListener('change', load);
  await load();
}
