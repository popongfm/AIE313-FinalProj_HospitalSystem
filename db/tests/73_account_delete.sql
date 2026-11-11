-- Deleting an account in Supabase (Authentication -> Users -> Delete, or auth.admin.deleteUser) must succeed and unlink
-- the person row (ON DELETE SET NULL), even though only an admin may change user_id otherwise (trg_account_link_guard,
-- trg_patient_self_update_guard). Run as Supabase Auth's role, with and without a JWT subject on the connection.
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000f1', 'v@x.th'), ('00000000-0000-0000-0000-0000000000f2', 'vp@x.th'),
                                       ('00000000-0000-0000-0000-0000000000f3', 'v3@x.th');
UPDATE staff SET user_id = '00000000-0000-0000-0000-0000000000f1' WHERE staff_id = (SELECT min(staff_id) FROM staff WHERE role = 'pharmacist');
UPDATE patient SET user_id = '00000000-0000-0000-0000-0000000000f2' WHERE patient_id = (SELECT min(patient_id) FROM patient);
UPDATE staff SET user_id = '00000000-0000-0000-0000-0000000000f3' WHERE staff_id = (SELECT min(staff_id) FROM staff WHERE role = 'nurse');
-- worst case: the deleted user's own id is the JWT subject
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
SET LOCAL ROLE supabase_auth_admin;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000f1';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000f2';
SELECT set_config('request.jwt.claim.sub', '', true);
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000f3';
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM staff WHERE user_id IN ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3')), 'staff unlinked';
  ASSERT NOT EXISTS (SELECT 1 FROM patient WHERE user_id = '00000000-0000-0000-0000-0000000000f2'), 'patient unlinked';
  ASSERT (SELECT count(*) FROM auth.users WHERE email IN ('v@x.th', 'vp@x.th', 'v3@x.th')) = 0, 'accounts deleted';
END $$;
-- the exemption is only for a deleted account: a signed-in nurse still cannot unlink a living account
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000f4', 'n4@x.th'), ('00000000-0000-0000-0000-0000000000f5', 'n5@x.th');
UPDATE staff SET user_id = '00000000-0000-0000-0000-0000000000f4' WHERE staff_id = (SELECT max(staff_id) FROM staff WHERE role = 'nurse');
UPDATE patient SET user_id = '00000000-0000-0000-0000-0000000000f5' WHERE patient_id = (SELECT max(patient_id) FROM patient);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f4', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN UPDATE patient SET user_id = NULL WHERE user_id = '00000000-0000-0000-0000-0000000000f5'; RAISE EXCEPTION 'nurse unlinked a living account';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'account delete ok' AS result;
