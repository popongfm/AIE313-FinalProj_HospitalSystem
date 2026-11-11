-- Sign-up trigger (handle_new_user in 01_core.sql): a new auth.users row links itself to patient / staff.
\i db/tests/helpers.sql
-- 1) a patient who already has a medical record (same national ID + birth date) -> linked to it, no new row
SELECT set_config('test.n_patient', (SELECT count(*) FROM patient)::text, true);
SELECT set_config('test.old', (SELECT patient_id FROM patient WHERE birth_date IS NOT NULL ORDER BY patient_id LIMIT 1)::text, true);
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT '00000000-0000-0000-0000-0000000000e1', 'old.patient@x.th',
       jsonb_build_object('account_type', 'patient', 'national_id', national_id, 'birth_date', birth_date::text, 'first_name', 'x', 'last_name', 'y')
FROM patient WHERE patient_id = current_setting('test.old')::int;
DO $$ BEGIN
  ASSERT (SELECT user_id FROM patient WHERE patient_id = current_setting('test.old')::int) = '00000000-0000-0000-0000-0000000000e1', 'existing record linked';
  ASSERT (SELECT count(*) FROM patient) = current_setting('test.n_patient')::int, 'no duplicate patient created';
  ASSERT role_of('00000000-0000-0000-0000-0000000000e1') = 'patient', 'role from the patient link';
END $$;

-- 2) a new patient -> new row with the next HN, linked
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e2', 'New.Patient@x.th',
  '{"account_type":"patient","national_id":"1234567890123","birth_date":"2000-01-31","first_name":" มานี ","last_name":"มีนา","phone":"0812345678"}');
DO $$ DECLARE p patient; BEGIN
  SELECT * INTO p FROM patient WHERE user_id = '00000000-0000-0000-0000-0000000000e2';
  ASSERT p.patient_id IS NOT NULL, 'new patient created';
  ASSERT p.first_name = 'มานี' AND p.national_id = '1234567890123' AND p.birth_date = '2000-01-31' AND p.phone = '0812345678', 'fields copied';
  ASSERT p.hn = 'HN' || lpad((SELECT max(substring(hn FROM 3)::int) FROM patient WHERE patient_id <> p.patient_id AND hn ~ '^HN[0-9]+$') + 1 || '', 4, '0'), 'next HN, got ' || p.hn;
  ASSERT p.email = 'New.Patient@x.th', 'e-mail copied';
END $$;

-- 3) refused (the whole sign-up fails): national ID of a record whose birth date does not match / already linked / bad ID
SELECT pg_temp.expect_state($$INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e3', 'a@x.th',
  '{"account_type":"patient","national_id":"1234567890123","birth_date":"1999-01-01","first_name":"a","last_name":"b"}')$$, '23505');
SELECT pg_temp.expect_state($$INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e3', 'a@x.th',
  '{"account_type":"patient","national_id":"1234567890123","birth_date":"2000-01-31","first_name":"a","last_name":"b"}')$$, '23505');
SELECT pg_temp.expect_state($$INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e3', 'a@x.th',
  '{"account_type":"patient","national_id":"12345","first_name":"a","last_name":"b"}')$$, '23514');
SELECT pg_temp.expect_state($$INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e3', 'a@x.th',
  '{"account_type":"patient","national_id":"5555555555555"}')$$, '23502');
DO $$ BEGIN ASSERT NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000e3'), 'refused sign-up left an account'; END $$;

-- 4) staff: linked to the staff row an admin prepared with the same e-mail (case-insensitive)
SELECT set_config('test.doc', (SELECT staff_id FROM staff WHERE role = 'doctor' AND email IS NOT NULL ORDER BY staff_id LIMIT 1)::text, true);
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT '00000000-0000-0000-0000-0000000000e4', upper(email), '{"account_type":"staff"}' FROM staff WHERE staff_id = current_setting('test.doc')::int;
DO $$ BEGIN
  ASSERT (SELECT user_id FROM staff WHERE staff_id = current_setting('test.doc')::int) = '00000000-0000-0000-0000-0000000000e4', 'staff linked by e-mail';
  ASSERT role_of('00000000-0000-0000-0000-0000000000e4') = 'doctor', 'role from staff.role';
END $$;
-- 5) staff e-mail nobody prepared -> account exists but has no role (waits for an admin); no staff row is created
SELECT set_config('test.n_staff', (SELECT count(*) FROM staff)::text, true);
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e5', 'stranger@x.th', '{"account_type":"staff"}');
-- 6) an account created without sign-up data (e.g. by an admin in the dashboard) and no matching staff row: unlinked
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ('00000000-0000-0000-0000-0000000000e6', 'x2@x.th', NULL);
DO $$ BEGIN
  ASSERT role_of('00000000-0000-0000-0000-0000000000e5') IS NULL AND role_of('00000000-0000-0000-0000-0000000000e6') IS NULL, 'unknown staff stays unlinked';
  ASSERT (SELECT count(*) FROM staff) = current_setting('test.n_staff')::int, 'sign-up never creates staff';
END $$;
-- 7) the other order: the stranger signed up first; an admin (here: SQL editor) now adds the staff row -> linked
INSERT INTO staff(first_name, last_name, role, email) VALUES ('ใหม่', 'มาก่อน', 'nurse', 'Stranger@x.th');
DO $$ BEGIN ASSERT role_of('00000000-0000-0000-0000-0000000000e5') = 'nurse', 'waiting account linked when its staff row is added'; END $$;
-- ...and when an admin corrects an e-mail
UPDATE staff SET email = 'x2@x.th' WHERE staff_id = (SELECT min(staff_id) FROM staff WHERE user_id IS NULL AND role = 'pharmacist');
DO $$ BEGIN ASSERT role_of('00000000-0000-0000-0000-0000000000e6') = 'pharmacist', 'waiting account linked when e-mail corrected'; END $$;
SELECT 'signup trigger ok' AS result;
