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
  names text[] := ARRAY['v_booking_queue_today','v_upcoming_bookings','v_doctor_workload','v_feedback_summary','v_bed_occupancy','v_visit_billing',
                        'v_top_diagnosis','v_pharmacist_screening_queue','v_inventory_stock_status','v_drug_cost_summary'];
BEGIN
  FOREACH v IN ARRAY names LOOP
    EXECUTE format('SELECT count(*) FROM %I', v) INTO n;
    ASSERT n = 0, 'unlinked user must see no rows in ' || v || ', got ' || n;
  END LOOP;
END $$;
RESET ROLE;
-- a patient account sees and changes only its own rows (06_rls.sql "Patient accounts")
-- pick a patient that appears in every per-patient view: a pending prescription and a booking today
SELECT set_config('test.pid', (SELECT min(v.patient_id) FROM prescription pr JOIN visit v USING (visit_id)
  WHERE pr.status IN ('Pending', 'Screened') AND v.patient_id IN (SELECT patient_id FROM booking WHERE booking_date = CURRENT_DATE))::text, true);
SELECT set_config('test.other', (SELECT min(patient_id) FROM patient WHERE patient_id <> current_setting('test.pid')::int)::text, true);
SELECT set_config('test.n_booking', (SELECT count(*) FROM booking WHERE patient_id = current_setting('test.pid')::int)::text, true);
SELECT set_config('test.n_visit', (SELECT count(*) FROM visit WHERE patient_id = current_setting('test.pid')::int)::text, true);
SELECT set_config('test.n_rx', (SELECT count(*) FROM prescription pr JOIN visit v USING (visit_id) WHERE v.patient_id = current_setting('test.pid')::int)::text, true);
SELECT set_config('test.doctor', (SELECT min(staff_id) FROM staff WHERE role = 'doctor')::text, true);
SELECT set_config('request.jwt.claim.sub', '', true);   -- set up links as the SQL editor would
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000bb', 'patient@x.th');
UPDATE patient SET user_id = '00000000-0000-0000-0000-0000000000bb' WHERE patient_id = current_setting('test.pid')::int;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE pid int := current_setting('test.pid')::int; my_hn text; v text; n bigint;
BEGIN
  ASSERT my_patient_id() = pid, 'my_patient_id() must return the linked patient';
  ASSERT my_role() = 'patient' AND NOT is_app_user(), 'a patient account is not staff';
  ASSERT (SELECT count(*) FROM patient) = 1 AND (SELECT patient_id FROM patient) = pid, 'patient sees exactly its own patient row';
  SELECT hn INTO my_hn FROM patient;
  ASSERT (SELECT count(*) FROM booking) = current_setting('test.n_booking')::int AND NOT EXISTS (SELECT 1 FROM booking WHERE patient_id <> pid), 'own bookings only';
  ASSERT (SELECT count(*) FROM visit) = current_setting('test.n_visit')::int AND NOT EXISTS (SELECT 1 FROM visit WHERE patient_id <> pid), 'own visits only';
  ASSERT (SELECT count(*) FROM prescription) = current_setting('test.n_rx')::int, 'own prescriptions only';
  ASSERT current_setting('test.n_visit')::int > 0 AND current_setting('test.n_rx')::int > 0, 'test patient should have visits and prescriptions';
  FOREACH v IN ARRAY ARRAY['staff','department','drug','inventory','daily_charge','diagnosis','prescription_item','feedback','admission','drug_allergy_record'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', v) INTO n;
    ASSERT n = 0, 'patient must not read ' || v || ', got ' || n;
  END LOOP;
  -- per-patient views: only its own rows, and not empty
  FOREACH v IN ARRAY ARRAY['v_booking_queue_today','v_upcoming_bookings','v_visit_billing','v_pharmacist_screening_queue'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', v) INTO n;
    ASSERT n > 0, v || ' should show the patient''s own rows';
    EXECUTE format('SELECT count(*) FROM %I WHERE hn IS DISTINCT FROM %L', v, my_hn) INTO n;
    ASSERT n = 0, v || ' shows ' || n || ' rows of other patients';
  END LOOP;
  -- summary views carry no patient identity and are shown in full
  FOREACH v IN ARRAY ARRAY['v_doctor_workload','v_feedback_summary','v_bed_occupancy','v_top_diagnosis','v_inventory_stock_status','v_drug_cost_summary'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', v) INTO n;
    ASSERT n > 0, 'patient should see summary view ' || v;
  END LOOP;
  ASSERT (SELECT count(*) FROM doctor_directory()) > 0, 'patient can list doctors to book with';
END $$;
-- contact details: allowed; anything else: refused
DO $$ BEGIN
  UPDATE patient SET phone = '0899999999', address = 'ที่อยู่ใหม่' WHERE patient_id = current_setting('test.pid')::int;
  ASSERT (SELECT phone FROM patient) = '0899999999', 'patient can change its own phone';
  BEGIN UPDATE patient SET first_name = 'x' WHERE patient_id = current_setting('test.pid')::int; RAISE EXCEPTION 'name change allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE patient SET allergy_note = 'ไม่แพ้ยา (แก้เอง)' WHERE patient_id = current_setting('test.pid')::int; RAISE EXCEPTION 'allergy change allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE patient SET user_id = NULL WHERE patient_id = current_setting('test.pid')::int; RAISE EXCEPTION 'patient unlinked itself';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE patient SET phone = '0811111111' WHERE patient_id = current_setting('test.other')::int;   -- RLS: matches no row
  BEGIN INSERT INTO patient(hn, national_id, first_name, last_name) VALUES ('HZ1', '1999999999999', 'a', 'b'); RAISE EXCEPTION 'patient insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- bookings: book for itself (queue number filled in), cancel; nothing else
DO $$
DECLARE pid int := current_setting('test.pid')::int; doc int := current_setting('test.doctor')::int; b booking;
BEGIN
  INSERT INTO booking(staff_id, booking_date, booking_time, symptom) VALUES (doc, CURRENT_DATE + 30, '15:45', 'ไอ') RETURNING * INTO b;
  ASSERT b.patient_id = pid AND b.status = 'pending' AND b.queue_no >= 1, 'own booking created with patient_id and queue number';
  BEGIN INSERT INTO booking(patient_id, staff_id, booking_date, booking_time) VALUES (current_setting('test.other')::int, doc, CURRENT_DATE + 30, '15:50');
    RAISE EXCEPTION 'booking for another patient allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO booking(staff_id, booking_date, booking_time, status) VALUES (doc, CURRENT_DATE + 30, '15:55', 'confirmed'); RAISE EXCEPTION 'self-confirmed booking allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO booking(staff_id, booking_date, booking_time) VALUES (doc, CURRENT_DATE - 1, '16:00'); RAISE EXCEPTION 'past booking allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE booking SET booking_time = '16:30' WHERE booking_id = b.booking_id; RAISE EXCEPTION 'reschedule allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE booking SET status = 'cancelled' WHERE booking_id = b.booking_id;
  ASSERT (SELECT status FROM booking WHERE booking_id = b.booking_id) = 'cancelled', 'patient can cancel its own booking';
  BEGIN UPDATE booking SET status = 'pending' WHERE booking_id = b.booking_id; RAISE EXCEPTION 'un-cancel allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM booking WHERE booking_id = b.booking_id;   -- no delete policy: matches no row
  PERFORM set_config('test.new_booking', b.booking_id::text, true);
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT phone FROM patient WHERE patient_id = current_setting('test.other')::int) IS DISTINCT FROM '0811111111', 'patient changed another patient';
  ASSERT EXISTS (SELECT 1 FROM booking WHERE booking_id = current_setting('test.new_booking')::int), 'patient deleted a booking';
  ASSERT (SELECT first_name FROM patient WHERE patient_id = current_setting('test.pid')::int) <> 'x', 'patient changed its name';
END $$;
-- a nurse: full app access, but cannot promote itself or anyone else, nor relink accounts
SELECT set_config('request.jwt.claim.sub', '', true);
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000dd', 'nurse@x.th');
UPDATE staff SET user_id = '00000000-0000-0000-0000-0000000000dd' WHERE staff_id = (SELECT min(staff_id) FROM staff WHERE role = 'nurse');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000dd', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT is_app_user() AND my_role() = 'nurse' AND my_patient_id() IS NULL, 'nurse is a staff account';
  ASSERT (SELECT count(*) FROM patient) >= 30, 'staff should read patient';
  UPDATE staff SET phone = '0812345678' WHERE user_id = auth.uid();   -- ordinary details: allowed
  BEGIN UPDATE staff SET role = 'admin' WHERE user_id = auth.uid(); RAISE EXCEPTION 'nurse promoted itself';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE staff SET email = 'mine@x.th' WHERE user_id IS NULL AND role = 'doctor'; RAISE EXCEPTION 'nurse changed a doctor e-mail (could claim the doctor at sign-up)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO staff(first_name, last_name, role) VALUES ('x', 'y', 'admin'); RAISE EXCEPTION 'nurse created an admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE patient SET user_id = auth.uid() WHERE patient_id = current_setting('test.other')::int; RAISE EXCEPTION 'nurse linked a patient';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- an admin (a staff row with role 'admin') may manage links and roles
SELECT set_config('request.jwt.claim.sub', '', true);   -- as in the SQL editor: no signed-in user
INSERT INTO staff(first_name, last_name, role, email, user_id) VALUES ('ผู้ดูแล', 'ระบบ', 'admin', 'staff@x.th', '00000000-0000-0000-0000-0000000000aa');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT is_admin() AND my_role() = 'admin', 'admin account';
  ASSERT (SELECT count(*) FROM patient) >= 30, 'authenticated should read patient';
  ASSERT (SELECT count(*) FROM v_doctor_workload) >= 1, 'authenticated should read views';
  INSERT INTO department(name) VALUES ('__rls_probe__');
  DELETE FROM department WHERE name = '__rls_probe__';
  UPDATE staff SET role = 'pharmacist' WHERE user_id = '00000000-0000-0000-0000-0000000000dd';
  ASSERT (SELECT role FROM staff WHERE user_id = '00000000-0000-0000-0000-0000000000dd') = 'pharmacist', 'admin can change a role';
END $$;
RESET ROLE;
-- a signed-in user without a link cannot link itself
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', true);
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000cc', 'u@x.th');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT my_role() IS NULL, 'unlinked account has no role';
  BEGIN INSERT INTO staff(first_name, last_name, role, user_id) VALUES ('a', 'b', 'admin', auth.uid()); RAISE EXCEPTION 'unlinked user inserted staff';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE staff SET user_id = auth.uid() WHERE user_id IS NULL;   -- RLS: matches no row
  BEGIN PERFORM role_of(auth.uid()); RAISE EXCEPTION 'authenticated must not call role_of';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN ASSERT NOT EXISTS (SELECT 1 FROM staff WHERE user_id = '00000000-0000-0000-0000-0000000000cc'), 'unlinked user linked itself'; END $$;
SELECT 'rls ok' AS result;
