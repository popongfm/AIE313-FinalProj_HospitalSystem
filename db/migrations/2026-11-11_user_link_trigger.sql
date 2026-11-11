-- Migration for a project that already has 2026-11-10b_upcoming_bookings.sql applied (review comment #1):
--   * drop the profiles table (one row held either a patient or a staff member: two kinds of person in one row);
--     accounts are now linked by a user_id foreign key in staff / patient, and the role comes from staff.role
--   * admin becomes a staff role; existing profiles rows are moved over before the table is dropped
--   * a trigger on auth.users links each new sign-up automatically (no more copying UUIDs into profiles by hand)
-- Run in the SQL editor (safe to run again: it replaces what an earlier run or an older handle_new_user left behind), then deploy the web page and the Edge Functions of the same version
-- (they read the role with my_role() / role_of() instead of the profiles table).
BEGIN;

-- 1) columns: admin is a staff role; each person row may point at one Supabase Auth account
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('admin','doctor','pharmacist','nurse','technician'));
ALTER TABLE staff   ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE patient ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2) move the existing links out of profiles (skipped if profiles is already gone, so the file can be run again)
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN RETURN; END IF;
  EXECUTE $q$UPDATE staff   s SET user_id = p.user_id FROM profiles p WHERE p.staff_id   = s.staff_id   AND p.role <> 'patient' AND s.user_id IS NULL$q$;
  EXECUTE $q$UPDATE patient t SET user_id = p.user_id FROM profiles p WHERE p.patient_id = t.patient_id AND p.role = 'patient' AND t.user_id IS NULL$q$;
  -- admins had no staff row: give each one (named after its e-mail)
  EXECUTE $q$INSERT INTO staff (first_name, last_name, role, email, user_id)
    SELECT 'ผู้ดูแลระบบ', split_part(u.email, '@', 1), 'admin',
           CASE WHEN EXISTS (SELECT 1 FROM staff s WHERE lower(s.email) = lower(u.email)) THEN NULL ELSE u.email END, p.user_id
    FROM profiles p JOIN auth.users u ON u.id = p.user_id
    WHERE p.role = 'admin' AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = p.user_id)$q$;
END $$;

-- 3) access functions read the links instead of profiles (same names, so views and policies keep working)
-- The app role of an account: staff.role ('admin', 'doctor', ...) or 'patient'; NULL while it is not linked yet.
-- Staff wins if the same person is also a patient. Only the server (Edge Functions with service_role) may ask for
-- someone else's role; a signed-in user asks for its own with my_role().
CREATE OR REPLACE FUNCTION role_of(uid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT coalesce((SELECT role FROM staff WHERE user_id = uid), (SELECT 'patient' FROM patient WHERE user_id = uid)) $$;
REVOKE ALL ON FUNCTION role_of(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION role_of(uuid) TO service_role;

CREATE OR REPLACE FUNCTION my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT role_of(auth.uid()) $$;
REVOKE ALL ON FUNCTION my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_role() TO authenticated, service_role;

-- Staff accounts (any staff role, admin included) may use the app; open sign-up alone must not grant access.
-- Defined here (not in 06_rls.sql) because the views in 05_views.sql call it.
CREATE OR REPLACE FUNCTION is_app_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid()) $$;
REVOKE ALL ON FUNCTION is_app_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_app_user() TO authenticated, service_role;

-- Only admins may change who an account belongs to or what role a staff member has (06_rls.sql).
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid() AND role = 'admin') $$;
REVOKE ALL ON FUNCTION is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, service_role;

-- Patient accounts: the patient row this account is linked to (NULL for staff-only and unlinked accounts).
-- Patients see and change only their own rows (policies and guards in 06_rls.sql).
CREATE OR REPLACE FUNCTION my_patient_id() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT patient_id FROM patient WHERE user_id = auth.uid() $$;
REVOKE ALL ON FUNCTION my_patient_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_patient_id() TO authenticated, service_role;


DROP TABLE IF EXISTS profiles CASCADE;   -- its policy goes with it

