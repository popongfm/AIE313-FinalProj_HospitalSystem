import { supabase } from './supabaseClient.js';
import { friendlyError } from './errors.js';
import { coerceRow, bangkokDate, toDatetimeLocal } from './helpers.js';
import { TABLES, PATIENT_TABLES } from './tables.js';
import { renderTable } from './table.js';

// Option lists loaded from the database for 'select' fields with a `source` (patients cannot read staff directly).
const SOURCES = {
  doctors: async () => {
    const { data, error } = await supabase.rpc('doctor_directory');
    if (error) throw error;
    return (data || []).map((d) => ({ value: String(d.staff_id), label: d.department ? `${d.doctor_name} (${d.department})` : d.doctor_name }));
  },
};
const CANCELLABLE = ['pending', 'confirmed'];

export async function mountCrudPage(el, access = {}) {
  const tables = access.patient ? PATIENT_TABLES : TABLES;
  el.innerHTML = '<div class="card"><div class="row"><label for="t">ตาราง</label><select id="t"></select><button class="primary" id="new">+ เพิ่มข้อมูล</button></div>'
    + '<div id="err" class="err" role="alert"></div><form id="form" hidden class="card"></form><div id="list"></div></div>';
  const sel = el.querySelector('#t'), form = el.querySelector('#form'), list = el.querySelector('#list'), err = el.querySelector('#err');
  const newBtn = el.querySelector('#new');
  Object.entries(tables).forEach(([k, c]) => sel.add(new Option(`${c.label} (${k})`, k)));
  let editing = null;   // row being edited, or null for insert
  const options = {};   // source name -> [{ value, label }], loaded once
  const can = (cfg, what) => !cfg.readOnly && cfg[what] !== false;

  async function loadSources(cfg) {
    for (const c of cfg.cols) if (c.source && !options[c.source]) options[c.source] = await SOURCES[c.source]();
  }
  function field(c, value) {
    const wrap = document.createElement('div');
    const label = document.createElement('label'); label.htmlFor = 'f_' + c.name;
    label.textContent = c.label + (c.type === 'time' || c.type === 'datetime-local' ? ' (เวลาไทย GMT+7)' : '') + (c.required ? ' *' : '');
    let input;
    if (c.type === 'select') {
      input = document.createElement('select'); input.add(new Option('', ''));
      (c.source ? options[c.source] : c.options).forEach((o) => input.add(typeof o === 'string' ? new Option(o, o) : new Option(o.label, o.value)));
    } else { input = document.createElement('input'); input.type = c.type === 'number' ? 'number' : c.type; if (c.type === 'number') input.step = 'any'; }
    if (c.minToday) input.min = bangkokDate();   // today in Thailand, not in the browser's time zone
    input.id = 'f_' + c.name; input.name = c.name;
    if (value != null) input.value = c.type === 'datetime-local' ? toDatetimeLocal(value) : value;
    wrap.append(label, input); return wrap;
  }
  async function openForm(row) {
    editing = row; const cfg = tables[sel.value];
    try { await loadSources(cfg); } catch (e) { err.textContent = friendlyError(e); return; }
    form.innerHTML = ''; form.hidden = false;
    cfg.cols.forEach((c) => form.appendChild(field(c, row ? row[c.name] : null)));
    const ok = document.createElement('button'); ok.className = 'primary'; ok.type = 'submit'; ok.textContent = row ? 'บันทึกการแก้ไข' : 'เพิ่ม';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'ยกเลิก'; cancel.onclick = () => { form.hidden = true; };
    const r = document.createElement('div'); r.className = 'row'; r.append(ok, cancel); form.appendChild(r);
  }
  // show a source's label next to its id column (e.g. the doctor's name next to staff_id)
  function withLabels(cfg, rows) {
    const named = cfg.cols.filter((c) => c.source && options[c.source]);
    if (!named.length) return rows;
    return rows.map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = v;
        const c = named.find((n) => n.name === k);
        if (c) out[c.label] = (options[c.source].find((o) => o.value === String(v)) || {}).label || '';
      }
      return out;
    });
  }
  // two-step button (no browser dialog): first click arms it, second click runs it
  function twoStep(text, confirmText, run) {
    const b = document.createElement('button'); b.textContent = text;
    b.onclick = () => {
      if (b.dataset.armed) return run();
      b.dataset.armed = '1'; b.textContent = confirmText; setTimeout(() => { b.dataset.armed = ''; b.textContent = text; }, 4000);
    };
    return b;
  }
  async function load(keepError = false) {
    if (!keepError) err.textContent = ''; const cfg = tables[sel.value];
    newBtn.hidden = !can(cfg, 'insert'); newBtn.textContent = cfg.addLabel || '+ เพิ่มข้อมูล';
    list.textContent = 'กำลังโหลด...';
    const { data, error } = await supabase.from(sel.value).select('*').order(cfg.pk, { ascending: false }).limit(100);
    list.textContent = '';
    if (error) { err.textContent = friendlyError(error); return; }
    try { await loadSources(cfg); } catch { /* names are a convenience: show the ids alone */ }
    const rows = withLabels(cfg, data);
    const actions = (row) => {
      const box = document.createElement('div'); box.className = 'row';
      if (can(cfg, 'edit')) { const edit = document.createElement('button'); edit.textContent = 'แก้ไข'; edit.onclick = () => openForm(row); box.append(edit); }
      if (can(cfg, 'remove')) box.append(twoStep('ลบ', 'ยืนยันลบ?', () => remove(row)));
      if (cfg.cancel && CANCELLABLE.includes(row.status)) box.append(twoStep('ยกเลิกคิว', 'ยืนยันยกเลิก?', () => cancelBooking(row)));
      return box;
    };
    const hasActions = can(cfg, 'edit') || can(cfg, 'remove') || cfg.cancel;
    list.appendChild(hasActions ? renderTable(rows, 'จัดการ', (r) => actions(data[rows.indexOf(r)])) : renderTable(rows));
  }
  async function remove(row) {
    const cfg = tables[sel.value];
    const { error } = await supabase.from(sel.value).delete().eq(cfg.pk, row[cfg.pk]);
    err.textContent = error ? friendlyError(error) : ''; await load(true);   // keep the message across the reload
  }
  async function cancelBooking(row) {
    const cfg = tables[sel.value];
    const { error } = await supabase.from(sel.value).update({ status: 'cancelled' }).eq(cfg.pk, row[cfg.pk]);
    err.textContent = error ? friendlyError(error) : ''; await load(true);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const cfg = tables[sel.value];
    const { row, missing } = coerceRow(cfg, Object.fromEntries(new FormData(form)));
    if (missing.length) { err.textContent = 'กรุณากรอกให้ถูกต้อง: ' + missing.map((m) => cfg.cols.find((c) => c.name === m).label).join(', '); return; }
    const q = editing ? supabase.from(sel.value).update(row).eq(cfg.pk, editing[cfg.pk]) : supabase.from(sel.value).insert(row);
    const { error } = await q;
    if (error) { err.textContent = friendlyError(error); return; }
    form.hidden = true; err.textContent = ''; await load();
  });
  sel.addEventListener('change', () => { form.hidden = true; load(); });
  newBtn.addEventListener('click', () => openForm(null));
  await load();
}
