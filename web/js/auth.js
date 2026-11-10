import { supabase } from './supabaseClient.js';
import { authMessage, signUpResult, hasAppAccess } from './authMessages.js';

// New accounts can sign up, but see no data until an admin links them to a staff/admin row in profiles.
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { emailRedirectTo: location.origin + location.pathname },
  });
  const r = signUpResult(data, error);
  // when "Confirm email" is off Supabase signs the new user in at once; sign out so they log in after approval
  if (r.ok && r.hasSession) await supabase.auth.signOut();
  return r;
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
// false when this account is not yet linked to a staff/admin profile. RLS already hides the data;
// this only lets the page explain why everything is empty. Unknown (no id, query error) counts as allowed.
export async function hasAccess(session) {
  const uid = session && session.user && session.user.id;
  if (!uid) return true;
  const { data, error } = await supabase.from('profiles').select('role').eq('user_id', uid).maybeSingle();
  if (error) return true;
  return hasAppAccess(data);
}
