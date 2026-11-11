// Small DOM builders shared by the app's pages. Text always goes in with textContent.
import { icon } from './icons.js';
import { statusInfo } from './helpers.js';

// <button> with an optional icon; the text lives in .label so setLabel() can change it without dropping the icon
export function button(label, { icon: name, variant, size, type = 'button' } = {}) {
  const b = document.createElement('button'); b.type = type;
  const cls = [variant && variant !== 'secondary' ? variant : '', size || ''].filter(Boolean).join(' ');
  if (cls) b.className = cls;
  if (name) b.appendChild(icon(name));
  const span = document.createElement('span'); span.className = 'label'; span.textContent = label; b.appendChild(span);
  return b;
}
export function setLabel(btn, text) { const s = btn.querySelector('.label'); if (s) s.textContent = text; else btn.textContent = text; }

// coloured status badge; the database value stays in data-value / title
export function badge(value) {
  const info = statusInfo(value); if (!info) return null;
  const s = document.createElement('span'); s.className = 'badge'; s.dataset.tone = info.tone; s.dataset.value = String(value); s.title = String(value);
  s.textContent = info.label; return s;
}

// short confirmation in the corner ("บันทึกแล้ว"); errors stay next to the form instead
export function toast(message, tone = 'ok') {
  let region = document.getElementById('toasts');
  if (!region) { region = document.createElement('div'); region.id = 'toasts'; region.setAttribute('role', 'status'); region.setAttribute('aria-live', 'polite'); document.body.appendChild(region); }
  const t = document.createElement('div'); t.className = 'toast'; t.dataset.tone = tone;
  const text = document.createElement('span'); text.textContent = message;
  t.append(icon(tone === 'ok' ? 'check' : 'x-circle'), text);
  region.appendChild(t);
  setTimeout(() => t.remove(), 3500);
  return t;
}

// grey placeholder rows while a list loads; its only text is "กำลังโหลด..." (for screen readers)
export function skeleton(rows = 6) {
  const box = document.createElement('div'); box.className = 'skeleton'; box.setAttribute('aria-busy', 'true');
  const sr = document.createElement('span'); sr.className = 'visually-hidden'; sr.textContent = 'กำลังโหลด...'; box.appendChild(sr);
  for (let i = 0; i < rows; i++) { const bar = document.createElement('div'); bar.className = 'bar'; box.appendChild(bar); }
  return box;
}

// department sign above a page: zone colour, icon, zone name, then what is shown
export function zoneSign(zone, title) {
  const el = document.createElement('div'); el.className = 'zone-sign';
  updateZoneSign(el, zone, title); return el;
}
export function updateZoneSign(el, zone, title) {
  el.style.setProperty('--zone', zone.color);
  const z = document.createElement('strong'); z.textContent = zone.label;
  const t = document.createElement('span'); t.textContent = title;
  const mark = document.createElement('span'); mark.className = 'zone-mark'; mark.appendChild(icon(zone.icon));
  el.replaceChildren(mark, z, t);
}
