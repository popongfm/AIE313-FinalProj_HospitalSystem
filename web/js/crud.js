import { supabase } from './supabaseClient.js';
import { friendlyError } from './errors.js';
import { coerceRow } from './helpers.js';
import { TABLES } from './tables.js';
import { renderTable } from './table.js';

export async function mountCrudPage(el) {
  el.innerHTML = '<div class="card"><div class="row"><label for="t">ตาราง</label><select id="t"></select><button class="primary" id="new">+ เพิ่มข้อมูล</button></div>'
    + '<div id="err" class="err" role="alert"></div><form id="form" hidden class="card"></form><div id="list"></div></div>';
  const sel = el.querySelector('#t'), form = el.querySelector('#form'), list = el.querySelector('#list'), err = el.querySelector('#err');
  Object.entries(TABLES).forEach(([k, c]) => sel.add(new Option(`${c.label} (${k})`, k)));
  let editing = null;   // row being edited, or null for insert

  function field(c, value) {
    const wrap = document.createElement('div');
    const label = document.createElement('label'); label.textContent = c.label + (c.required ? ' *' : ''); label.htmlFor = 'f_' + c.name;
    let input;
    if (c.type === 'select') { input = document.createElement('select'); input.add(new Option('', '')); c.options.forEach((o) => input.add(new Option(o, o))); }
    else { input = document.createElement('input'); input.type = c.type === 'number' ? 'number' : c.type; if (c.type === 'number') input.step = 'any'; }
    input.id = 'f_' + c.name; input.name = c.name;
    if (value != null) input.value = c.type === 'datetime-local' ? String(value).slice(0, 16) : value;
    wrap.append(label, input); return wrap;
  }
  function openForm(row) {
    editing = row; const cfg = TABLES[sel.value];
    form.innerHTML = ''; form.hidden = false;
    cfg.cols.forEach((c) => form.appendChild(field(c, row ? row[c.name] : null)));
    const ok = document.createElement('button'); ok.className = 'primary'; ok.type = 'submit'; ok.textContent = row ? 'บันทึกการแก้ไข' : 'เพิ่ม';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'ยกเลิก'; cancel.onclick = () => { form.hidden = true; };
    const r = document.createElement('div'); r.className = 'row'; r.append(ok, cancel); form.appendChild(r);
  }
  async function load(keepError = false) {
    if (!keepError) err.textContent = ''; const cfg = TABLES[sel.value];
    list.textContent = 'กำลังโหลด...';
    const { data, error } = await supabase.from(sel.value).select('*').order(cfg.pk, { ascending: false }).limit(100);
    list.textContent = '';
    if (error) { err.textContent = friendlyError(error); return; }
    list.appendChild(renderTable(data, 'จัดการ', (row) => {
      const box = document.createElement('div'); box.className = 'row';
      const edit = document.createElement('button'); edit.textContent = 'แก้ไข'; edit.onclick = () => openForm(row);
      const del = document.createElement('button'); del.textContent = 'ลบ';
      del.onclick = () => {                        // two-step delete, no browser dialog
        if (del.dataset.armed) return remove(row);
        del.dataset.armed = '1'; del.textContent = 'ยืนยันลบ?'; setTimeout(() => { del.dataset.armed = ''; del.textContent = 'ลบ'; }, 4000);
      };
      box.append(edit, del); return box;
    }));
  }
  async function remove(row) {
    const cfg = TABLES[sel.value];
    const { error } = await supabase.from(sel.value).delete().eq(cfg.pk, row[cfg.pk]);
    err.textContent = error ? friendlyError(error) : ''; await load(true);   // keep the message across the reload
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const cfg = TABLES[sel.value];
    const { row, missing } = coerceRow(cfg, Object.fromEntries(new FormData(form)));
    if (missing.length) { err.textContent = 'กรุณากรอกให้ถูกต้อง: ' + missing.map((m) => cfg.cols.find((c) => c.name === m).label).join(', '); return; }
    const q = editing ? supabase.from(sel.value).update(row).eq(cfg.pk, editing[cfg.pk]) : supabase.from(sel.value).insert(row);
    const { error } = await q;
    if (error) { err.textContent = friendlyError(error); return; }
    form.hidden = true; err.textContent = ''; await load();
  });
  sel.addEventListener('change', () => { form.hidden = true; load(); });
  el.querySelector('#new').addEventListener('click', () => openForm(null));
  await load();
}
