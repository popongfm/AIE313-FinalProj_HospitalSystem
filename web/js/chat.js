import { supabase } from './supabaseClient.js';
import { renderTable } from './table.js';

const history = [];   // survives tab switches within the page session
const EXAMPLES = ['แพทย์คนไหนมีคิวจองมากที่สุด', 'ค่ารักษารวมแยกตามแผนก', 'ยาอะไรต้องสั่งซื้อเพิ่ม', 'วันนี้มีคิวนัดอะไรบ้าง'];

function bubble(entry) {
  const div = document.createElement('div');
  div.className = 'msg ' + (entry.role === 'user' ? 'user' : 'bot');
  if (entry.role === 'user') { div.textContent = entry.text; return div; }
  if (entry.pending) { div.textContent = 'กำลังประมวลผล…'; return div; }
  if (entry.error) { const e = document.createElement('div'); e.className = 'err'; e.textContent = entry.error; div.appendChild(e); }
  if (entry.answer) { const p = document.createElement('div'); p.textContent = entry.answer; div.appendChild(p); }
  if (entry.sql) {                                   // evidence: the SQL that was (or would have been) run
    const d = document.createElement('details'); const s = document.createElement('summary'); s.textContent = 'SQL ที่ใช้';
    const pre = document.createElement('pre'); pre.textContent = entry.sql; d.append(s, pre); div.appendChild(d);
  }
  if (!entry.error && entry.answer && entry.rows && entry.rows.length) div.appendChild(renderTable(entry.rows));   // raw data
  return div;
}

export async function mountChat(el) {
  el.innerHTML = '<div class="card"><div id="log" aria-live="polite"></div>'
    + '<form id="chatform" class="row"><input id="q" maxlength="500" placeholder="พิมพ์คำถามเป็นภาษาไทยหรืออังกฤษ" style="flex:1;min-width:220px" autocomplete="off">'
    + '<button class="primary" id="send" type="submit">ส่ง</button></form><div id="ex" class="row"></div></div>';
  const log = el.querySelector('#log'), input = el.querySelector('#q'), send = el.querySelector('#send');
  const render = () => { log.replaceChildren(...history.map(bubble)); log.lastElementChild?.scrollIntoView({ block: 'nearest' }); };
  EXAMPLES.forEach((t) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = () => { input.value = t; input.focus(); }; el.querySelector('#ex').appendChild(b); });

  el.querySelector('#chatform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim(); if (!question) return;
    input.value = ''; send.disabled = input.disabled = true;
    history.push({ role: 'user', text: question }); const pending = { role: 'bot', pending: true }; history.push(pending); render();
    let entry;
    try {
      const { data, error } = await supabase.functions.invoke(window.APP_CONFIG?.CHAT_FUNCTION || 'chat-mcp', { body: { question } });
      entry = error || !data ? { role: 'bot', error: 'เชื่อมต่อระบบ Chat ไม่ได้ กรุณาลองใหม่อีกครั้ง' } : { role: 'bot', ...data, error: data.error };
    } catch { entry = { role: 'bot', error: 'เชื่อมต่อระบบ Chat ไม่ได้ กรุณาลองใหม่อีกครั้ง' }; }
    history[history.indexOf(pending)] = entry;
    send.disabled = input.disabled = false; render(); input.focus();
  });
  render();
}
