import test from 'node:test';
import assert from 'node:assert/strict';
import { authMessage, signUpResult, hasAppAccess, accessFromProfile, SIGNUP_PENDING_APPROVAL, SIGNUP_CONFIRM_EMAIL } from '../js/authMessages.js';

test('wrong password -> invalid credentials message', () => {
  assert.equal(authMessage({ message: 'Invalid login credentials' }), 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
});
test('e-mail related errors are not all reported as a bad format', () => {
  assert.equal(authMessage({ message: 'Email not confirmed' }), 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ดูลิงก์ในกล่องจดหมาย)');
  assert.equal(authMessage({ message: 'Email address not authorized' }), 'ระบบยังส่งอีเมลยืนยันไปที่อีเมลนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ');
  assert.equal(authMessage({ message: 'Email rate limit exceeded' }), 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
  assert.equal(authMessage({ message: 'Unable to validate email address: invalid format' }), 'รูปแบบอีเมลไม่ถูกต้อง');
});
test('sign-up disabled in the dashboard -> explains it', () => {
  assert.equal(authMessage({ message: 'Signups not allowed for this instance' }), 'ระบบปิดการสมัครสมาชิกอยู่ กรุณาติดต่อผู้ดูแลระบบ');
});
test('already registered and weak password', () => {
  assert.equal(authMessage({ message: 'User already registered' }), 'อีเมลนี้ถูกใช้สมัครแล้ว');
  assert.equal(authMessage({ message: 'Password should be at least 6 characters.' }), 'รหัสผ่านไม่ผ่านเงื่อนไข (อย่างน้อย 6 ตัวอักษร)');
});
test('signUpResult: confirm-email on, new address -> check your inbox', () => {
  assert.deepEqual(signUpResult({ user: { identities: [{}] }, session: null }, null), { ok: true, message: SIGNUP_CONFIRM_EMAIL, hasSession: false });
});
test('signUpResult: confirm-email off -> pending approval, session reported', () => {
  assert.deepEqual(signUpResult({ user: { identities: [{}] }, session: {} }, null), { ok: true, message: SIGNUP_PENDING_APPROVAL, hasSession: true });
});
test('signUpResult: confirm-email on, existing address (empty identities) -> already registered', () => {
  assert.deepEqual(signUpResult({ user: { identities: [] }, session: null }, null), { ok: false, error: 'อีเมลนี้ถูกใช้สมัครแล้ว' });
});
test('signUpResult: error from Supabase', () => {
  assert.deepEqual(signUpResult(null, { message: 'User already registered' }), { ok: false, error: 'อีเมลนี้ถูกใช้สมัครแล้ว' });
});
test('access: no profile -> waiting; patient -> own records; staff/admin -> everything', () => {
  assert.equal(hasAppAccess({ role: 'admin' }), true);
  assert.equal(hasAppAccess({ role: 'pharmacist' }), true);
  assert.equal(hasAppAccess({ role: 'patient' }), true);
  assert.equal(hasAppAccess(null), false);
  assert.deepEqual(accessFromProfile(null), { linked: false, role: null, patient: false });
  assert.deepEqual(accessFromProfile({ role: 'patient' }), { linked: true, role: 'patient', patient: true });
  assert.deepEqual(accessFromProfile({ role: 'doctor' }), { linked: true, role: 'doctor', patient: false });
});
