import { supabase } from './supabaseClient.js';
import { renderTable } from './table.js';

const history = [];   // survives tab switches within the page session
const EXAMPLES = ['แพทย์คนไหนมีคิวจองมากที่สุด', 'ค่ารักษารวมแยกตามแผนก', 'ยาอะไรต้องสั่งซื้อเพิ่ม', 'วันนี้มีคิวนัดอะไรบ้าง', 'ขอนัดพบแพทย์สัปดาห์หน้า'];

// The last turns of this chat, sent along so a follow-up ("พรุ่งนี้ 10 โมง") is understood. Text only; the Edge
// Function trims and caps it, and the database still checks every booking, so it never adds permissions.
export function chatHistory(entries, max = 6) {
  return entries.filter((e) => !e.pending && (e.role === 'user' ? e.text : (e.answer || e.error)))
    .map((e) => (e.role === 'user' ? { role: 'user', content: e.text } : { role: 'assistant', content: e.answer || e.error }))
    .slice(-max);
}

async function callChat(body) {
  try {
    const { data, error } = await supabase.functions.invoke(window.APP_CONFIG?.CHAT_FUNCTION || 'chat-mcp', { body });
    // 401/403 replies carry a Thai message in { error } (e.g. account not yet linked by an admin); show it instead of the generic one
    let serverMsg = null;
    if (error && error.context && typeof error.context.json === 'function') {
      try { serverMsg = (await error.context.json()).error || null; } catch { /* not JSON */ }
    }
    return error || !data ? { role: 'bot', error: serverMsg || 'เชื่อมต่อระบบ Chat ไม่ได้ กรุณาลองใหม่อีกครั้ง' } : { role: 'bot', ...data, error: data.error };
  } catch { return { role: 'bot', error: 'เชื่อมต่อระบบ Chat ไม่ได้ กรุณาลองใหม่อีกครั้ง' }; }
}

// A proposed appointment (entry.action): nothing is saved until the user presses "ยืนยันนัด".
function bookingCard(entry, onConfirm, onCancel) {
  const box = document.createElement('div'); box.className = 'booking-card';
  const r = (entry.rows && entry.rows[0]) || {};
  const line = (label, value) => { if (value == null || value === '') return; const p = document.createElement('div');
    const b = document.createElement('strong'); b.textContent = label + ': '; p.append(b, String(value)); box.appendChild(p); };
  const h = document.createElement('div'); h.className = 'booking-title'; h.textContent = 'นัดหมายที่จะบันทึก'; box.appendChild(h);
  line('ผู้ป่วย', [r.hn, r.patient_name].filter(Boolean).join(' '));
  line('แพทย์', [r.doctor_name, r.department && `(${r.department})`].filter(Boolean).join(' '));
  line('วันที่', r.booking_date); line('เวลา', r.booking_time && r.booking_time + ' น. (เวลาไทย GMT+7)'); line('คิวที่ (โดยประมาณ)', r.queue_no); line('อาการ', r.symptom);
  const row = document.createElement('div'); row.className = 'row';
  if (entry.actionState === 'done') { const s = document.createElement('div'); s.className = 'ok'; s.textContent = 'บันทึกแล้ว'; box.appendChild(s); return box; }
  if (entry.actionState === 'cancelled') { const s = document.createElement('div'); s.className = 'hint'; s.textContent = 'ยกเลิกแล้ว ไม่ได้บันทึก'; box.appendChild(s); return box; }
  const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'primary confirm-booking'; yes.textContent = entry.actionState === 'sending' ? 'กำลังบันทึก…' : 'ยืนยันนัด';
  const no = document.createElement('button'); no.type = 'button'; no.className = 'cancel-booking'; no.textContent = 'ยกเลิก';
  yes.disabled = no.disabled = entry.actionState === 'sending';
  yes.onclick = onConfirm; no.onclick = onCancel;
  row.append(yes, no); box.appendChild(row);
  return box;
}

function bubble(entry, actions) {
  const div = document.createElement('div');
  div.className = 'msg ' + (entry.role === 'user' ? 'user' : 'bot');
  if (entry.role === 'user') { div.textContent = entry.text; return div; }
  if (entry.pending) { div.textContent = 'กำลังประมวลผล…'; return div; }
  if (entry.error) { const e = document.createElement('div'); e.className = 'err'; e.textContent = entry.error; div.appendChild(e); }
  // answers are plain text (textContent, never HTML); drop Markdown bold/heading marks a model may still add
  if (entry.answer) { const p = document.createElement('div'); p.className = 'answer'; p.textContent = String(entry.answer).replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, ''); div.appendChild(p); }
  if (!entry.error && entry.action && entry.action.type === 'book_appointment') div.appendChild(bookingCard(entry, () => actions.confirm(entry), () => actions.cancel(entry)));
  if (entry.sql) {                                   // evidence: the SQL that was (or would have been) run
    const d = document.createElement('details'); const s = document.createElement('summary'); s.textContent = 'SQL ที่ใช้';
    const pre = document.createElement('pre'); pre.textContent = entry.sql; d.append(s, pre); div.appendChild(d);
  }
  if (!entry.error && !entry.action && entry.answer && entry.rows && entry.rows.length) div.appendChild(renderTable(entry.rows));   // raw data
  return div;
}

export async function mountChat(el) {
  el.innerHTML = '<div class="card"><div id="log" aria-live="polite"></div>'
    + '<form id="chatform" class="row"><input id="q" maxlength="500" placeholder="พิมพ์คำถามเป็นภาษาไทยหรืออังกฤษ" style="flex:1;min-width:220px" autocomplete="off">'
    + '<button class="primary" id="send" type="submit">ส่ง</button></form><div id="ex" class="row"></div></div>';
  const log = el.querySelector('#log'), input = el.querySelector('#q'), send = el.querySelector('#send');
  const actions = {
    // the user confirmed: save it (the Edge Function calls chat_book_appointment as this user, no LLM involved)
    async confirm(entry) {
      if (entry.actionState) return;
      entry.actionState = 'sending'; render();
      const result = await callChat({ confirm_booking: entry.action.args });
      entry.actionState = result.error ? undefined : 'done';
      history.push(result); render();
    },
    cancel(entry) { if (!entry.actionState) { entry.actionState = 'cancelled'; render(); } },
  };
  const render = () => { log.replaceChildren(...history.map((e) => bubble(e, actions))); log.lastElementChild?.scrollIntoView({ block: 'nearest' }); };
  EXAMPLES.forEach((t) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = () => { input.value = t; input.focus(); }; el.querySelector('#ex').appendChild(b); });

  el.querySelector('#chatform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim(); if (!question) return;
    input.value = ''; send.disabled = input.disabled = true;
    const past = chatHistory(history);
    history.push({ role: 'user', text: question }); const pending = { role: 'bot', pending: true }; history.push(pending); render();
    const entry = await callChat({ question, history: past });
    history[history.indexOf(pending)] = entry;
    send.disabled = input.disabled = false; render(); input.focus();
  });
  render();
}