-- 4) only an admin may change account links, staff roles and staff e-mails
-- ===== Who an account belongs to: only an admin may change it =====
-- staff.user_id / patient.user_id link accounts, staff.role decides what a staff account may see, and staff.email is
-- what a new staff account is matched on at sign-up. Other staff can still edit names, phones, departments, etc.
-- The sign-up trigger, the SQL editor and service_role have no signed-in user, so they pass.
-- TRUE while Supabase deletes this account: auth.users no longer has it, and ON DELETE SET NULL is unlinking the row
-- that pointed at it. That unlink must always pass, otherwise deleting the account fails and its old token keeps
-- working (the JWT on the connection may even be the deleted user's own).
CREATE OR REPLACE FUNCTION is_account_unlink_on_delete(old_row jsonb, new_row jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT old_row->>'user_id' IS NOT NULL AND new_row->>'user_id' IS NULL
     AND (old_row - 'user_id') = (new_row - 'user_id')
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = (old_row->>'user_id')::uuid) $$;
REVOKE ALL ON FUNCTION is_account_unlink_on_delete(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Security definer: Supabase Auth's role (supabase_auth_admin) fires these triggers too, through the foreign keys.
CREATE OR REPLACE FUNCTION trg_account_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n jsonb := to_jsonb(NEW); o jsonb;
BEGIN
  IF no_signed_in_user() OR is_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND is_account_unlink_on_delete(to_jsonb(OLD), n) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF n->>'user_id' IS NOT NULL OR n->>'role' = 'admin' THEN
      RAISE EXCEPTION 'only an admin may link an account or create an admin' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    o := to_jsonb(OLD);
    IF n->'user_id' IS DISTINCT FROM o->'user_id' OR n->'role' IS DISTINCT FROM o->'role'
       OR (TG_TABLE_NAME = 'staff' AND n->'email' IS DISTINCT FROM o->'email') THEN
      RAISE EXCEPTION 'only an admin may change an account link, a staff role or a staff e-mail' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_account_link_guard ON staff;
CREATE TRIGGER staff_account_link_guard   BEFORE INSERT OR UPDATE ON staff   FOR EACH ROW EXECUTE FUNCTION trg_account_link_guard();
DROP TRIGGER IF EXISTS patient_account_link_guard ON patient;
CREATE TRIGGER patient_account_link_guard BEFORE INSERT OR UPDATE ON patient FOR EACH ROW EXECUTE FUNCTION trg_account_link_guard();

-- A patient may change only its contact details (phone, email, address).
CREATE OR REPLACE FUNCTION trg_patient_self_update_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF is_account_unlink_on_delete(to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;   -- account being deleted
  IF NOT is_app_user() AND my_patient_id() IS NOT NULL
     AND (NEW.patient_id, NEW.hn, NEW.national_id, NEW.first_name, NEW.last_name, NEW.birth_date, NEW.gender,
          NEW.blood_type, NEW.allergy_note, NEW.created_at, NEW.user_id)
     IS DISTINCT FROM (OLD.patient_id, OLD.hn, OLD.national_id, OLD.first_name, OLD.last_name, OLD.birth_date, OLD.gender,
          OLD.blood_type, OLD.allergy_note, OLD.created_at, OLD.user_id) THEN
    RAISE EXCEPTION 'a patient may change only phone, email and address' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- An older handle_new_user (an earlier attempt or the Supabase tutorial, often inserting into profiles) may already
-- exist and be called by a trigger on auth.users under another name: remove those triggers, then replace the function.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tg.tgname FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
           WHERE tg.tgrelid = 'auth.users'::regclass AND NOT tg.tgisinternal AND p.proname = 'handle_new_user' LOOP
    EXECUTE format('DROP TRIGGER %I ON auth.users', t.tgname);
  END LOOP;
END $$;

-- ===== Sign-up: link the new account automatically (no copying UUIDs by hand) =====
-- The web page calls supabase.auth.signUp with options.data = { account_type, ... }; Supabase stores that in
-- auth.users.raw_user_meta_data. This trigger runs inside the same transaction as the sign-up:
--   account_type 'patient': link to the existing medical record with the same national ID and birth date (a patient
--     registered before the website existed); if there is none, create a new patient row with a new HN.
--   anything else ('staff', or an account an admin created in the dashboard): link to the staff row whose e-mail
--     an admin entered beforehand. No such row = the account waits for an admin (signing up cannot make you staff).
-- An exception here cancels the sign-up (the page shows a message), so bad patient data never creates an account.
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m   jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  nid text  := nullif(trim(m->>'national_id'), '');
  bd  date;
  next_hn text;
BEGIN
  IF m->>'account_type' = 'patient' THEN
    IF nid IS NULL OR nid !~ '^[0-9]{13}$' THEN
      RAISE EXCEPTION 'national_id must be 13 digits' USING ERRCODE = 'check_violation';
    END IF;
    bd := nullif(m->>'birth_date', '')::date;
    -- 1) an existing record (same national ID and birth date) that has no account yet
    UPDATE patient SET user_id = NEW.id WHERE national_id = nid AND birth_date = bd AND user_id IS NULL;
    IF FOUND THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM patient WHERE national_id = nid) THEN
      RAISE EXCEPTION 'this national ID already has a record that does not match or is already linked' USING ERRCODE = 'unique_violation';
    END IF;
    -- 2) a new patient: next HN in the HN0001 format
    SELECT 'HN' || lpad((coalesce(max(substring(hn FROM 3)::int), 0) + 1)::text, 4, '0') INTO next_hn
      FROM patient WHERE hn ~ '^HN[0-9]+$';
    INSERT INTO patient (hn, national_id, first_name, last_name, birth_date, phone, email, user_id)
    VALUES (next_hn, nid, trim(m->>'first_name'), trim(m->>'last_name'), bd, nullif(m->>'phone', ''),
            CASE WHEN EXISTS (SELECT 1 FROM patient WHERE lower(email) = lower(NEW.email)) THEN NULL ELSE NEW.email END,
            NEW.id);
  ELSE
    UPDATE staff SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- The other order: a staff member signed up first (account waiting), then an admin adds or corrects the staff row's
-- e-mail. Link that waiting account now, so the admin never handles UUIDs either. Only for an admin or the SQL editor:
-- other staff may not create or edit rows that would hand an account a staff role.
CREATE OR REPLACE FUNCTION trg_staff_link_waiting_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.email IS NOT NULL AND (no_signed_in_user() OR is_admin()) THEN
    NEW.user_id := (SELECT u.id FROM auth.users u
                    WHERE lower(u.email) = lower(NEW.email)
                      AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = u.id)
                    LIMIT 1);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_link_waiting_account ON staff;
CREATE TRIGGER staff_link_waiting_account BEFORE INSERT OR UPDATE OF email ON staff
  FOR EACH ROW EXECUTE FUNCTION trg_staff_link_waiting_account();

-- 5) demo admin (sign up with this e-mail to become admin), as in seed.sql
INSERT INTO staff (first_name, last_name, role, email)
SELECT 'ผู้ดูแล', 'ระบบ', 'admin', 'admin@hospital.example'
WHERE NOT EXISTS (SELECT 1 FROM staff WHERE lower(email) = 'admin@hospital.example');

COMMIT;
