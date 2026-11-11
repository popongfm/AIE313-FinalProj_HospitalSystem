// Thai messages for Supabase Auth results. Kept free of supabase-js so it can be unit-tested with node --test.
// Order matters: specific phrases ("email not confirmed", "email rate limit") must be checked before the
// generic "email" fallback, otherwise every e-mail related error was shown as "invalid e-mail format".
export function authMessage(error) {
  const m = ((error && error.message) || '').toLowerCase();
  if (m.includes('rate limit')) return 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
  if (m.includes('not confirmed')) return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ดูลิงก์ในกล่องจดหมาย)';
  if (m.includes('not authorized')) return 'ระบบยังส่งอีเมลยืนยันไปที่อีเมลนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ';
  // the sign-up trigger (handle_new_user) refused the patient data; Supabase reports it with this generic text
  if (m.includes('database error saving new user')) return 'ลงทะเบียนไม่สำเร็จ: เลขบัตรประชาชนนี้มีบัญชีแล้ว หรือวันเกิดไม่ตรงกับเวชระเบียนเดิม กรุณาตรวจสอบหรือติดต่อเวชระเบียน';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'ระบบปิดการสมัครสมาชิกอยู่ กรุณาติดต่อผู้ดูแลระบบ';
  if (m.includes('invalid login')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (m.includes('already registered') || m.includes('already been registered')) return 'อีเมลนี้ถูกใช้สมัครแล้ว';
  if (m.includes('password')) return 'รหัสผ่านไม่ผ่านเงื่อนไข (อย่างน้อย 6 ตัวอักษร)';
  if (m.includes('email')) return 'รูปแบบอีเมลไม่ถูกต้อง';
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

export const SIGNUP_PENDING_APPROVAL = 'สมัครสมาชิกสำเร็จ แต่ยังไม่พบอีเมลนี้ในรายชื่อเจ้าหน้าที่ บัญชีจะใช้งานได้เมื่อผู้ดูแลระบบเพิ่มอีเมลนี้ในข้อมูลเจ้าหน้าที่';
export const SIGNUP_CONFIRM_EMAIL = 'สมัครสมาชิกสำเร็จ กรุณายืนยันอีเมลจากลิงก์ในกล่องจดหมาย แล้วเข้าสู่ระบบ';

// Interpret supabase.auth.signUp's { data, error }. accountType ('patient' | 'staff') only changes the message.
// With "Confirm email" on, Supabase does not report an existing e-mail as an error (to avoid leaking which
// e-mails exist); it returns a user whose identities array is empty instead.
// With a session (confirm-email off) auth.js asks my_role(): a linked account goes straight in, so this message is only
// shown to an account that is still waiting.
export function signUpResult(data, error, accountType) {
  if (error) return { ok: false, error: authMessage(error) };
  const user = data && data.user;
  if (user && Array.isArray(user.identities) && user.identities.length === 0) return { ok: false, error: 'อีเมลนี้ถูกใช้สมัครแล้ว' };
  const hasSession = !!(data && data.session);
  return { ok: true, message: hasSession ? SIGNUP_PENDING_APPROVAL : SIGNUP_CONFIRM_EMAIL, hasSession, accountType: accountType || null };
}

// What a signed-in account may do, from its role (my_role(): staff.role or 'patient'; RLS enforces the same rules):
//   no role           -> nothing yet (a staff sign-up whose e-mail an admin has not added)
//   role 'patient'    -> its own records only (patient portal)
//   any other role    -> staff: everything
export function accessFromProfile(profile) {
  if (!profile) return { linked: false, role: null, patient: false };
  return { linked: true, role: profile.role, patient: profile.role === 'patient' };
}
export function hasAppAccess(profile) { return accessFromProfile(profile).linked; }

// Checks on the registration form before calling Supabase (the database checks the same again). Returns a Thai
// message, or '' when the form is fine. person = the sign-up data sent to handle_new_user.
export function registrationProblem(person, password, password2, today = new Date()) {
  if (password !== password2) return 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
  if (!person || person.account_type !== 'patient') return '';
  if (!person.first_name || !person.last_name) return 'กรุณากรอกชื่อและนามสกุล';
  if (!/^[0-9]{13}$/.test(person.national_id || '')) return 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(person.birth_date || '')) return 'กรุณาระบุวันเกิด';
  if (person.birth_date > today.toISOString().slice(0, 10)) return 'วันเกิดต้องไม่เป็นวันในอนาคต';
  if (person.phone && !/^[0-9]{10}$/.test(person.phone)) return 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก';
  return '';
}
