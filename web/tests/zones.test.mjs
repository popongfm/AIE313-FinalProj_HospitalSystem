import test from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, zoneFor, VIEWS, VIEW_LABELS } from '../js/zones.js';
import { TABLES } from '../js/tables.js';
import { STAFF_CHARTS } from '../js/roleUi.js';

test('every table, view and chart has a zone', () => {
  for (const k of [...Object.keys(TABLES), ...VIEWS, ...STAFF_CHARTS, 'myBilling']) assert.ok(Object.values(ZONES).includes(zoneFor(k)), k);
  assert.equal(zoneFor('booking').id, 'appt'); assert.equal(zoneFor('v_inventory_stock_status').id, 'rx');
  assert.equal(zoneFor('nope').id, 'rep'); assert.equal(zoneFor('constructor').id, 'rep');
});
test('VIEW_LABELS covers VIEWS in order', () => assert.deepEqual(Object.keys(VIEW_LABELS), VIEWS));
test('zones carry label, icon and colour', () => {
  assert.deepEqual(Object.keys(ZONES), ['appt', 'rec', 'rx', 'rep']);
  assert.deepEqual(ZONES.rx, { id: 'rx', label: 'เภสัชกรรม', en: 'Pharmacy', icon: 'capsule', color: 'var(--z-rx)' });
});
