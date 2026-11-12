import { supabase } from './supabaseClient.js';
import { friendlyError } from './errors.js';
import { coerceRow, bangkokDate, toDatetimeLocal } from './helpers.js';
import { TABLES, PATIENT_TABLES } from './tables.js';
import { renderTable, withToolbar } from './table.js';
import { zoneFor } from './zones.js';
import { button, setLabel, toast, skeleton, zoneSign, updateZoneSign } from './ui.js';

// Option lists loaded from the database for 'select' fields with a `source` (patients cannot read staff directly).
const SOURCES = {
  doctors: async () => {
    const { data, error } = await supabase.rpc('doctor_directory');
    if (error) throw error;
    return (data || []).map((d) => ({ value: String(d.staff_id), label: d.department ? `${d.doctor_name} (${d.department})` : d.doctor_name }));
  },
};
const CANCELLABLE = ['pending', 'confirmed'];
const ADD = '+ เพิ่มข้อมูล';

export async function mountCrudPage(el, access = {}) {
  const tables = access.patient ? PATIENT_TABLES : TABLES;
  el.innerHTML = '<div class="card"><div class="row picker"><label for="t">ตาราง</label><select id="t"></select>'
    + '<button class="primary" id="new" type="button"></button></div>'
    + '<div id="err" class="err" role="alert"></div><div id="list"></div></div>'
    + '<div class="drawer-backdrop" hidden></div>'
    + '<form id="form" class="drawer" hidden role="dialog" aria-modal="true" aria-labelledby="form-title" novalidate>'
    + '<div class="drawer-head"><h2 id="form-title"></h2></div><div class="drawer-body"></div>'
    + '<div id="form-err" class="err drawer-err" role="alert"></div><div class="drawer-foot"></div></form>';
  const sel = el.querySelector('#t'), form = el.querySelector('#form'), list = el.querySelector('#list'), err = el.querySelector('#err');
  const backdrop = el.querySelector('.drawer-backdrop'), body = form.querySelector('.drawer-body'), foot = form.querySelector('.drawer-foot');
  const formErr = el.querySelector('#form-err'), title = el.querySelector('#form-title'), newBtn = el.querySelector('#new');
  const close = button('', { icon: 'close', variant: 'ghost' }); close.className = 'ghost drawer-close'; close.setAttribute('aria-label', 'ปิด');
  close.querySelector('.label').remove();
  form.querySelector('.drawer-head').appendChild(close);
  Object.entries(tables).forEach(([k, c]) => sel.add(new Option(`${c.label} (${k})`, k)));
  const sign = zoneSign(zoneFor(sel.value), tables[sel.value].label);
  el.prepend(sign);
  let editing = null;   // row being edited, or null for insert
  let opener = null;    // the button that opened the drawer gets focus back when it closes
  let openId = 0;       // each opening of the drawer gets a number; a save only closes the drawer it was made from
  let savingId = -1;    // the opening whose save is still running
  const options = {};   // source name -> [{ value, label }], loaded once
  const can = (cfg, what) => !cfg.readOnly && cfg[what] !== false;
  // form errors show next to the fields, and in the page's message line (#err) as before
  const showError = (text) => { err.textContent = text; formErr.textContent = form.hidden ? '' : text; };

  async function loadSources(cfg) {
    for (const c of cfg.cols) if (c.source && !options[c.source]) options[c.source] = await SOURCES[c.source]();
  }
  function field(c, value) {
    const wrap = document.createElement('div'); wrap.className = 'field';
    const label = document.createElement('label'); label.htmlFor = 'f_' + c.name;
    label.textContent = c.label + (c.type === 'time' || c.type === 'datetime-local' ? ' (เวลาไทย GMT+7)' : '');
    if (c.required) { const star = document.createElement('span'); star.className = 'req'; star.textContent = ' *'; label.appendChild(star); }
    let input;
    if (c.type === 'select') {
      input = document.createElement('select'); input.add(new Option('', ''));
      (c.source ? options[c.source] : c.options).forEach((o) => input.add(typeof o === 'string' ? new Option(o, o) : new Option(o.label, o.value)));
    } else { input = document.createElement('input'); input.type = c.type === 'number' ? 'number' : c.type; if (c.type === 'number') input.step = 'any'; }
    if (c.minToday) input.min = bangkokDate();   // today in Thailand, not in the browser's time zone
    if (c.required) input.setAttribute('aria-required', 'true');
    input.id = 'f_' + c.name; input.name = c.name;
    if (value != null) input.value = c.type === 'datetime-local' ? toDatetimeLocal(value) : value;
    wrap.append(label, input); return wrap;
  }
  // while the drawer is open the page behind it is inert (keyboard and screen readers stay in the drawer; the app bar stays usable)
  const behind = () => [el.querySelector('.card'), sign];
  const onKey = (e) => { if (e.key === 'Escape' && !form.hidden) { e.preventDefault(); closeForm(); } };
  // focus back where the user was; when that button was rebuilt (the list reloaded), the add button or the table picker
  function restoreFocus() {
    if (opener && opener.isConnected) opener.focus();
    else if (!newBtn.hidden) newBtn.focus(); else sel.focus();
  }
  function closeForm() {
    if (form.hidden) return;
    form.hidden = true; backdrop.hidden = true; formErr.textContent = '';
    behind().forEach((n) => { n.inert = false; });
    document.removeEventListener('keydown', onKey);
    restoreFocus();
  }
  async function openForm(row, from) {
    editing = row; opener = from || null; openId++; const cfg = tables[sel.value];
    try { await loadSources(cfg); } catch (e) { err.textContent = friendlyError(e); return; }
    title.textContent = (row ? 'แก้ไข' : 'เพิ่ม') + cfg.label;
    body.replaceChildren(...cfg.cols.map((c) => field(c, row ? row[c.name] : null)));
    const ok = button(row ? 'บันทึกการแก้ไข' : 'บันทึก', { icon: 'check', variant: 'primary', type: 'submit' });
    const cancel = button('ยกเลิก'); cancel.onclick = closeForm;
    foot.replaceChildren(cancel, ok);
    formErr.textContent = ''; form.hidden = false; backdrop.hidden = false;
    behind().forEach((n) => { n.inert = true; });
    document.addEventListener('keydown', onKey);
    body.querySelector('input, select')?.focus();
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
  function twoStep(text, confirmText, iconName, run) {
    const b = button(text, { icon: iconName, size: 'sm', variant: 'ghost' });
    b.onclick = () => {
      if (b.dataset.armed) return run();
      b.dataset.armed = '1'; setLabel(b, confirmText); setTimeout(() => { b.dataset.armed = ''; setLabel(b, text); }, 4000);
    };
    return b;
  }
  async function load(keepError = false) {
    if (!keepError) err.textContent = ''; const cfg = tables[sel.value];
    updateZoneSign(sign, zoneFor(sel.value), cfg.label);
    newBtn.hidden = !can(cfg, 'insert'); newBtn.textContent = cfg.addLabel || ADD;
    list.replaceChildren(skeleton());
    const { data, error } = await supabase.from(sel.value).select('*').order(cfg.pk, { ascending: false }).limit(100);
    list.textContent = '';
    if (error) { err.textContent = friendlyError(error); return; }
    try { await loadSources(cfg); } catch { /* names are a convenience: show the ids alone */ }
    const rows = withLabels(cfg, data);
    const actions = (row) => {
      const box = document.createElement('div'); box.className = 'row';
      if (can(cfg, 'edit')) { const edit = button('แก้ไข', { icon: 'edit', size: 'sm' }); edit.onclick = () => openForm(row, edit); box.append(edit); }
      if (can(cfg, 'remove')) box.append(twoStep('ลบ', 'ยืนยันลบ?', 'trash', () => remove(row)));
      if (cfg.cancel && CANCELLABLE.includes(row.status)) box.append(twoStep('ยกเลิกคิว', 'ยืนยันยกเลิก?', 'x-circle', () => cancelBooking(row)));
      return box;
    };
    const hasActions = can(cfg, 'edit') || can(cfg, 'remove') || cfg.cancel;
    list.appendChild(withToolbar(hasActions ? renderTable(rows, 'จัดการ', (r) => actions(data[rows.indexOf(r)])) : renderTable(rows)));
  }
  async function remove(row) {
    const cfg = tables[sel.value];
    const { error } = await supabase.from(sel.value).delete().eq(cfg.pk, row[cfg.pk]);
    err.textContent = error ? friendlyError(error) : ''; if (!error) toast('ลบข้อมูลแล้ว');
    await load(true);   // keep the message across the reload
    if (document.activeElement === document.body) { opener = null; restoreFocus(); }
  }
  async function cancelBooking(row) {
    const cfg = tables[sel.value];
    const { error } = await supabase.from(sel.value).update({ status: 'cancelled' }).eq(cfg.pk, row[cfg.pk]);
    err.textContent = error ? friendlyError(error) : ''; if (!error) toast('ยกเลิกคิวแล้ว');
    await load(true);
    if (document.activeElement === document.body) { opener = null; restoreFocus(); }
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = openId; if (savingId === id) return;   // one save per drawer
    const cfg = tables[sel.value], table = sel.value, target = editing;
    const { row, missing } = coerceRow(cfg, Object.fromEntries(new FormData(form)));
    if (missing.length) { showError('กรุณากรอกให้ถูกต้อง: ' + missing.map((m) => cfg.cols.find((c) => c.name === m).label).join(', ')); return; }
    const submit = form.querySelector('button[type=submit]'), label = submit.querySelector('.label').textContent;
    savingId = id; submit.disabled = true; setLabel(submit, 'กำลังบันทึก…');
    const q = target ? supabase.from(table).update(row).eq(cfg.pk, target[cfg.pk]) : supabase.from(table).insert(row);
    const { error } = await q;
    if (savingId === id) savingId = -1;
    const current = id === openId && !form.hidden;   // false: the user closed this drawer (or opened another) while it saved
    if (current) { submit.disabled = false; setLabel(submit, label); }
    if (error) { if (current) showError(friendlyError(error)); else err.textContent = friendlyError(error); return; }
    toast(target ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มข้อมูลแล้ว');
    if (current) { closeForm(); err.textContent = ''; }
    if (sel.value === table) await load(true);
    if (current && document.activeElement === document.body) restoreFocus();   // the edit button that opened the drawer was rebuilt
  });
  close.addEventListener('click', closeForm);
  backdrop.addEventListener('click', closeForm);
  sel.addEventListener('change', () => { closeForm(); load(); });
  newBtn.addEventListener('click', () => openForm(null, newBtn));
  await load();
}
