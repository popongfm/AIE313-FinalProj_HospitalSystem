import { tableModel, isStatusColumn, matchesQuery } from './helpers.js';
import { badge } from './ui.js';
import { icon } from './icons.js';

const NUMBER = /^-?\d+(\.\d+)?$/;
export function renderTable(rows, extraHeader = null, extraCell = null) {
  const wrap = document.createElement('div');
  const m = tableModel(rows);
  if (!m) { wrap.className = 'empty'; wrap.append(icon('table', 'empty-icon'), document.createTextNode('ไม่พบข้อมูล')); return wrap; }
  wrap.className = 'tablewrap';
  const table = document.createElement('table');
  if (extraHeader) table.className = 'has-actions';   // keeps the edit/delete column in view (css/app.css)
  // a column whose every filled cell is a number is right-aligned, header included
  const numeric = m.columns.map((_, j) => m.rows.some((r) => r[j] !== '') && m.rows.every((r) => r[j] === '' || NUMBER.test(r[j])));
  const head = table.createTHead().insertRow();
  m.columns.forEach((c, j) => { const th = document.createElement('th'); th.textContent = c; if (numeric[j]) th.className = 'num'; head.appendChild(th); });
  if (extraHeader) { const th = document.createElement('th'); th.textContent = extraHeader; head.appendChild(th); }
  const body = table.createTBody();
  m.rows.forEach((r, i) => {
    const tr = body.insertRow();
    r.forEach((v, j) => {
      const td = tr.insertCell();
      const b = isStatusColumn(m.columns[j]) ? badge(v) : null;   // status values as coloured badges
      if (b) td.appendChild(b); else td.textContent = v;   // textContent: never innerHTML (no XSS from data)
      if (numeric[j]) td.className = 'num';
    });
    if (extraCell) tr.insertCell().appendChild(extraCell(rows[i]));
  });
  wrap.appendChild(table);
  return wrap;
}

// search box + row count above a table. Rows are hidden, not rebuilt, so callers' row -> action mapping stays valid.
export function withToolbar(tableEl, { placeholder = 'ค้นหาในตาราง' } = {}) {
  if (!tableEl.querySelector('table')) return tableEl;   // empty state: nothing to search
  const box = document.createElement('div'); box.className = 'table-block';
  const bar = document.createElement('div'); bar.className = 'toolbar';
  const field = document.createElement('label'); field.className = 'search-field';
  const input = document.createElement('input'); input.type = 'search'; input.className = 'table-search'; input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  field.append(icon('search'), input);
  const count = document.createElement('span'); count.className = 'table-count'; count.setAttribute('aria-live', 'polite');
  bar.append(field, count);
  const rows = [...tableEl.querySelectorAll('tbody tr')];
  const cells = rows.map((tr) => [...tr.cells].map((td) => td.textContent));
  const update = () => {
    let shown = 0;
    rows.forEach((tr, i) => { const ok = matchesQuery(cells[i], input.value); tr.hidden = !ok; if (ok) shown++; });
    count.textContent = `แสดง ${shown} จาก ${rows.length} รายการ`;
  };
  input.addEventListener('input', update); update();
  box.append(bar, tableEl);
  return box;
}
