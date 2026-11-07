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
-- ...including through the owner-rights views (they bypass table RLS, so they check is_app_user() themselves)
DO $$
DECLARE v text; n bigint;
  names text[] := ARRAY['v_booking_queue_today','v_doctor_workload','v_feedback_summary','v_bed_occupancy','v_visit_billing',
                        'v_top_diagnosis','v_pharmacist_screening_queue','v_inventory_stock_status','v_drug_cost_summary'];
BEGIN
  FOREACH v IN ARRAY names LOOP
    EXECUTE format('SELECT count(*) FROM %I', v) INTO n;
    ASSERT n = 0, 'unlinked user must see no rows in ' || v || ', got ' || n;
  END LOOP;
END $$;
RESET ROLE;
-- a user linked as role patient must not read other patients through the views either
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000bb', 'patient@x.th');
INSERT INTO profiles(user_id, role, patient_id) VALUES ('00000000-0000-0000-0000-0000000000bb', 'patient', (SELECT min(patient_id) FROM patient));
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT (SELECT count(*) FROM patient) = 0, 'patient-role user must see no patient rows'; END $$;
DO $$
DECLARE v text; n bigint;
  names text[] := ARRAY['v_booking_queue_today','v_doctor_workload','v_feedback_summary','v_bed_occupancy','v_visit_billing',
                        'v_top_diagnosis','v_pharmacist_screening_queue','v_inventory_stock_status','v_drug_cost_summary'];
BEGIN
  FOREACH v IN ARRAY names LOOP
    EXECUTE format('SELECT count(*) FROM %I', v) INTO n;
    ASSERT n = 0, 'patient-role user must see no rows in ' || v || ', got ' || n;
  END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
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
