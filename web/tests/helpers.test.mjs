import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceRow, tableModel, pivot, sumBy, countDistinctBy } from '../js/helpers.js';
import { TABLES, PATIENT_TABLES } from '../js/tables.js';

test('coerceRow trims text, converts numbers, nulls blank optionals', () => {
  const { row, missing } = coerceRow(TABLES.booking, { patient_id: ' 3 ', staff_id: '2', booking_date: '2026-11-20', booking_time: '09:00', queue_no: '4', symptom: '', status: 'pending' });
  assert.deepEqual(missing, []);
  assert.equal(row.patient_id, 3); assert.equal(row.queue_no, 4); assert.equal(row.symptom, null);
});
test('coerceRow reports missing required fields', () => {
  const { missing } = coerceRow(TABLES.patient, { hn: ' HN9 ', national_id: '1', first_name: '', last_name: 'x' });
  assert.deepEqual(missing, ['first_name']);
});
test('coerceRow rejects non-numeric text in a number field', () => {
  const { missing } = coerceRow(TABLES.booking, { patient_id: 'abc', staff_id: '2', booking_date: '2026-11-20', booking_time: '09:00', queue_no: '1', status: 'pending' });
  assert.ok(missing.includes('patient_id'));
});
test('every CRUD table config names its primary key and has columns', () => {
  for (const [name, cfg] of Object.entries(TABLES)) {
    assert.ok(cfg.pk && cfg.cols.length > 0, name);
  }
});
test('tableModel returns null for empty input (UI shows ไม่พบข้อมูล)', () => {
  assert.equal(tableModel([]), null); assert.equal(tableModel(null), null);
});
test('tableModel stringifies cells and blanks nulls', () => {
  assert.deepEqual(tableModel([{ a: 1, b: null }]), { columns: ['a', 'b'], rows: [['1', '']] });
});
test('pivot groups values by label and series, filling zeros', () => {
  const rows = [{ d: 'A', s: 'x', n: 2 }, { d: 'A', s: 'y', n: '1' }, { d: 'B', s: 'x', n: 5 }];
  assert.deepEqual(pivot(rows, 'd', 's', 'n'), { labels: ['A', 'B'], series: { x: [2, 5], y: [1, 0] } });
});
test('sumBy totals a value per key combination', () => {
  const rows = [{ k: 'a', m: '1', v: 2 }, { k: 'a', m: '1', v: '3.5' }, { k: 'b', m: '1', v: 1 }];
  assert.deepEqual(sumBy(rows, ['k', 'm'], 'v'), [{ k: 'a', m: '1', total: 5.5 }, { k: 'b', m: '1', total: 1 }]);
});
test('patient tables: only the four own-record tables, and only the actions the database allows', () => {
  assert.deepEqual(Object.keys(PATIENT_TABLES), ['patient', 'booking', 'visit', 'prescription']);
  assert.deepEqual(PATIENT_TABLES.patient.cols.map((c) => c.name), ['phone', 'email', 'address']);
  assert.equal(PATIENT_TABLES.patient.insert, false); assert.equal(PATIENT_TABLES.patient.remove, false);
  assert.equal(PATIENT_TABLES.booking.edit, false); assert.equal(PATIENT_TABLES.booking.remove, false); assert.equal(PATIENT_TABLES.booking.cancel, true);
  assert.ok(!PATIENT_TABLES.booking.cols.some((c) => ['patient_id', 'queue_no', 'status', 'visit_id'].includes(c.name)), 'set by the database');
  assert.equal(PATIENT_TABLES.visit.readOnly, true); assert.equal(PATIENT_TABLES.prescription.readOnly, true);
});
test('coerceRow converts a numeric select (doctor id) to a number', () => {
  const { row, missing } = coerceRow(PATIENT_TABLES.booking, { staff_id: '3', booking_date: '2026-12-01', booking_time: '10:00', symptom: '' });
  assert.deepEqual(missing, []); assert.equal(row.staff_id, 3); assert.equal(row.symptom, null);
});
test('countDistinctBy counts each id once per group', () => {
  const rows = [{ s: 'Pending', id: 1 }, { s: 'Pending', id: 1 }, { s: 'Screened', id: 2 }, { s: 'Pending', id: 3 }];
  assert.deepEqual(countDistinctBy(rows, 's', 'id'), [{ key: 'Pending', count: 2 }, { key: 'Screened', count: 1 }]);
  assert.deepEqual(countDistinctBy([], 's', 'id'), []);
});
