-- Row Level Security: anon gets nothing; linked staff users (profiles) get the app tables and views;
-- patient accounts get only their own rows of patient, booking, visit and prescription (end of this file).
-- (Fine-grained per-staff-role policies can replace "authenticated_all" later.)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- is_app_user() is defined in 01_core.sql (the views in 05_views.sql use it too).

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF t <> 'profiles' THEN
      EXECUTE format('CREATE POLICY authenticated_all ON %I FOR ALL TO authenticated USING (is_app_user()) WITH CHECK (is_app_user())', t);
    END IF;
  END LOOP;
END $$;

-- A signed-in user may only READ their own profile row (roles are assigned by an admin, never self-service).
CREATE POLICY own_profile ON profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ===== Patient accounts (profiles.role = 'patient', linked to one patient row) =====
-- Policies are permissive, so these add to authenticated_all (staff/admin keep full access). A patient sees and changes
-- only its own rows; the guards below limit WHICH columns it may change. Every other table stays closed to patients.
CREATE POLICY patient_self_read   ON patient FOR SELECT TO authenticated USING (patient_id = my_patient_id());
CREATE POLICY patient_self_update ON patient FOR UPDATE TO authenticated
  USING (patient_id = my_patient_id()) WITH CHECK (patient_id = my_patient_id());
CREATE POLICY booking_own_read   ON booking FOR SELECT TO authenticated USING (patient_id = my_patient_id());
CREATE POLICY booking_own_insert ON booking FOR INSERT TO authenticated
  WITH CHECK (patient_id = my_patient_id() AND status = 'pending' AND visit_id IS NULL);
CREATE POLICY booking_own_update ON booking FOR UPDATE TO authenticated
  USING (patient_id = my_patient_id()) WITH CHECK (patient_id = my_patient_id());
CREATE POLICY visit_own_read ON visit FOR SELECT TO authenticated USING (patient_id = my_patient_id());
CREATE POLICY prescription_own_read ON prescription FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM visit v WHERE v.visit_id = prescription.visit_id AND v.patient_id = my_patient_id()));

-- A patient may change only its contact details (phone, email, address).
CREATE FUNCTION trg_patient_self_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_app_user() AND my_patient_id() IS NOT NULL
     AND (NEW.patient_id, NEW.hn, NEW.national_id, NEW.first_name, NEW.last_name, NEW.birth_date, NEW.gender,
          NEW.blood_type, NEW.allergy_note, NEW.created_at)
     IS DISTINCT FROM (OLD.patient_id, OLD.hn, OLD.national_id, OLD.first_name, OLD.last_name, OLD.birth_date, OLD.gender,
          OLD.blood_type, OLD.allergy_note, OLD.created_at) THEN
    RAISE EXCEPTION 'a patient may change only phone, email and address' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patient_self_update_guard BEFORE UPDATE ON patient FOR EACH ROW EXECUTE FUNCTION trg_patient_self_update_guard();

-- A patient books for itself (patient_id and the next queue number are filled in, the date may not be in the past) and
-- may later only cancel a pending/confirmed booking. Security definer: the queue number must count every patient's
-- bookings for that doctor and day, which RLS hides from the caller.
CREATE FUNCTION trg_booking_patient_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me int := my_patient_id();
BEGIN
  IF is_app_user() OR me IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.patient_id := coalesce(NEW.patient_id, me);
    IF NEW.booking_date < CURRENT_DATE THEN
      RAISE EXCEPTION 'booking date is in the past' USING ERRCODE = 'check_violation';
    END IF;
    NEW.queue_no := (SELECT coalesce(max(queue_no), 0) + 1 FROM booking WHERE staff_id = NEW.staff_id AND booking_date = NEW.booking_date);
  ELSIF NEW.status IS DISTINCT FROM 'cancelled' OR OLD.status NOT IN ('pending', 'confirmed')
     OR (NEW.patient_id, NEW.staff_id, NEW.visit_id, NEW.booking_date, NEW.booking_time, NEW.queue_no, NEW.symptom, NEW.created_at)
        IS DISTINCT FROM (OLD.patient_id, OLD.staff_id, OLD.visit_id, OLD.booking_date, OLD.booking_time, OLD.queue_no, OLD.symptom, OLD.created_at) THEN
    RAISE EXCEPTION 'a patient may only cancel a pending or confirmed booking' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_patient_guard BEFORE INSERT OR UPDATE ON booking FOR EACH ROW EXECUTE FUNCTION trg_booking_patient_guard();

-- Doctors a signed-in staff member or patient can book with (patients cannot read the staff table itself).
CREATE FUNCTION doctor_directory() RETURNS TABLE (staff_id int, doctor_name text, department text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.staff_id, s.first_name || ' ' || s.last_name, d.name
  FROM staff s LEFT JOIN department d ON d.department_id = s.department_id
  WHERE s.role = 'doctor' AND (is_app_user() OR my_patient_id() IS NOT NULL)
  ORDER BY d.name, s.first_name $$;
REVOKE ALL ON FUNCTION doctor_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION doctor_directory() TO authenticated, service_role;
