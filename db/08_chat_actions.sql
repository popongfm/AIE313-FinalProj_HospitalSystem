-- Chat (MCP) write action: the AI assistant may make ONE kind of change, an appointment (booking), and only as the
-- signed-in user who asked. The LLM never writes SQL here: the Edge Function calls these functions with fixed
-- parameters, and every rule is checked in the database:
--   * a patient account books only for itself (patient.user_id = the account)
--   * a staff account books for a patient it names by HN
--   * accounts that are not linked yet cannot book at all
-- p_confirm = false only checks and returns the proposal (the chat shows it with a "ยืนยันนัด" button);
-- p_confirm = true (sent when the user presses the button) inserts the booking.
-- Only service_role (the Edge Function, after checking the user's token) may call these functions.

CREATE FUNCTION chat_book_appointment(as_user uuid, p_doctor text, p_date date, p_time time,
                                      p_symptom text DEFAULT NULL, p_hn text DEFAULT NULL, p_confirm boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller   text := current_setting('request.jwt.claim.sub', true);
  is_staff boolean;
  me       int;
  pat      patient;
  doc      record;
  matches  int;
  q        int;
  b        booking;
  taken    text;
BEGIN
  -- act as the user who asked, so is_app_user() / my_patient_id() and the booking triggers see that user
  PERFORM set_config('request.jwt.claim.sub', coalesce(as_user::text, ''), true);
  PERFORM set_config('timezone', 'Asia/Bangkok', true);   -- Thai time (GMT+7) for this transaction
  is_staff := as_user IS NOT NULL AND is_app_user();
  me := CASE WHEN as_user IS NULL THEN NULL ELSE my_patient_id() END;
  IF NOT is_staff AND me IS NULL THEN
    RAISE EXCEPTION 'this account may not make appointments (not linked to a staff or patient record)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- whose appointment
  IF is_staff THEN
    IF nullif(trim(p_hn), '') IS NULL THEN
      RAISE EXCEPTION 'staff must give the patient''s HN (for example HN0001)' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT * INTO pat FROM patient WHERE hn = upper(trim(p_hn));
    IF NOT FOUND THEN RAISE EXCEPTION 'no patient with HN %', upper(trim(p_hn)) USING ERRCODE = 'no_data_found'; END IF;
  ELSE
    SELECT * INTO pat FROM patient WHERE patient_id = me;
    IF nullif(trim(p_hn), '') IS NOT NULL AND upper(trim(p_hn)) <> pat.hn THEN
      RAISE EXCEPTION 'a patient may make appointments only for itself' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- which doctor: staff_id, or part of the doctor's name
  SELECT count(*) INTO matches FROM staff s
  WHERE s.role = 'doctor' AND (CASE WHEN trim(p_doctor) ~ '^[0-9]+$' THEN s.staff_id = trim(p_doctor)::int
                                    ELSE (s.first_name || ' ' || s.last_name) ILIKE '%' || trim(p_doctor) || '%' END);
  IF matches = 0 THEN
    RAISE EXCEPTION 'no doctor matches "%"; call list_doctors', p_doctor USING ERRCODE = 'no_data_found';
  ELSIF matches > 1 THEN
    RAISE EXCEPTION 'several doctors match "%": %; ask which one', p_doctor,
      (SELECT string_agg(s.first_name || ' ' || s.last_name, ', ') FROM staff s
       WHERE s.role = 'doctor' AND (s.first_name || ' ' || s.last_name) ILIKE '%' || trim(p_doctor) || '%')
      USING ERRCODE = 'cardinality_violation';
  END IF;
  SELECT s.staff_id, s.first_name || ' ' || s.last_name AS name, d.name AS department INTO doc
  FROM staff s LEFT JOIN department d ON d.department_id = s.department_id
  WHERE s.role = 'doctor' AND (CASE WHEN trim(p_doctor) ~ '^[0-9]+$' THEN s.staff_id = trim(p_doctor)::int
                                    ELSE (s.first_name || ' ' || s.last_name) ILIKE '%' || trim(p_doctor) || '%' END);

  -- when
  IF p_date IS NULL OR p_time IS NULL THEN
    RAISE EXCEPTION 'date and time are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_date < hospital_today() THEN
    RAISE EXCEPTION 'date % is in the past (today is %)', p_date, hospital_today() USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM booking WHERE staff_id = doc.staff_id AND booking_date = p_date AND booking_time = p_time) THEN
    SELECT string_agg(to_char(booking_time, 'HH24:MI'), ', ' ORDER BY booking_time) INTO taken
    FROM booking WHERE staff_id = doc.staff_id AND booking_date = p_date;
    RAISE EXCEPTION 'doctor % already has an appointment at % on %; times already taken that day: %',
      doc.name, to_char(p_time, 'HH24:MI'), p_date, taken USING ERRCODE = 'unique_violation';
  END IF;
  q := (SELECT coalesce(max(queue_no), 0) + 1 FROM booking WHERE staff_id = doc.staff_id AND booking_date = p_date);

  IF p_confirm THEN
    INSERT INTO booking (patient_id, staff_id, booking_date, booking_time, queue_no, symptom, status)
    VALUES (pat.patient_id, doc.staff_id, p_date, p_time, q, nullif(trim(p_symptom), ''), 'pending')
    RETURNING * INTO b;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(caller, ''), true);
  RETURN json_build_object(
    'confirmed', p_confirm, 'booking_id', b.booking_id,
    'hn', pat.hn, 'patient_name', pat.first_name || ' ' || pat.last_name,
    'staff_id', doc.staff_id, 'doctor_name', doc.name, 'department', doc.department,
    'booking_date', p_date, 'booking_time', to_char(p_time, 'HH24:MI'),
    'queue_no', coalesce(b.queue_no, q), 'symptom', nullif(trim(p_symptom), ''), 'status', coalesce(b.status, 'pending'));
END $$;
REVOKE ALL ON FUNCTION chat_book_appointment(uuid, text, date, time, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_book_appointment(uuid, text, date, time, text, text, boolean) TO service_role;

-- Doctors the asking user may book with (same list the booking form uses), for the list_doctors chat tool.
CREATE FUNCTION chat_doctor_directory(as_user uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller text := current_setting('request.jwt.claim.sub', true); result json;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(as_user::text, ''), true);
  SELECT coalesce(json_agg(d), '[]'::json) INTO result FROM doctor_directory() d;   -- empty for unlinked accounts
  PERFORM set_config('request.jwt.claim.sub', coalesce(caller, ''), true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION chat_doctor_directory(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_doctor_directory(uuid) TO service_role;
