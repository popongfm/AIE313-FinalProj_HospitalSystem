// MCP server exposing READ-ONLY tools over the 9 allowlisted views. Runs in-process (InMemoryTransport) inside the
// Edge Function, so no token or port is ever exposed to users. Every generated SQL still passes sqlGuard and runs as chat_reader.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VIEW_CATALOG } from './viewCatalog.ts';
import { buildAggregateSql, buildQuerySql, type Built } from './buildQuery.ts';
import { validateSql } from '../chat/sqlGuard.ts';

export type Row = Record<string, unknown>;
export type ToolOutcome = { tool: string; args: unknown; sql: string; columns: string[]; rows: Row[] };

const filterSchema = z.object({
  column: z.string(), op: z.enum(['=', '!=', '>', '>=', '<', '<=', 'like', 'ilike', 'is_null', 'not_null']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
const orderSchema = z.object({ column: z.string(), direction: z.enum(['asc', 'desc']).optional() });

export function createViewMcpServer(runQuery: (sql: string) => Promise<Row[]>, onOutcome: (o: ToolOutcome) => void) {
  const server = new McpServer({ name: 'hospital-views', version: '1.0.0' });
  const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError });

  async function execute(tool: string, args: unknown, built: Built) {
    if (!built.ok) return text(`Invalid arguments: ${built.error}`, true);
    const guard = validateSql(built.sql);
    if (!guard.ok) return text(`Rejected: ${guard.reason}`, true);
    let rows: Row[];
    try { rows = await runQuery(guard.sql); } catch { return text('Database error while running the query.', true); }
    const columns = rows.length ? Object.keys(rows[0]) : [];
    onOutcome({ tool, args, sql: guard.sql, columns, rows });
    return text(JSON.stringify({ row_count: rows.length, columns, rows: rows.slice(0, 30) }));
  }

  server.tool('list_views', 'List the available read-only views with their columns and types. Call this first if unsure which view/column to use.', {},
    async () => text(JSON.stringify(Object.entries(VIEW_CATALOG).map(([view, v]) => ({ view, description: v.description, columns: v.columns.map((c) => `${c.name}:${c.type}`) })))));

  server.tool('query_view', 'Select rows from ONE view with optional column list, filters (AND), ordering and limit (max 100). Use for lookups and top-N.',
    { view: z.string(), columns: z.array(z.string()).optional(), filters: z.array(filterSchema).optional(), order_by: z.array(orderSchema).optional(), limit: z.number().int().optional() },
    async (a) => execute('query_view', a, buildQuerySql(a)));

  server.tool('aggregate_view', 'Group and aggregate ONE view: group_by columns plus metrics (count/sum/avg/min/max). Use for totals, averages, counts per category.',
    { view: z.string(), group_by: z.array(z.string()).optional(),
      metrics: z.array(z.object({ fn: z.enum(['count', 'sum', 'avg', 'min', 'max']), column: z.string().optional(), alias: z.string().optional() })).min(1),
      filters: z.array(filterSchema).optional(), order_by: z.array(orderSchema).optional(), limit: z.number().int().optional() },
    async (a) => execute('aggregate_view', a, buildAggregateSql(a)));

  return server;
}
