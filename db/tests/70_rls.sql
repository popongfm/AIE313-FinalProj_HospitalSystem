-- RLS: anon sees nothing; authenticated can use the app tables and views.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM patient;
  RAISE EXCEPTION 'anon must not read patient';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM 1 FROM v_doctor_workload;
  RAISE EXCEPTION 'anon must not read views';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
-- a signed-in user WITHOUT a profile (e.g. open sign-up) sees nothing
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000aa', 'staff@x.th');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM patient) = 0, 'unlinked user must see no patients';
  BEGIN INSERT INTO department(name) VALUES ('__x__'); RAISE EXCEPTION 'unlinked insert allowed';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO profiles(user_id, role) VALUES ('00000000-0000-0000-0000-0000000000aa', 'admin');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM patient) >= 30, 'authenticated should read patient';
  ASSERT (SELECT count(*) FROM v_doctor_workload) >= 1, 'authenticated should read views';
  INSERT INTO department(name) VALUES ('__rls_probe__');
  DELETE FROM department WHERE name = '__rls_probe__';
  ASSERT (SELECT count(*) FROM profiles) = 1, 'authenticated sees only its own profile';
END $$;
RESET ROLE;
-- a signed-in user cannot self-assign a role by inserting a profile
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', true);
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000cc', 'u@x.th');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO profiles(user_id, role) VALUES (auth.uid(), 'admin');
  RAISE EXCEPTION 'authenticated must not insert profiles';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT 'rls ok' AS result;
