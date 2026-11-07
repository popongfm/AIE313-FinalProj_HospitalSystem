import { supabase } from './supabaseClient.js';
import { friendlyError } from './errors.js';
import { pivot, sumBy } from './helpers.js';

const PALETTE = ['#0a7d6b', '#e08a1e', '#3b6fd4', '#b8479b', '#7a8b99', '#c0392b'];
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

export async function mountDashboard(el) {
  await loadChartJs();
  const msg = document.createElement('div'); msg.className = 'err'; el.appendChild(msg);
  const grid = document.createElement('div'); grid.className = 'charts'; el.appendChild(grid);

  // D1: bookings per doctor per status  (analysis Q17)
  const d1 = card(grid, 'D1 จำนวนการจองต่อแพทย์ แยกตามสถานะ');
  const r1 = await supabase.from('v_doctor_workload').select('doctor_name,status,booking_count');
  if (r1.error) msg.textContent = friendlyError(r1.error);
  const p1 = pivot(r1.data || [], 'doctor_name', 'status', 'booking_count');
  draw(d1, { type: 'bar', data: { labels: p1.labels, datasets: datasets(p1, 'bar') }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } }, (r1.data || []).length > 0);

  // D2: monthly billing per department  (analysis Q18)
  const d2 = card(grid, 'D2 ค่ารักษารายเดือน แยกตามแผนก (บาท)');
  const r2 = await supabase.from('v_visit_billing').select('department,month,total_amount');
  if (r2.error) msg.textContent = friendlyError(r2.error);
  const p2 = pivot(sumBy(r2.data || [], ['department', 'month'], 'total_amount'), 'month', 'department', 'total');
  draw(d2, { type: 'bar', data: { labels: p2.labels, datasets: datasets(p2, 'bar') } }, (r2.data || []).length > 0);

  // D3: drugs below reorder point  (analysis Q19)
  const d3 = card(grid, 'D3 ยาที่ต่ำกว่าจุดสั่งซื้อ');
  const r3 = await supabase.from('v_inventory_stock_status').select('generic_name,lot_number,quantity_on_hand,reorder_point').eq('stock_status', 'REORDER_URGENT').order('quantity_on_hand');
  if (r3.error) msg.textContent = friendlyError(r3.error);
  const rows3 = r3.data || [];
  draw(d3, { type: 'bar', data: { labels: rows3.map((r) => `${r.generic_name} (${r.lot_number})`),
    datasets: [{ label: 'คงเหลือ', data: rows3.map((r) => r.quantity_on_hand), backgroundColor: PALETTE[0] }, { label: 'จุดสั่งซื้อ', data: rows3.map((r) => r.reorder_point), backgroundColor: PALETTE[1] }] },
    options: { indexAxis: 'y' } }, rows3.length > 0);
}
