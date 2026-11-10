// Pure helpers (no DOM, no network) so they can be unit-tested with node --test.
export function coerceRow(cfg, values) {
  const row = {}, missing = [];
  for (const c of cfg.cols) {
    const raw = values[c.name] == null ? '' : String(values[c.name]).trim();
    if (raw === '') { if (c.required) missing.push(c.name); row[c.name] = null; continue; }
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
  return { columns, rows: rows.map((r) => columns.map((c) => (r[c] == null ? '' : String(r[c])))) };
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
