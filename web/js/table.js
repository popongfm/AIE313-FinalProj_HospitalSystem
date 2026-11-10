import { tableModel } from './helpers.js';
export function renderTable(rows, extraHeader = null, extraCell = null) {
  const wrap = document.createElement('div');
  const m = tableModel(rows);
  if (!m) { wrap.className = 'empty'; wrap.textContent = 'ไม่พบข้อมูล'; return wrap; }
  wrap.className = 'tablewrap';
  const table = document.createElement('table');
  if (extraHeader) table.className = 'has-actions';   // keeps the edit/delete column in view (css/app.css)
  const head = table.createTHead().insertRow();
  m.columns.forEach((c) => { const th = document.createElement('th'); th.textContent = c; head.appendChild(th); });
  if (extraHeader) { const th = document.createElement('th'); th.textContent = extraHeader; head.appendChild(th); }
  const body = table.createTBody();
  m.rows.forEach((r, i) => {
    const tr = body.insertRow();
    r.forEach((v) => { tr.insertCell().textContent = v; });   // textContent: never innerHTML (no XSS from data)
    if (extraCell) tr.insertCell().appendChild(extraCell(rows[i]));
  });
  wrap.appendChild(table);
  return wrap;
}
