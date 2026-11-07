-- 9 chat-visible views (owner-rights so chat_reader needs no table access); none expose national_id/phone/email/address/birth_date.
-- Owner-rights views bypass the tables' RLS, so each view repeats the access rule itself:
--   (current_user NOT IN ('anon', 'authenticated') OR is_app_user())
-- API users (role authenticated) must be linked staff/admin; chat_reader (chat RPC), service_role and the owner pass.
-- Keep it inline: inside a SECURITY DEFINER wrapper current_user would be the owner and the check would always pass.
-- ===== Member A: booking =====
CREATE VIEW v_booking_queue_today AS
SELECT b.booking_id, b.queue_no, b.booking_time, p.hn, p.first_name AS patient_first_name,
       s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department, b.symptom, b.status
FROM booking b
JOIN patient p ON p.patient_id = b.patient_id
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE b.booking_date = CURRENT_DATE AND (current_user NOT IN ('anon', 'authenticated') OR is_app_user())
ORDER BY s.staff_id, b.queue_no;

CREATE VIEW v_doctor_workload AS
SELECT s.staff_id, s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department,
       b.status, COUNT(*) AS booking_count
FROM booking b
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE (current_user NOT IN ('anon', 'authenticated') OR is_app_user())
GROUP BY s.staff_id, s.first_name, s.last_name, d.name, b.status;

CREATE VIEW v_feedback_summary AS
SELECT s.staff_id, s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department,
       COUNT(f.feedback_id) AS feedback_count, MAX(f.created_at) AS latest_feedback_at
FROM feedback f
JOIN booking b ON b.booking_id = f.booking_id
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE (current_user NOT IN ('anon', 'authenticated') OR is_app_user())
GROUP BY s.staff_id, s.first_name, s.last_name, d.name;

-- ===== Member C: records =====
CREATE VIEW v_bed_occupancy AS
SELECT r.room_id, r.room_no, r.room_type, d.name AS department,
       COUNT(b.bed_id) AS total_beds,
       COUNT(*) FILTER (WHERE b.status = 'Occupied') AS occupied_beds,
       COUNT(*) FILTER (WHERE b.status = 'Available') AS available_beds,
       ROUND(100.0 * COUNT(*) FILTER (WHERE b.status = 'Occupied') / NULLIF(COUNT(b.bed_id), 0), 1) AS occupancy_pct
FROM room r
LEFT JOIN bed b ON b.room_id = r.room_id
LEFT JOIN department d ON d.department_id = r.department_id
WHERE (current_user NOT IN ('anon', 'authenticated') OR is_app_user())
GROUP BY r.room_id, r.room_no, r.room_type, d.name;

CREATE VIEW v_visit_billing AS
SELECT v.visit_id, p.hn, p.first_name AS patient_first_name, v.visit_type, d.name AS department,
       to_char(c.charge_date, 'YYYY-MM') AS month, SUM(c.amount) AS total_amount, COUNT(*) AS charge_lines
FROM daily_charge c
JOIN visit v ON v.visit_id = c.visit_id
JOIN patient p ON p.patient_id = v.patient_id
LEFT JOIN staff s ON s.staff_id = v.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE (current_user NOT IN ('anon', 'authenticated') OR is_app_user())
GROUP BY v.visit_id, p.hn, p.first_name, v.visit_type, d.name, to_char(c.charge_date, 'YYYY-MM');

CREATE VIEW v_top_diagnosis AS
SELECT icd_code, MAX(description) AS description, COUNT(*) AS case_count,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS rank_no
FROM diagnosis
WHERE (current_user NOT IN ('anon', 'authenticated') OR is_app_user())
GROUP BY icd_code;

-- ===== Member B: pharmacy =====
CREATE VIEW v_pharmacist_screening_queue AS
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
WHERE pr.status IN ('Pending', 'Screened') AND (current_user NOT IN ('anon', 'authenticated') OR is_app_user());

CREATE VIEW v_inventory_stock_status AS
SELECT inv.inventory_id, d.generic_name, d.trade_name, l.lot_number, l.expiry_date, inv.location,
       inv.quantity_on_hand, inv.reorder_point,
       CASE WHEN inv.quantity_on_hand <= inv.reorder_point THEN 'REORDER_URGENT'
            WHEN l.expiry_date <= CURRENT_DATE + 90 THEN 'NEAR_EXPIRY'
            ELSE 'NORMAL' END AS stock_status
FROM inventory inv
JOIN drug d ON d.drug_id = inv.drug_id
JOIN drug_lot l ON l.lot_id = inv.lot_id
WHERE (current_user NOT IN ('anon', 'authenticated') OR is_app_user());

CREATE VIEW v_drug_cost_summary AS
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
WHERE (current_user NOT IN ('anon', 'authenticated') OR is_app_user());
