import test from 'node:test';
import assert from 'node:assert/strict';
import { authMessage, signUpResult, hasAppAccess, accessFromProfile, registrationProblem, SIGNUP_PENDING_APPROVAL, SIGNUP_CONFIRM_EMAIL } from '../js/authMessages.js';

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
  assert.deepEqual(signUpResult({ user: { identities: [{}] }, session: null }, null), { ok: true, message: SIGNUP_CONFIRM_EMAIL, hasSession: false, accountType: null });
});
test('signUpResult: confirm-email off -> pending approval, session reported', () => {
  assert.deepEqual(signUpResult({ user: { identities: [{}] }, session: {} }, null, 'staff'), { ok: true, message: SIGNUP_PENDING_APPROVAL, hasSession: true, accountType: 'staff' });
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

test('authMessage: sign-up refused by the database trigger', () => {
  assert.match(authMessage({ message: 'Database error saving new user' }), /เลขบัตรประชาชน/);
});
test('registrationProblem: patient form checks', () => {
  const ok = { account_type: 'patient', first_name: 'ก', last_name: 'ข', national_id: '1234567890123', birth_date: '2000-01-31', phone: '' };
  const day = new Date('2026-11-11T00:00:00Z');
  assert.equal(registrationProblem(ok, 'secret1', 'secret1', day), '');
  assert.equal(registrationProblem(ok, 'secret1', 'secret2', day), 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
  assert.equal(registrationProblem({ ...ok, national_id: '123' }, 'secret1', 'secret1', day), 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');
  assert.equal(registrationProblem({ ...ok, first_name: '' }, 'secret1', 'secret1', day), 'กรุณากรอกชื่อและนามสกุล');
  assert.equal(registrationProblem({ ...ok, birth_date: '' }, 'secret1', 'secret1', day), 'กรุณาระบุวันเกิด');
  assert.equal(registrationProblem({ ...ok, birth_date: '2030-01-01' }, 'secret1', 'secret1', day), 'วันเกิดต้องไม่เป็นวันในอนาคต');
  assert.equal(registrationProblem({ ...ok, phone: '0812' }, 'secret1', 'secret1', day), 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก');
  assert.equal(registrationProblem({ account_type: 'staff' }, 'secret1', 'secret1', day), '', 'staff: only the password check');
});
