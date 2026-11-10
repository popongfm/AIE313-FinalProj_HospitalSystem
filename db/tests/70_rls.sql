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
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000bb', 'patient@x.th');
INSERT INTO profiles(user_id, role, patient_id) VALUES ('00000000-0000-0000-0000-0000000000bb', 'patient', current_setting('test.pid')::int);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE pid int := current_setting('test.pid')::int; my_hn text; v text; n bigint;
BEGIN
  ASSERT my_patient_id() = pid, 'my_patient_id() must return the linked patient';
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
