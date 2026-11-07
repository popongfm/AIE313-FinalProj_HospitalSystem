// Turns structured MCP tool arguments into ONE safe SELECT over an allowlisted view. The LLM never writes SQL text:
// view/column names must exist in VIEW_CATALOG, operators/functions come from fixed lists, values are escaped literals.
import { VIEW_CATALOG } from './viewCatalog.ts';

export type Built = { ok: true; sql: string } | { ok: false; error: string };
export type Filter = { column: string; op: string; value?: string | number | boolean };
export type Order = { column: string; direction?: 'asc' | 'desc' };
export type Metric = { fn: string; column?: string; alias?: string };
const OPS: Record<string, string> = { '=': '=', '!=': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=', like: 'LIKE', ilike: 'ILIKE' };
const NUMERIC = new Set(['int2', 'int4', 'int8', 'numeric', 'float4', 'float8']);
const FNS = new Set(['count', 'sum', 'avg', 'min', 'max']);
const DEFAULT_LIMIT = 50, MAX_LIMIT = 100;
const err = (error: string): Built => ({ ok: false, error });

function viewCols(view: string) {
  const v = VIEW_CATALOG[view];
  return v ? new Map(v.columns.map((c) => [c.name, c.type])) : null;
}
const limitOf = (n?: number) => Math.min(Math.max(Math.trunc(Number.isFinite(n) ? (n as number) : DEFAULT_LIMIT), 1), MAX_LIMIT);

function where(filters: Filter[] | undefined, cols: Map<string, string>): string | Built {
  const parts: string[] = [];
  for (const f of filters ?? []) {
    const type = cols.get(f.column);
    if (!type) return err(`unknown column "${f.column}"`);
    if (f.op === 'is_null' || f.op === 'not_null') { parts.push(`${f.column} IS ${f.op === 'not_null' ? 'NOT ' : ''}NULL`); continue; }
    const op = OPS[f.op];
    if (!op) return err(`unsupported operator "${f.op}"`);
    if (f.value === undefined || f.value === null) return err(`filter on ${f.column} needs a value`);
    let lit: string;
    if (NUMERIC.has(type)) {
      const n = typeof f.value === 'number' ? f.value : typeof f.value === 'string' && /^-?\d+(\.\d+)?$/.test(f.value.trim()) ? Number(f.value) : NaN;
      if (!Number.isFinite(n)) return err(`column ${f.column} is numeric; value must be a number`);
      lit = String(n);
    } else lit = `'${String(f.value).replace(/'/g, "''")}'`;
    parts.push(`${f.column} ${op} ${lit}`);
  }
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
}
function orderBy(order: Order[] | undefined, allowed: Set<string>): string | Built {
  const parts: string[] = [];
  for (const o of order ?? []) {
    if (!allowed.has(o.column)) return err(`cannot order by "${o.column}"`);
    const d = (o.direction ?? 'asc');
    if (d !== 'asc' && d !== 'desc') return err('direction must be asc or desc');
    parts.push(`${o.column} ${d.toUpperCase()}`);
  }
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : '';
}

export function buildQuerySql(a: { view: string; columns?: string[]; filters?: Filter[]; order_by?: Order[]; limit?: number }): Built {
  const cols = viewCols(a.view);
  if (!cols) return err(`unknown view "${a.view}"`);
  for (const c of a.columns ?? []) if (!cols.has(c)) return err(`unknown column "${c}" in ${a.view}`);
  const w = where(a.filters, cols); if (typeof w !== 'string') return w;
  const o = orderBy(a.order_by, new Set(cols.keys())); if (typeof o !== 'string') return o;
  const select = a.columns?.length ? a.columns.join(', ') : '*';
  return { ok: true, sql: `SELECT ${select} FROM ${a.view}${w}${o} LIMIT ${limitOf(a.limit)}` };
}

export function buildAggregateSql(a: { view: string; group_by?: string[]; metrics: Metric[]; filters?: Filter[]; order_by?: Order[]; limit?: number }): Built {
  const cols = viewCols(a.view);
  if (!cols) return err(`unknown view "${a.view}"`);
  if (!a.metrics?.length) return err('at least one metric is required');
  const group = a.group_by ?? [];
  for (const g of group) if (!cols.has(g)) return err(`unknown column "${g}" in ${a.view}`);
  const exprs: string[] = [], names = new Set<string>(group);
  for (const m of a.metrics) {
    if (!FNS.has(m.fn)) return err(`unsupported function "${m.fn}"`);
    let expr: string, alias: string;
    if (m.fn === 'count' && !m.column) { expr = 'count(*)'; alias = m.alias ?? 'count_all'; }
    else {
      const type = m.column ? cols.get(m.column) : undefined;
      if (!type) return err(`unknown column "${m.column}" in ${a.view}`);
      if ((m.fn === 'sum' || m.fn === 'avg') && !NUMERIC.has(type)) return err(`${m.fn} needs a numeric column`);
      expr = m.fn === 'avg' ? `round(avg(${m.column})::numeric, 2)` : `${m.fn}(${m.column})`;
      alias = m.alias ?? `${m.fn}_${m.column}`;
    }
    if (!/^[a-z_][a-z0-9_]{0,40}$/.test(alias)) return err(`invalid alias "${alias}"`);
    names.add(alias); exprs.push(`${expr} AS ${alias}`);
  }
  const w = where(a.filters, cols); if (typeof w !== 'string') return w;
  const o = orderBy(a.order_by, names); if (typeof o !== 'string') return o;
  const select = [...group, ...exprs].join(', ');
  return { ok: true, sql: `SELECT ${select} FROM ${a.view}${w}${group.length ? ` GROUP BY ${group.join(', ')}` : ''}${o} LIMIT ${limitOf(a.limit)}` };
}
