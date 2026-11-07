import { supabase } from './supabaseClient.js';

function authMessage(error) {
  const m = (error && error.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (m.includes('already registered') || m.includes('already been registered')) return 'อีเมลนี้ถูกใช้สมัครแล้ว';
  if (m.includes('password')) return 'รหัสผ่านไม่ผ่านเงื่อนไข (อย่างน้อย 6 ตัวอักษร)';
  if (m.includes('email')) return 'รูปแบบอีเมลไม่ถูกต้อง';
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

export async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  return error ? { ok: false, error: authMessage(error) } : { ok: true };
}
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { ok: false, error: authMessage(error) } : { ok: true };
}
export async function signOut() { await supabase.auth.signOut(); }
export async function requireSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) { location.replace('index.html'); return null; }
  return data.session;
}
