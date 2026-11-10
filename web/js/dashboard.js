import { supabase } from './supabaseClient.js';
import { friendlyError } from './errors.js';
import { pivot, sumBy, countDistinctBy } from './helpers.js';
import { chartsFor } from './roleUi.js';

const PALETTE = ['#0f6b5e', '#9a5d0c', '#2f5d9e', '#74467f', '#6c7a86', '#b4232f'];   // same zone colours as css/app.css
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload = ok; s.onerror = () => fail(new Error('chart.js failed to load')); document.head.appendChild(s);
  });
}
function card(el, title) {
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h3></h3><div class="empty" hidden>ไม่พบข้อมูล</div><canvas></canvas>`; c.querySelector('h3').textContent = title;
  el.appendChild(c); return c;
}
function draw(c, config, hasData) {
  if (!hasData) { c.querySelector('.empty').hidden = false; c.querySelector('canvas').remove(); return; }
  new window.Chart(c.querySelector('canvas'), config);
}
const datasets = (p, type) => Object.entries(p.series).map(([name, data], i) => ({ label: name, data, backgroundColor: PALETTE[i % PALETTE.length], borderColor: PALETTE[i % PALETTE.length], type }));

// One builder per chart id (ids from roleUi.js chartsFor). Each makes its card, queries, and draws; a failing query shows
// its error in the shared message line and the card's "ไม่พบข้อมูล", so the other charts still draw.
const byMonth = (x, y) => String(x.month).localeCompare(String(y.month));
async function query(msg, q) {
  const r = await q;
  if (r.error) { msg.textContent = friendlyError(r.error); return []; }
  return r.data || [];
}
const CHARTS = {
  // D1: bookings per doctor per status  (analysis Q17)
  async workload(grid, msg) {
    const c = card(grid, 'D1 จำนวนการจองต่อแพทย์ แยกตามสถานะ');
    const rows = await query(msg, supabase.from('v_doctor_workload').select('doctor_name,status,booking_count'));
    const p = pivot(rows, 'doctor_name', 'status', 'booking_count');
    draw(c, { type: 'bar', data: { labels: p.labels, datasets: datasets(p, 'bar') }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } }, rows.length > 0);
  },
  // D2: monthly billing per department  (analysis Q18)
  async billing(grid, msg) {
    const c = card(grid, 'D2 ค่ารักษารายเดือน แยกตามแผนก (บาท)');
    const rows = await query(msg, supabase.from('v_visit_billing').select('department,month,total_amount'));
    const p = pivot(sumBy(rows, ['department', 'month'], 'total_amount').sort(byMonth), 'month', 'department', 'total');   // months in calendar order
    draw(c, { type: 'bar', data: { labels: p.labels, datasets: datasets(p, 'bar') } }, rows.length > 0);
  },
  // D3: drugs below reorder point  (analysis Q19)
  async lowStock(grid, msg) {
    const c = card(grid, 'D3 ยาที่ต่ำกว่าจุดสั่งซื้อ');
    const rows = await query(msg, supabase.from('v_inventory_stock_status').select('generic_name,lot_number,quantity_on_hand,reorder_point').eq('stock_status', 'REORDER_URGENT').order('quantity_on_hand'));
    draw(c, { type: 'bar', data: { labels: rows.map((r) => `${r.generic_name} (${r.lot_number})`),
      datasets: [{ label: 'คงเหลือ', data: rows.map((r) => r.quantity_on_hand), backgroundColor: PALETTE[0] }, { label: 'จุดสั่งซื้อ', data: rows.map((r) => r.reorder_point), backgroundColor: PALETTE[1] }] },
      options: { indexAxis: 'y' } }, rows.length > 0);
  },
  // D4: beds in use and free per department
  async beds(grid, msg) {
    const c = card(grid, 'D4 เตียงที่ใช้อยู่และว่าง แยกตามแผนก');
    const rows = (await query(msg, supabase.from('v_bed_occupancy').select('department,occupied_beds,available_beds')))
      .map((r) => ({ ...r, department: r.department ?? 'ไม่ระบุแผนก' }));
    const used = sumBy(rows, ['department'], 'occupied_beds'), free = sumBy(rows, ['department'], 'available_beds');   // same first-seen order
    draw(c, { type: 'bar', data: { labels: used.map((r) => r.department),
      datasets: [{ label: 'ใช้อยู่', data: used.map((r) => r.total), backgroundColor: PALETTE[0] }, { label: 'ว่าง', data: free.map((r) => r.total), backgroundColor: PALETTE[4] }] },
      options: { scales: { x: { stacked: true }, y: { stacked: true } } } }, rows.length > 0);
  },
  // D5: prescriptions waiting for pharmacist screening, per status (the view has one row per item, so count prescriptions)
  async screening(grid, msg) {
    const c = card(grid, 'D5 ใบสั่งยารอคัดกรอง แยกตามสถานะ');
    const rows = await query(msg, supabase.from('v_pharmacist_screening_queue').select('prescription_id,prescription_status'));
    const g = countDistinctBy(rows, 'prescription_status', 'prescription_id');
    draw(c, { type: 'bar', data: { labels: g.map((r) => r.key), datasets: [{ label: 'ใบสั่งยา', data: g.map((r) => r.count), backgroundColor: PALETTE[2] }] } }, rows.length > 0);
  },
  // patient: own monthly charges (RLS returns only this patient's rows of v_visit_billing)
  async myBilling(grid, msg) {
    const c = card(grid, 'ค่ารักษาของฉันรายเดือน (บาท)');
    const rows = await query(msg, supabase.from('v_visit_billing').select('month,total_amount'));
    const m = sumBy(rows, ['month'], 'total_amount').sort(byMonth);
    draw(c, { type: 'bar', data: { labels: m.map((r) => r.month), datasets: [{ label: 'ค่ารักษา', data: m.map((r) => r.total), backgroundColor: PALETTE[0] }] } }, rows.length > 0);
  },
};

export async function mountDashboard(el, access = {}) {
  await loadChartJs();
  const msg = document.createElement('div'); msg.className = 'err'; msg.setAttribute('role', 'alert'); el.appendChild(msg);
  const grid = document.createElement('div'); grid.className = 'charts'; el.appendChild(grid);
  for (const id of chartsFor(access.role)) {
    try { await CHARTS[id](grid, msg); } catch (e) { msg.textContent = friendlyError(e); console.error(e); }
  }
}
