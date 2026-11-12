import test from 'node:test';
import assert from 'node:assert/strict';
import { ICONS } from '../js/icons.js';

test('the icon set is exactly the names the app uses', () => {
  assert.deepEqual(Object.keys(ICONS).sort(), ['calendar', 'capsule', 'chart', 'chat', 'check', 'clipboard', 'close', 'edit', 'logout', 'plus', 'search', 'send', 'table', 'trash', 'user', 'x-circle'].sort());
  for (const [k, v] of Object.entries(ICONS)) assert.ok(typeof v === 'string' && v.length > 0, k);
});
