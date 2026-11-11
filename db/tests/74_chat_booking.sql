-- Chat booking action (08_chat_actions.sql): who may book for whom, proposal vs confirm, and the checks.
\i db/tests/helpers.sql
SELECT set_config('request.jwt.claim.sub', '', true);
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-0000-0000-0000000000b1', 'pt@x.th'), ('00000000-0000-0000-0000-0000000000b2', 'dr@x.th'),
                                       ('00000000-0000-0000-0000-0000000000b3', 'none@x.th');
UPDATE patient SET user_id = '00000000-0000-0000-0000-0000000000b1' WHERE patient_id = (SELECT min(patient_id) FROM patient);
UPDATE staff SET user_id = '00000000-0000-0000-0000-0000000000b2' WHERE staff_id = (SELECT min(staff_id) FROM staff WHERE role = 'nurse');
SELECT set_config('test.doc', (SELECT min(staff_id) FROM staff WHERE role = 'doctor')::text, true);
SELECT set_config('test.day', (hospital_today() + 30)::text, true);
SELECT set_config('test.other_hn', (SELECT hn FROM patient ORDER BY patient_id DESC LIMIT 1)::text, true);

DO $$
DECLARE r json; n_before int := (SELECT count(*) FROM booking); doc int := current_setting('test.doc')::int; day date := current_setting('test.day')::date;
BEGIN
  -- 1) patient: proposal does not write, confirm writes one pending booking for itself with the next queue number
  r := chat_book_appointment('00000000-0000-0000-0000-0000000000b1', doc::text, day, '10:00', 'ปวดหัว');
  ASSERT (r->>'confirmed')::boolean = false AND r->>'booking_id' IS NULL, 'proposal only';
  ASSERT (SELECT count(*) FROM booking) = n_before, 'proposal must not insert';
  ASSERT r->>'hn' = (SELECT hn FROM patient WHERE patient_id = (SELECT min(patient_id) FROM patient)), 'patient books for itself';
  r := chat_book_appointment('00000000-0000-0000-0000-0000000000b1', doc::text, day, '10:00', 'ปวดหัว', NULL, true);
  ASSERT (r->>'confirmed')::boolean AND r->>'booking_id' IS NOT NULL, 'confirmed';
  ASSERT (SELECT count(*) FROM booking) = n_before + 1, 'one booking inserted';
  ASSERT (SELECT status FROM booking WHERE booking_id = (r->>'booking_id')::int) = 'pending', 'pending';
  ASSERT (SELECT queue_no FROM booking WHERE booking_id = (r->>'booking_id')::int) = (r->>'queue_no')::int, 'queue number returned';
  ASSERT current_setting('request.jwt.claim.sub', true) = '', 'caller identity restored';

  -- 2) same doctor, date and time again: refused, and the message lists the taken times
  BEGIN PERFORM chat_book_appointment('00000000-0000-0000-0000-0000000000b1', doc::text, day, '10:00', NULL, NULL, true); RAISE EXCEPTION 'double booking allowed';
  EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM LIKE '%10:00%', 'taken times listed: ' || SQLERRM; END;

  -- 3) a patient may not book for another HN
  BEGIN PERFORM chat_book_appointment('00000000-0000-0000-0000-0000000000b1', doc::text, day, '11:00', NULL, current_setting('test.other_hn'), true);
    RAISE EXCEPTION 'patient booked for someone else';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 4) staff: HN required; with HN the booking is for that patient; queue number goes up
  BEGIN PERFORM chat_book_appointment('00000000-0000-0000-0000-0000000000b2', doc::text, day, '11:00'); RAISE EXCEPTION 'staff without HN';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM chat_book_appointment('00000000-0000-0000-0000-0000000000b2', doc::text, day, '11:00', NULL, 'HN9999'); RAISE EXCEPTION 'unknown HN accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  r := chat_book_appointment('00000000-0000-0000-0000-0000000000b2', doc::text, day, '11:00', 'ติดตามอาการ', lower(current_setting('test.other_hn')), true);
  ASSERT r->>'hn' = current_setting('test.other_hn'), 'staff booked for the named HN';
  ASSERT (SELECT patient_id FROM booking WHERE booking_id = (r->>'booking_id')::int) = (SELECT patient_id FROM patient WHERE hn = current_setting('test.other_hn')), 'right patient';
  ASSERT (r->>'queue_no')::int > 1, 'next queue number';

  -- 5) doctor by name (part of it), unknown name, past date
  r := chat_book_appointment('00000000-0000-0000-0000-0000000000b1', (SELECT first_name FROM staff WHERE staff_id = doc), day, '13:30');
  ASSERT (r->>'staff_id')::int = doc, 'doctor found by name';
  BEGIN PERFORM chat_book_appointment('00000000-0000-0000-0000-0000000000b1', 'ไม่มีหมอชื่อนี้', day, '13:30'); RAISE EXCEPTION 'unknown doctor accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM chat_book_appointment('00000000-0000-0000-0000-0000000000b1', doc::text, hospital_today() - 1, '13:30'); RAISE EXCEPTION 'past date accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM chat_book_appointment('00000000-0000-0000-0000-0000000000b1', (SELECT staff_id FROM staff WHERE role = 'nurse' LIMIT 1)::text, day, '13:30');
    RAISE EXCEPTION 'nurse accepted as doctor';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- 6) not linked / no user: nothing
  BEGIN PERFORM chat_book_appointment('00000000-0000-0000-0000-0000000000b3', doc::text, day, '14:00', NULL, NULL, true); RAISE EXCEPTION 'unlinked account booked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM chat_book_appointment(NULL, doc::text, day, '14:00', NULL, current_setting('test.other_hn'), true); RAISE EXCEPTION 'no user booked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 7) doctor list: linked accounts see doctors, unlinked see none
  ASSERT json_array_length(chat_doctor_directory('00000000-0000-0000-0000-0000000000b1')) > 0, 'patient sees doctors';
  ASSERT json_array_length(chat_doctor_directory('00000000-0000-0000-0000-0000000000b3')) = 0, 'unlinked sees none';
END $$;

-- 8) signed-in users cannot call the functions directly (only the Edge Function, as service_role)
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM chat_book_appointment(auth.uid(), '1', hospital_today() + 31, '09:00', NULL, NULL, true); RAISE EXCEPTION 'authenticated called chat_book_appointment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM chat_doctor_directory(auth.uid()); RAISE EXCEPTION 'authenticated called chat_doctor_directory';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'chat booking ok' AS result;
