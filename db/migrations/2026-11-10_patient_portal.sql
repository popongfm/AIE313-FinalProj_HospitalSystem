-- Migration for a Supabase project that already ran an earlier schema.sql (before the patient portal).
-- Run ONCE in the SQL editor, BEFORE deploying the Edge Functions of the same version (they call run_readonly_query(q, as_user)).
-- A new, empty project only needs schema.sql + seed.sql. Generated from db/01, 03, 05, 06, 07; the whole file is one transaction.
BEGIN;

-- 01_core.sql: helpers used by the views and policies
-- Patient accounts: the patient this user was linked to by an admin (NULL for staff, admins and unlinked accounts).
-- Patients see and change only their own rows (policies and guards in 06_rls.sql).
CREATE FUNCTION my_patient_id() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT patient_id FROM profiles WHERE user_id = auth.uid() AND role = 'patient' $$;
REVOKE ALL ON FUNCTION my_patient_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_patient_id() TO authenticated, service_role;

-- TRUE when no signed-in user is attached to the request: the SQL editor, the service_role key, or the chat RPC called
-- without a user. Security definer so roles without USAGE on schema auth (chat_reader) can call it inside the views.
CREATE FUNCTION no_signed_in_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT auth.uid() IS NULL $$;
REVOKE ALL ON FUNCTION no_signed_in_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION no_signed_in_user() TO authenticated, service_role;

-- 03_booking.sql: the doctor check must see staff even when a patient books
-- security definer: a patient booking a queue cannot read staff (RLS), but the check must still see the doctor
CREATE OR REPLACE FUNCTION trg_booking_staff_is_doctor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT role FROM staff WHERE staff_id = NEW.staff_id) IS DISTINCT FROM 'doctor' THEN
    RAISE EXCEPTION 'booking.staff_id must reference a doctor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 05_views.sql: same columns, new access rule
-- ===== Member A: booking =====
CREATE OR REPLACE VIEW v_booking_queue_today AS
SELECT b.booking_id, b.queue_no, b.booking_time, p.hn, p.first_name AS patient_first_name,
       s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department, b.symptom, b.status
FROM booking b
JOIN patient p ON p.patient_id = b.patient_id
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE b.booking_date = CURRENT_DATE AND ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR p.patient_id = my_patient_id())
ORDER BY s.staff_id, b.queue_no;

CREATE OR REPLACE VIEW v_doctor_workload AS
SELECT s.staff_id, s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department,
       b.status, COUNT(*) AS booking_count
FROM booking b
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR my_patient_id() IS NOT NULL)
GROUP BY s.staff_id, s.first_name, s.last_name, d.name, b.status;

CREATE OR REPLACE VIEW v_feedback_summary AS
SELECT s.staff_id, s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department,
       COUNT(f.feedback_id) AS feedback_count, MAX(f.created_at) AS latest_feedback_at
FROM feedback f
JOIN booking b ON b.booking_id = f.booking_id
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR my_patient_id() IS NOT NULL)
GROUP BY s.staff_id, s.first_name, s.last_name, d.name;

-- ===== Member C: records =====
CREATE OR REPLACE VIEW v_bed_occupancy AS
SELECT r.room_id, r.room_no, r.room_type, d.name AS department,
       COUNT(b.bed_id) AS total_beds,
       COUNT(*) FILTER (WHERE b.status = 'Occupied') AS occupied_beds,
       COUNT(*) FILTER (WHERE b.status = 'Available') AS available_beds,
       ROUND(100.0 * COUNT(*) FILTER (WHERE b.status = 'Occupied') / NULLIF(COUNT(b.bed_id), 0), 1) AS occupancy_pct
FROM room r
LEFT JOIN bed b ON b.room_id = r.room_id
LEFT JOIN department d ON d.department_id = r.department_id
WHERE ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR my_patient_id() IS NOT NULL)
GROUP BY r.room_id, r.room_no, r.room_type, d.name;

CREATE OR REPLACE VIEW v_visit_billing AS
SELECT v.visit_id, p.hn, p.first_name AS patient_first_name, v.visit_type, d.name AS department,
       to_char(c.charge_date, 'YYYY-MM') AS month, SUM(c.amount) AS total_amount, COUNT(*) AS charge_lines
FROM daily_charge c
JOIN visit v ON v.visit_id = c.visit_id
JOIN patient p ON p.patient_id = v.patient_id
LEFT JOIN staff s ON s.staff_id = v.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR p.patient_id = my_patient_id())
GROUP BY v.visit_id, p.hn, p.first_name, v.visit_type, d.name, to_char(c.charge_date, 'YYYY-MM');

CREATE OR REPLACE VIEW v_top_diagnosis AS
SELECT icd_code, MAX(description) AS description, COUNT(*) AS case_count,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS rank_no
FROM diagnosis
WHERE ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR my_patient_id() IS NOT NULL)
GROUP BY icd_code;

