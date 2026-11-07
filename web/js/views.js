import { supabase } from './supabaseClient.js';
import { friendlyError } from './errors.js';
import { renderTable } from './table.js';
export const VIEWS = ['v_booking_queue_today', 'v_doctor_workload', 'v_feedback_summary', 'v_bed_occupancy', 'v_visit_billing',
  'v_top_diagnosis', 'v_pharmacist_screening_queue', 'v_inventory_stock_status', 'v_drug_cost_summary'];

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
