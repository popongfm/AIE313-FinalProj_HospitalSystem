// Thai messages for Supabase Auth results. Kept free of supabase-js so it can be unit-tested with node --test.
// Order matters: specific phrases ("email not confirmed", "email rate limit") must be checked before the
// generic "email" fallback, otherwise every e-mail related error was shown as "invalid e-mail format".
export function authMessage(error) {
  const m = ((error && error.message) || '').toLowerCase();
  if (m.includes('rate limit')) return 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
  if (m.includes('not confirmed')) return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ดูลิงก์ในกล่องจดหมาย)';
  if (m.includes('not authorized')) return 'ระบบยังส่งอีเมลยืนยันไปที่อีเมลนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'ระบบปิดการสมัครสมาชิกอยู่ กรุณาติดต่อผู้ดูแลระบบ';
  if (m.includes('invalid login')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (m.includes('already registered') || m.includes('already been registered')) return 'อีเมลนี้ถูกใช้สมัครแล้ว';
  if (m.includes('password')) return 'รหัสผ่านไม่ผ่านเงื่อนไข (อย่างน้อย 6 ตัวอักษร)';
  if (m.includes('email')) return 'รูปแบบอีเมลไม่ถูกต้อง';
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

export const SIGNUP_PENDING_APPROVAL = 'สมัครสมาชิกสำเร็จ บัญชีจะใช้งานได้เมื่อผู้ดูแลระบบอนุมัติสิทธิ์แล้ว';
export const SIGNUP_CONFIRM_EMAIL = 'สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลจากลิงก์ในกล่องจดหมาย แล้วรอผู้ดูแลระบบอนุมัติสิทธิ์';

// Interpret supabase.auth.signUp's { data, error }.
// With "Confirm email" on, Supabase does not report an existing e-mail as an error (to avoid leaking which
// e-mails exist); it returns a user whose identities array is empty instead.
export function signUpResult(data, error) {
  if (error) return { ok: false, error: authMessage(error) };
  const user = data && data.user;
  if (user && Array.isArray(user.identities) && user.identities.length === 0) return { ok: false, error: 'อีเมลนี้ถูกใช้สมัครแล้ว' };
  return { ok: true, message: data && data.session ? SIGNUP_PENDING_APPROVAL : SIGNUP_CONFIRM_EMAIL, hasSession: !!(data && data.session) };
}

// What a signed-in account may do, from its row in profiles (the database enforces the same rules with RLS):
//   no profile        -> nothing yet (waiting for an admin)
//   role 'patient'    -> its own records only (patient portal)
//   any other role    -> staff: everything
export function accessFromProfile(profile) {
  if (!profile) return { linked: false, role: null, patient: false };
  return { linked: true, role: profile.role, patient: profile.role === 'patient' };
}
export function hasAppAccess(profile) { return accessFromProfile(profile).linked; }
