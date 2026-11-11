// MCP server exposing READ-ONLY tools over the allowlisted views, plus (when `actions` is given) the booking tools.
// Runs in-process (InMemoryTransport) inside the Edge Function, so no token or port is ever exposed to users.
// Every generated SQL still passes sqlGuard and runs as chat_reader. The booking tools never take SQL: they call
// chat_book_appointment / chat_doctor_directory (db/08_chat_actions.sql) with fixed parameters, as the asking user,
// and propose_booking only PROPOSES (the user saves it with the "ยืนยันนัด" button, see confirmBooking in agent.ts).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VIEW_CATALOG } from './viewCatalog.ts';
import { buildAggregateSql, buildQuerySql, type Built } from './buildQuery.ts';
import { validateSql } from '../chat/sqlGuard.ts';

export type Row = Record<string, unknown>;
export type BookingArgs = { doctor: string; date: string; time: string; symptom?: string; hn?: string };
export type ToolOutcome = { tool: string; args: unknown; sql: string; columns: string[]; rows: Row[]; action?: BookingArgs; question?: string };
export type ChatActions = {
  book(args: BookingArgs, confirm: boolean): Promise<Row>;   // throws Error(reason) when the database refuses
  listDoctors(): Promise<Row[]>;
};
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const filterSchema = z.object({
  column: z.string(), op: z.enum(['=', '!=', '>', '>=', '<', '<=', 'like', 'ilike', 'is_null', 'not_null']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
const orderSchema = z.object({ column: z.string(), direction: z.enum(['asc', 'desc']).optional() });

export function createViewMcpServer(runQuery: (sql: string) => Promise<Row[]>, onOutcome: (o: ToolOutcome) => void, actions?: ChatActions) {
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

  // Asking back is a tool call too, so "answer only from tool results" still holds: plain text is never accepted.
  server.tool('ask_user', 'Ask the user ONE short question when details are missing (e.g. which doctor, date, time or HN for an appointment). Do not use it for data questions.',
    { question: z.string().min(1).max(300) },
    async (a) => { onOutcome({ tool: 'ask_user', args: a, sql: '', columns: [], rows: [], question: a.question }); return text('Question shown to the user. Stop now.'); });

  if (actions) {
    server.tool('list_doctors', 'List the doctors the user can book with (staff_id, doctor_name, department).', {},
      async () => {
        let rows: Row[];
        try { rows = await actions.listDoctors(); } catch { return text('Database error while listing doctors.', true); }
        onOutcome({ tool: 'list_doctors', args: {}, sql: '-- chat_doctor_directory(<the signed-in user>)', columns: rows.length ? Object.keys(rows[0]) : [], rows });
        return text(JSON.stringify(rows));
      });

    server.tool('propose_booking',
      'Check an appointment and show it to the user for confirmation. It does NOT save anything: the user saves it with a button. ' +
      'doctor = staff_id or part of the doctor\'s name; date YYYY-MM-DD; time HH:MM (24h); hn is required for staff accounts, omitted for patients.',
      { doctor: z.union([z.string().min(1).max(100), z.number().int()]),
        date: z.string().regex(DATE_RE), time: z.string().regex(TIME_RE),
        symptom: z.string().max(300).optional(), hn: z.string().max(20).optional() },
      async (raw) => {
        const a: BookingArgs = { ...raw, doctor: String(raw.doctor) };
        let proposal: Row;
        try { proposal = await actions.book(a, false); }
        catch (e) { return text(`Not possible: ${String((e as Error).message).slice(0, 300)}`, true); }
        const action: BookingArgs = { doctor: String(proposal.staff_id), date: a.date, time: a.time,
          ...(a.symptom ? { symptom: a.symptom } : {}), ...(proposal.hn ? { hn: String(proposal.hn) } : {}) };
        onOutcome({ tool: 'propose_booking', args: a, sql: `-- chat_book_appointment(<the signed-in user>, ${JSON.stringify(a)}, confirm => false)`,
          columns: Object.keys(proposal), rows: [proposal], action });
        return text(JSON.stringify({ proposal, saved: false, note: 'NOT saved yet. Tell the user to check the details and press ยืนยันนัด.' }));
      });
  }
  return server;
}
