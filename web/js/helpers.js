// Pure helpers (no DOM, no network) so they can be unit-tested with node --test.

// ---------- Thailand time: every date and time in the app is Asia/Bangkok (GMT+7, no daylight saving) ----------
export const HOSPITAL_TZ = 'Asia/Bangkok';
export const TZ_LABEL = 'เวลาประเทศไทย (Asia/Bangkok, GMT+7)';
const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: HOSPITAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
// today's date in Thailand, YYYY-MM-DD (not the browser's own time zone)
export function bangkokDate(now = new Date()) { const p = parts(now); return `${p.year}-${p.month}-${p.day}`; }
// a timestamptz from the API ("2026-11-10T03:00:00+00:00") -> "2026-11-10 10:00" in Thai time; other values unchanged
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;
export function isTimestamp(v) { return typeof v === 'string' && TS_RE.test(v); }
export function formatTimestamp(v) {
  if (!isTimestamp(v)) return v;
  const d = new Date(v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(d.getTime())) return v;
  const p = parts(d); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
// <input type="datetime-local"> shows and returns wall-clock time with no zone: show Thai time, save it as +07:00
export function toDatetimeLocal(v) {
  if (v == null) return '';
  return isTimestamp(v) ? formatTimestamp(v).replace(' ', 'T') : String(v).slice(0, 16);
}
export function fromDatetimeLocal(s) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00+07:00` : s; }
export function coerceRow(cfg, values) {
  const row = {}, missing = [];
  for (const c of cfg.cols) {
    const raw = values[c.name] == null ? '' : String(values[c.name]).trim();
    if (raw === '') { if (c.required) missing.push(c.name); row[c.name] = null; continue; }
    if (c.type === 'datetime-local') { row[c.name] = fromDatetimeLocal(raw); continue; }   // Thai time, GMT+7
    if (c.type === 'number' || c.numeric) {
      const n = Number(raw);
      if (Number.isNaN(n)) { missing.push(c.name); continue; }
      row[c.name] = n;
    } else row[c.name] = raw;
  }
  return { row, missing };
}
export function tableModel(rows) {
  if (!rows || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);
  return { columns, rows: rows.map((r) => columns.map((c) => (r[c] == null ? '' : String(formatTimestamp(r[c]))))) };   // timestamps in Thai time
}
export function pivot(rows, labelKey, seriesKey, valueKey) {
  const labels = [], names = [];
  for (const r of rows) { if (!labels.includes(r[labelKey])) labels.push(r[labelKey]); if (!names.includes(r[seriesKey])) names.push(r[seriesKey]); }
  const series = Object.fromEntries(names.map((n) => [n, labels.map(() => 0)]));
  for (const r of rows) series[r[seriesKey]][labels.indexOf(r[labelKey])] += Number(r[valueKey]);
  return { labels, series };
}
export function sumBy(rows, keys, valueKey) {
  const out = new Map();
  for (const r of rows) {
    const id = keys.map((k) => r[k]).join('\u0000');
    if (!out.has(id)) out.set(id, { ...Object.fromEntries(keys.map((k) => [k, r[k]])), total: 0 });
    out.get(id).total += Number(r[valueKey]);
  }
  return [...out.values()];
}
// [{ key, count }] where count is the number of distinct idKey values per groupKey, groups in first-seen order
export function countDistinctBy(rows, groupKey, idKey) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[groupKey])) groups.set(r[groupKey], new Set());
    groups.get(r[groupKey]).add(r[idKey]);
  }
  return [...groups].map(([key, ids]) => ({ key, count: ids.size }));
}

// ---------- status values shown as coloured badges (table cells, form options) ----------
// Exact values first (prescriptions use capitalised values, bookings lower-case), then lower-case.
const STATUS_EXACT = {
  Pending: ['warn', 'รอคัดกรอง'], Screened: ['info', 'คัดกรองแล้ว'], Dispensed: ['ok', 'จ่ายยาแล้ว'], Cancelled: ['neutral', 'ยกเลิก'],
};
const STATUS_LOWER = {
  pending: ['warn', 'รอยืนยัน'], confirmed: ['info', 'ยืนยันแล้ว'], completed: ['ok', 'เสร็จสิ้น'], cancelled: ['neutral', 'ยกเลิก'],
  screened: ['info', 'คัดกรองแล้ว'], dispensed: ['ok', 'จ่ายยาแล้ว'],
  normal: ['ok', 'ปกติ'], near_expiry: ['warn', 'ใกล้หมดอายุ'], reorder_urgent: ['danger', 'ต้องสั่งด่วน'],
  available: ['ok', 'ว่าง'], occupied: ['info', 'มีผู้ป่วย'], maintenance: ['neutral', 'ปิดซ่อม'],
};
// { tone, label } for a status value; unknown values keep their own text in a neutral tone; empty -> null
export function statusInfo(value) {
  if (value == null || value === '') return null;
  const v = String(value);
  const hit = (Object.hasOwn(STATUS_EXACT, v) && STATUS_EXACT[v]) || (Object.hasOwn(STATUS_LOWER, v.toLowerCase()) && STATUS_LOWER[v.toLowerCase()]);
  return hit ? { tone: hit[0], label: hit[1] } : { tone: 'neutral', label: v };
}
export function isStatusColumn(name) { return name === 'status' || String(name).endsWith('_status'); }

// table search: does any cell contain the query (case-insensitive, Unicode-normalised)?
const norm = (s) => String(s).normalize('NFC').toLowerCase().trim();
export function matchesQuery(cells, query) {
  const q = norm(query ?? '');
  return q === '' || cells.some((c) => norm(c).includes(q));
}