-- ===== Member B: pharmacy =====
CREATE OR REPLACE VIEW v_pharmacist_screening_queue AS
SELECT pr.prescription_id, pr.status AS prescription_status, pr.prescription_date,
       p.hn, p.first_name AS patient_first_name, p.allergy_note,
       s.first_name || ' ' || s.last_name AS doctor_name,
       i.item_id, d.generic_name, d.trade_name, d.is_high_alert,
       i.dosage, i.route, i.frequency, i.quantity, i.duration_days
FROM prescription pr
JOIN visit v ON v.visit_id = pr.visit_id
JOIN patient p ON p.patient_id = v.patient_id
JOIN staff s ON s.staff_id = pr.staff_id
JOIN prescription_item i ON i.prescription_id = pr.prescription_id
JOIN drug d ON d.drug_id = i.drug_id
WHERE pr.status IN ('Pending', 'Screened') AND ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR p.patient_id = my_patient_id());

CREATE OR REPLACE VIEW v_inventory_stock_status AS
SELECT inv.inventory_id, d.generic_name, d.trade_name, l.lot_number, l.expiry_date, inv.location,
       inv.quantity_on_hand, inv.reorder_point,
       CASE WHEN inv.quantity_on_hand <= inv.reorder_point THEN 'REORDER_URGENT'
            WHEN l.expiry_date <= CURRENT_DATE + 90 THEN 'NEAR_EXPIRY'
            ELSE 'NORMAL' END AS stock_status
FROM inventory inv
JOIN drug d ON d.drug_id = inv.drug_id
JOIN drug_lot l ON l.lot_id = inv.lot_id
WHERE ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR my_patient_id() IS NOT NULL);

CREATE OR REPLACE VIEW v_drug_cost_summary AS
WITH presc AS (
  SELECT drug_id, COUNT(DISTINCT prescription_id) AS total_prescriptions, SUM(quantity) AS units_prescribed
  FROM prescription_item GROUP BY drug_id),
disp AS (
  SELECT i.drug_id, SUM(dr.dispensed_quantity) AS units_dispensed, SUM(dr.dispensed_quantity * l.cost_per_unit) AS dispensed_cost
  FROM dispense_record dr
  JOIN prescription_item i ON i.item_id = dr.item_id
  JOIN drug_lot l ON l.lot_id = dr.lot_id
  GROUP BY i.drug_id)
SELECT d.drug_id, d.generic_name, d.trade_name,
       COALESCE(presc.total_prescriptions, 0) AS total_prescriptions,
       COALESCE(presc.units_prescribed, 0) AS units_prescribed,
       COALESCE(disp.units_dispensed, 0) AS units_dispensed,
       COALESCE(disp.dispensed_cost, 0) AS dispensed_cost
FROM drug d
LEFT JOIN presc ON presc.drug_id = d.drug_id
LEFT JOIN disp ON disp.drug_id = d.drug_id
WHERE ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR my_patient_id() IS NOT NULL);

-- 06_rls.sql: patient accounts
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

-- 07_chat_support.sql: chat answers follow the asking user's access
GRANT EXECUTE ON FUNCTION is_app_user(), my_patient_id(), no_signed_in_user() TO chat_reader;
DROP FUNCTION run_readonly_query(text);
-- RETURNS json (not jsonb): jsonb re-sorts object keys by length, so the chat table's columns came back in a different
-- order from the SELECT; json keeps them as written.
-- as_user: the signed-in user who asked (the Edge Function passes it after checking the token). It becomes auth.uid() for
-- this transaction, so the views' access rule applies to chat answers too (a patient sees only its own rows).
-- Only service_role may call this function; LLM SQL cannot call set_config (sqlGuard allow-list, MCP builds the SQL).
CREATE FUNCTION run_readonly_query(q text, as_user uuid DEFAULT NULL) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result json; caller text := current_setting('request.jwt.claim.sub', true);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(as_user::text, ''), true);   -- only for this query
  EXECUTE format('SELECT coalesce(json_agg(t), ''[]''::json) FROM (%s) t', q) INTO result;
  PERFORM set_config('request.jwt.claim.sub', coalesce(caller, ''), true);
  RETURN result;
END $$;
-- On Supabase "postgres" is not a superuser: giving the function to chat_reader requires being able to SET ROLE to it and
-- chat_reader holding CREATE on the schema. Grant both just for the ALTER, then take CREATE back.
GRANT chat_reader TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO chat_reader;
ALTER FUNCTION run_readonly_query(text, uuid) OWNER TO chat_reader;
REVOKE CREATE ON SCHEMA public FROM chat_reader;
REVOKE ALL ON FUNCTION run_readonly_query(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_readonly_query(text, uuid) TO service_role;

COMMIT;
