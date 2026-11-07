import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuerySql, buildAggregateSql } from './buildQuery.ts';
import { validateSql } from '../chat/sqlGuard.ts';

const ok = (r: { ok: boolean; sql?: string; error?: string }) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.sql!; };
const bad = (r: { ok: boolean }) => assert.equal(r.ok, false);

test('query_view builds a guarded SELECT with filters, order and limit', () => {
  const sql = ok(buildQuerySql({ view: 'v_doctor_workload', columns: ['doctor_name', 'booking_count'],
    filters: [{ column: 'status', op: '=', value: 'completed' }], order_by: [{ column: 'booking_count', direction: 'desc' }], limit: 5 }));
  assert.equal(sql, "SELECT doctor_name, booking_count FROM v_doctor_workload WHERE status = 'completed' ORDER BY booking_count DESC LIMIT 5");
  assert.equal(validateSql(sql).ok, true);
});
test('defaults: all columns, LIMIT 50; limit capped at 100', () => {
  assert.equal(ok(buildQuerySql({ view: 'v_top_diagnosis' })), 'SELECT * FROM v_top_diagnosis LIMIT 50');
  assert.match(ok(buildQuerySql({ view: 'v_top_diagnosis', limit: 9999 })), /LIMIT 100$/);
});
test('rejects unknown view, unknown column, bad operator, bad direction', () => {
  bad(buildQuerySql({ view: 'patient' }));
  bad(buildQuerySql({ view: 'v_top_diagnosis', columns: ['national_id'] }));
  bad(buildQuerySql({ view: 'v_top_diagnosis', filters: [{ column: 'rank_no', op: '; drop' as never, value: 1 }] }));
  bad(buildQuerySql({ view: 'v_top_diagnosis', order_by: [{ column: 'rank_no', direction: 'sideways' as never }] }));
});
test('string values are escaped; numeric columns require finite numbers', () => {
  const sql = ok(buildQuerySql({ view: 'v_doctor_workload', filters: [{ column: 'doctor_name', op: 'ilike', value: "%O'Brien%" }] }));
  assert.match(sql, /ILIKE '%O''Brien%'/);
  bad(buildQuerySql({ view: 'v_top_diagnosis', filters: [{ column: 'rank_no', op: '>', value: '1 or 1=1' }] }));
});
test('is_null / not_null take no value', () => {
  assert.match(ok(buildQuerySql({ view: 'v_top_diagnosis', filters: [{ column: 'rank_no', op: 'not_null' }] })), /WHERE rank_no IS NOT NULL/);
});
test('aggregate_view groups and aggregates', () => {
  const sql = ok(buildAggregateSql({ view: 'v_visit_billing', group_by: ['department'],
    metrics: [{ fn: 'sum', column: 'total_amount', alias: 'total' }, { fn: 'count' }], order_by: [{ column: 'total', direction: 'desc' }], limit: 10 }));
  assert.equal(sql, 'SELECT department, sum(total_amount) AS total, count(*) AS count_all FROM v_visit_billing GROUP BY department ORDER BY total DESC LIMIT 10');
  assert.equal(validateSql(sql).ok, true);
  assert.match(ok(buildAggregateSql({ view: 'v_visit_billing', metrics: [{ fn: 'avg', column: 'total_amount' }] })), /round\(avg\(total_amount\)::numeric, 2\) AS avg_total_amount/);
});
test('aggregate_view rejects bad metrics', () => {
  bad(buildAggregateSql({ view: 'v_visit_billing', metrics: [] }));
  bad(buildAggregateSql({ view: 'v_visit_billing', metrics: [{ fn: 'pg_sleep' as never, column: 'total_amount' }] }));
  bad(buildAggregateSql({ view: 'v_visit_billing', metrics: [{ fn: 'sum', column: 'department' }] })); // non-numeric
  bad(buildAggregateSql({ view: 'v_visit_billing', metrics: [{ fn: 'count', alias: 'x; drop' }] }));
});
