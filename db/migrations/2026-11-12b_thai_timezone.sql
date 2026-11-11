-- Migration: Thailand time (Asia/Bangkok, GMT+7) everywhere. Safe to run again.
--   * the database default time zone (new connections: now(), CURRENT_DATE, timestamptz output in GMT+7)
--   * views and the patient past-date check use hospital_today() (the Thai date) instead of CURRENT_DATE
--   * the chat query function runs its SQL in Thai time
-- After running it, restart the project's connections so the API picks up the new default:
--   Supabase Dashboard -> Project Settings -> General -> Restart project (or wait for the pool to recycle).
BEGIN;
-- Thailand time: Asia/Bangkok (GMT+7, no daylight saving) for every new connection, so now(), CURRENT_DATE and the
-- timestamptz values the API returns are Thai time (Supabase starts in UTC). Also this session, for the rest of the file.
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Bangkok'); END $$;
SET timezone TO 'Asia/Bangkok';

-- "Today" in Thailand (Asia/Bangkok, GMT+7), whatever time zone a connection uses. Views and checks use this instead of
-- CURRENT_DATE so that between 00:00 and 07:00 Thai time "today" is not still yesterday (UTC).
CREATE OR REPLACE FUNCTION hospital_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;

CREATE OR REPLACE VIEW v_booking_queue_today AS
SELECT b.booking_id, b.queue_no, b.booking_time, p.hn, p.first_name AS patient_first_name,
       s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department, b.symptom, b.status
FROM booking b
JOIN patient p ON p.patient_id = b.patient_id
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE b.booking_date = hospital_today() AND ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR p.patient_id = my_patient_id())
ORDER BY s.staff_id, b.queue_no;

CREATE OR REPLACE VIEW v_upcoming_bookings AS
SELECT b.booking_id, b.booking_date, b.booking_time, b.queue_no, p.hn, p.first_name AS patient_first_name,
       s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department, b.symptom, b.status
FROM booking b
JOIN patient p ON p.patient_id = b.patient_id
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE b.booking_date >= hospital_today() AND ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR p.patient_id = my_patient_id())
ORDER BY b.booking_date, b.booking_time, s.staff_id;

CREATE OR REPLACE VIEW v_inventory_stock_status AS
SELECT inv.inventory_id, d.generic_name, d.trade_name, l.lot_number, l.expiry_date, inv.location,
       inv.quantity_on_hand, inv.reorder_point,
       CASE WHEN inv.quantity_on_hand <= inv.reorder_point THEN 'REORDER_URGENT'
            WHEN l.expiry_date <= hospital_today() + 90 THEN 'NEAR_EXPIRY'
            ELSE 'NORMAL' END AS stock_status
FROM inventory inv
JOIN drug d ON d.drug_id = inv.drug_id
JOIN drug_lot l ON l.lot_id = inv.lot_id
WHERE ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR my_patient_id() IS NOT NULL);

CREATE OR REPLACE FUNCTION trg_booking_patient_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me int := my_patient_id();
BEGIN
  IF is_app_user() OR me IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.patient_id := coalesce(NEW.patient_id, me);
    IF NEW.booking_date < hospital_today() THEN   -- Thai date (GMT+7)
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

-- run_readonly_query belongs to chat_reader; replacing it needs that role's privileges
DO $mig$
BEGIN
  BEGIN EXECUTE format('GRANT chat_reader TO %I', current_user); EXCEPTION WHEN others THEN NULL; END;
  EXECUTE $q$CREATE OR REPLACE FUNCTION run_readonly_query(q text, as_user uuid DEFAULT NULL) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result json; caller text := current_setting('request.jwt.claim.sub', true);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(as_user::text, ''), true);   -- only for this query
  PERFORM set_config('timezone', 'Asia/Bangkok', true);   -- CURRENT_DATE / now() in the model's SQL = Thai time (GMT+7)
  EXECUTE format('SELECT coalesce(json_agg(t), ''[]''::json) FROM (%s) t', q) INTO result;
  PERFORM set_config('request.jwt.claim.sub', coalesce(caller, ''), true);
  RETURN result;
END $$;$q$;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'run_readonly_query was not replaced (%); chat SQL still runs in Thai time through the database default', SQLERRM;
END $mig$;
COMMIT;
