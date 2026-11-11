import { supabase } from './supabaseClient.js';
import { authMessage, signUpResult, accessFromProfile } from './authMessages.js';

// Sign-up (register.html). `person` goes to auth.users.raw_user_meta_data; the database trigger handle_new_user
// (01_core.sql) reads it and links the new account at once: a patient to its medical record (existing or new), a staff
// member to the staff row an admin prepared with the same e-mail. Nothing is copied by hand afterwards.
export async function signUp(email, password, person = {}) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { emailRedirectTo: new URL('index.html', location.href).href, data: person },
  });
  const r = signUpResult(data, error, person.account_type);
  // "Confirm email" off: Supabase signs the new user in at once. Linked -> straight into the app; not linked -> sign out.
  if (r.ok && r.hasSession) {
    const role = await myRole();
    if (role) return { ...r, role, message: '' };
    await supabase.auth.signOut();
  }
  return r;
}
// The signed-in account's role: staff.role ('admin', 'doctor', ...), 'patient', or null while not linked.
async function myRole() {
  const { data, error } = await supabase.rpc('my_role');
  return error ? null : data;
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
// The account's access ({ linked, role, patient }) from my_role() (staff.user_id / patient.user_id). RLS enforces it in
// the database; the page only uses it to show the right menus and to explain an empty screen.
// Unknown (no id, query error) counts as staff.
export async function getAccess(session) {
  const uid = session && session.user && session.user.id;
  if (!uid) return accessFromProfile({ role: null });
  const { data, error } = await supabase.rpc('my_role');
  if (error) return accessFromProfile({ role: null });
  return accessFromProfile(data ? { role: data } : null);
}
