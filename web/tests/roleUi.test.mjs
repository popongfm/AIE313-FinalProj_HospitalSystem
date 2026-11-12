import test from 'node:test';
import assert from 'node:assert/strict';
import { tabsFor, chartsFor, roleLabel, ALL_TABS, STAFF_CHARTS } from '../js/roleUi.js';

test('patient has no reports tab; staff and unknown get every tab', () => {
  assert.deepEqual(tabsFor({ patient: true }), ['data', 'dash', 'chat']);
  assert.deepEqual(tabsFor({ patient: false, role: 'nurse' }), ['data', 'views', 'dash', 'chat']);
  assert.deepEqual(tabsFor(), ALL_TABS);
});
test('dashboard charts per role; admin sees every staff chart', () => {
  assert.deepEqual(chartsFor('admin'), ['workload', 'billing', 'lowStock', 'beds', 'screening']);
  assert.deepEqual(chartsFor('doctor'), ['workload', 'beds']);
  assert.deepEqual(chartsFor('nurse'), ['beds', 'workload']);
  assert.deepEqual(chartsFor('pharmacist'), ['screening', 'lowStock']);
  assert.deepEqual(chartsFor('patient'), ['myBilling']);
});
test('unknown or missing role falls back to the admin set', () => {
  for (const r of [null, undefined, 'technician', 'constructor']) assert.deepEqual(chartsFor(r), STAFF_CHARTS);
});
test('returned arrays are copies', () => {
  chartsFor('admin').push('x'); tabsFor().push('x'); chartsFor('doctor').push('x');
  assert.equal(chartsFor('admin').length, 5); assert.equal(tabsFor().length, 4); assert.equal(chartsFor('doctor').length, 2);
});
test('roleLabel', () => {
  assert.equal(roleLabel({ linked: true, role: 'admin' }), 'ผู้ดูแลระบบ'); assert.equal(roleLabel({ linked: true, role: 'doctor' }), 'แพทย์');
  assert.equal(roleLabel({ linked: true, role: 'nurse' }), 'พยาบาล'); assert.equal(roleLabel({ linked: true, role: 'pharmacist' }), 'เภสัชกร');
  assert.equal(roleLabel({ linked: true, patient: true, role: 'patient' }), 'ผู้ป่วย'); assert.equal(roleLabel({ linked: true, role: null }), 'เจ้าหน้าที่');
  assert.equal(roleLabel({ linked: false }), 'รอผูกบัญชี');
});
