import { supabase } from './supabaseClient.js';
import { friendlyError } from './errors.js';
import { renderTable, withToolbar } from './table.js';
import { VIEWS, VIEW_LABELS, ZONES, zoneFor } from './zones.js';
import { skeleton, zoneSign, updateZoneSign } from './ui.js';
export { VIEWS };

export async function mountViewsPage(el) {
  el.innerHTML = '<div class="card"><div class="row picker"><label for="v">รายงาน</label><select id="v"></select></div><div id="err" class="err" role="alert"></div><div id="out"></div></div>';
  const sel = el.querySelector('#v'), out = el.querySelector('#out'), err = el.querySelector('#err');
  // one option group per department, in the order of the zones
  for (const zone of Object.values(ZONES)) {
    const views = VIEWS.filter((v) => zoneFor(v) === zone);
    if (!views.length) continue;
    const g = document.createElement('optgroup'); g.label = zone.label;
    views.forEach((v) => g.appendChild(new Option(`${VIEW_LABELS[v]} (${v})`, v)));
    sel.appendChild(g);
  }
  const sign = zoneSign(zoneFor(sel.value), VIEW_LABELS[sel.value]);
  el.prepend(sign);
  async function load() {
    updateZoneSign(sign, zoneFor(sel.value), VIEW_LABELS[sel.value]);
    err.textContent = ''; out.replaceChildren(skeleton());
    const { data, error } = await supabase.from(sel.value).select('*').limit(200);
    out.textContent = '';
    if (error) { err.textContent = friendlyError(error); return; }
    out.appendChild(withToolbar(renderTable(data)));
  }
  sel.addEventListener('change', load);
  await load();
}
