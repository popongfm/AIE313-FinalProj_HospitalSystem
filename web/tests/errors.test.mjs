import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from '../js/errors.js';

test('23505 unique violation -> duplicate message', () => {
  assert.equal(friendlyError({ code: '23505' }), 'ข้อมูลซ้ำ มีรายการนี้อยู่แล้ว');
});
test('23503 foreign key violation -> referenced message', () => {
  assert.equal(friendlyError({ code: '23503' }), 'ลบ/แก้ไขไม่ได้ เพราะมีข้อมูลอื่นอ้างอิงอยู่');
});
test('23514 check violation -> invalid data message', () => {
  assert.equal(friendlyError({ code: '23514' }), 'ข้อมูลไม่ถูกต้องตามเงื่อนไขของระบบ');
});
test('42501 permission -> no permission message', () => {
  assert.equal(friendlyError({ code: '42501' }), 'ไม่มีสิทธิ์ใช้งาน');
});
test('unknown code -> default message', () => {
  assert.equal(friendlyError({ code: 'XX000', message: 'boom' }), 'เกิดข้อผิดพลาด กรุณาลองใหม่');
});
test('null error -> default message', () => {
  assert.equal(friendlyError(null), 'เกิดข้อผิดพลาด กรุณาลองใหม่');
});
test('never leaks the raw postgres message', () => {
  const msg = friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "uq_x"' });
  assert.ok(!msg.includes('duplicate key'));
});
