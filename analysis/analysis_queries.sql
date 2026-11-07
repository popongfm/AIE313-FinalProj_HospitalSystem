-- =====================================================================
-- AIE313 Hospital Information System: analysis queries (PostgreSQL / Supabase)
-- Format per query:  -- Q<n> [GROUP] <business question>  followed by one statement.
-- Groups: JOIN, AGG (aggregate functions), GROUP (grouping), STAT (statistical/mathematical), DASH (dashboard/chat demo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- GROUP 1: SELECT JOIN TABLES
-- ---------------------------------------------------------------------

-- Q1 [JOIN] แพทย์แต่ละคนในแต่ละแผนกดูแลผู้ป่วย (visit) รายใดบ้าง ประเภทใด เมื่อไร (INNER JOIN 4 ตาราง)
SELECT d.name AS department, s.first_name || ' ' || s.last_name AS doctor, p.hn, v.visit_type, v.admit_date
FROM visit v
INNER JOIN patient p ON p.patient_id = v.patient_id
INNER JOIN staff s ON s.staff_id = v.staff_id
INNER JOIN department d ON d.department_id = s.department_id
ORDER BY d.name, doctor, v.admit_date
LIMIT 50;

-- Q2 [JOIN] การจองคิวใดที่ยังไม่มีข้อเสนอแนะจากผู้ป่วย (LEFT JOIN + กรอง NULL)
SELECT b.booking_id, b.booking_date, s.first_name || ' ' || s.last_name AS doctor, p.hn, b.status
FROM booking b
INNER JOIN staff s ON s.staff_id = b.staff_id
INNER JOIN patient p ON p.patient_id = b.patient_id
LEFT JOIN feedback f ON f.booking_id = b.booking_id
WHERE f.feedback_id IS NULL AND b.status = 'completed'
ORDER BY b.booking_date DESC;

-- Q3 [JOIN] ยาที่จ่ายแล้วแต่ละรายการ ใช้ lot ใด วันหมดอายุเมื่อไร และใครเป็นผู้จ่าย (INNER JOIN 6 ตาราง)
SELECT pr.prescription_id, dg.generic_name, dl.lot_number, dl.expiry_date, dr.dispensed_quantity,
       ph.first_name || ' ' || ph.last_name AS pharmacist
FROM dispense_record dr
INNER JOIN prescription_item i ON i.item_id = dr.item_id
INNER JOIN prescription pr ON pr.prescription_id = i.prescription_id
INNER JOIN drug dg ON dg.drug_id = i.drug_id
INNER JOIN drug_lot dl ON dl.lot_id = dr.lot_id
INNER JOIN staff ph ON ph.staff_id = dr.staff_id
ORDER BY dl.expiry_date
LIMIT 50;

-- Q4 [JOIN] ผู้ป่วยรายใดมีค่ารักษารวมสูงกว่าค่าเฉลี่ยของผู้ป่วยทั้งหมด (JOIN + Subquery)
SELECT p.hn, p.first_name, SUM(c.amount) AS total_charge
FROM patient p
INNER JOIN visit v ON v.patient_id = p.patient_id
INNER JOIN daily_charge c ON c.visit_id = v.visit_id
GROUP BY p.hn, p.first_name
HAVING SUM(c.amount) > (SELECT SUM(amount) / COUNT(DISTINCT v2.patient_id)
                        FROM daily_charge c2 INNER JOIN visit v2 ON v2.visit_id = c2.visit_id)
ORDER BY total_charge DESC;

-- ---------------------------------------------------------------------
-- GROUP 2: AGGREGATE FUNCTIONS
-- ---------------------------------------------------------------------

-- Q5 [AGG] ภาพรวมค่าใช้จ่าย: จำนวนรายการ ผู้ป่วยที่ไม่ซ้ำ ยอดรวม เฉลี่ย ต่ำสุด สูงสุด (ใช้ Aggregate ครบ + JOIN)
SELECT COUNT(*) AS charge_lines, COUNT(DISTINCT v.patient_id) AS distinct_patients,
       SUM(c.amount) AS total_amount, ROUND(AVG(c.amount), 2) AS avg_amount,
       MIN(c.amount) AS min_amount, MAX(c.amount) AS max_amount
FROM daily_charge c
INNER JOIN visit v ON v.visit_id = c.visit_id;

-- Q6 [AGG] จำนวนการจองแยกตามสถานะในแถวเดียว (Aggregate + CASE WHEN)
SELECT COUNT(*) AS total_bookings,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
FROM booking;

-- Q7 [AGG] สต็อกยารวม วันหมดอายุที่ใกล้สุดและไกลสุด จากสถานะสต็อก
SELECT COUNT(*) AS stock_rows, SUM(quantity_on_hand) AS total_units,
       MIN(expiry_date) AS earliest_expiry, MAX(expiry_date) AS latest_expiry,
       SUM(CASE WHEN stock_status = 'REORDER_URGENT' THEN 1 ELSE 0 END) AS urgent_rows
FROM v_inventory_stock_status;

-- Q8 [AGG] ระยะเวลานอนโรงพยาบาลเฉลี่ย (วัน) เฉพาะผู้ป่วยในที่จำหน่ายแล้ว เทียบจำนวน visit แต่ละประเภท
SELECT COUNT(*) FILTER (WHERE visit_type = 'OPD') AS opd_visits,
       COUNT(*) FILTER (WHERE visit_type = 'IPD') AS ipd_visits,
       COUNT(*) FILTER (WHERE visit_type = 'ER') AS er_visits,
       ROUND(AVG(CASE WHEN visit_type = 'IPD' AND discharge_date IS NOT NULL
                      THEN EXTRACT(EPOCH FROM discharge_date - admit_date) / 86400 END)::numeric, 2) AS avg_ipd_days
FROM visit;

-- ---------------------------------------------------------------------
-- GROUP 3: GROUPING FUNCTIONS
-- ---------------------------------------------------------------------

-- Q9 [GROUP] ค่ารักษารวมแยกตามแผนกและประเภทการรักษา พร้อมยอดรวมย่อย (GROUP BY หลายคอลัมน์ + ROLLUP)
SELECT d.name AS department, v.visit_type, SUM(c.amount) AS total_amount
FROM daily_charge c
INNER JOIN visit v ON v.visit_id = c.visit_id
INNER JOIN staff s ON s.staff_id = v.staff_id
INNER JOIN department d ON d.department_id = s.department_id
GROUP BY ROLLUP (d.name, v.visit_type)
ORDER BY d.name NULLS LAST, v.visit_type NULLS LAST;

-- Q10 [GROUP] ยาที่ถูกสั่งในใบสั่งยาตั้งแต่ 3 ใบขึ้นไป (GROUP BY + HAVING)
SELECT dg.generic_name, COUNT(DISTINCT i.prescription_id) AS prescriptions, SUM(i.quantity) AS units
FROM prescription_item i
INNER JOIN drug dg ON dg.drug_id = i.drug_id
GROUP BY dg.generic_name
HAVING COUNT(DISTINCT i.prescription_id) >= 3
ORDER BY prescriptions DESC, dg.generic_name;

-- Q11 [GROUP] จัดอันดับแพทย์ตามจำนวนการจองคิว (GROUP BY + RANK() OVER)
SELECT s.first_name || ' ' || s.last_name AS doctor, COUNT(*) AS bookings,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS rank_no
FROM booking b
INNER JOIN staff s ON s.staff_id = b.staff_id
GROUP BY s.staff_id, s.first_name, s.last_name
ORDER BY rank_no, doctor;

-- Q12 [GROUP] จำนวนการจองรายเดือนแยกตามสถานะ (GROUP BY 2 คอลัมน์)
SELECT to_char(booking_date, 'YYYY-MM') AS month, status, COUNT(*) AS bookings
FROM booking
GROUP BY to_char(booking_date, 'YYYY-MM'), status
ORDER BY month, status;

-- ---------------------------------------------------------------------
-- GROUP 4: STATISTICAL AND MATHEMATICAL FUNCTIONS
-- ---------------------------------------------------------------------

-- Q13 [STAT] ค่าเฉลี่ย ส่วนเบี่ยงเบนมาตรฐาน และความแปรปรวนของค่ารักษาต่อรายการ แยกตามประเภทการรักษา
SELECT v.visit_type, ROUND(AVG(c.amount), 2) AS mean_amount,
       ROUND(STDDEV(c.amount), 2) AS stddev_amount, ROUND(VARIANCE(c.amount), 2) AS variance_amount
FROM daily_charge c
INNER JOIN visit v ON v.visit_id = c.visit_id
GROUP BY v.visit_type
ORDER BY v.visit_type;

-- Q14 [STAT] มัธยฐานของค่ารักษา และรหัสโรค (ICD) ที่พบบ่อยที่สุด (PERCENTILE_CONT, MODE)
SELECT (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) FROM daily_charge) AS median_charge,
       (SELECT MODE() WITHIN GROUP (ORDER BY icd_code) FROM diagnosis) AS most_common_icd;

-- Q15 [STAT] ยอดค่ารักษารายเดือนและอัตราการเปลี่ยนแปลงเทียบเดือนก่อน (LAG, ROUND)
WITH monthly AS (
  SELECT month, SUM(total_amount) AS total FROM v_visit_billing GROUP BY month
)
SELECT month, total,
       ROUND(100.0 * (total - LAG(total) OVER (ORDER BY month)) / NULLIF(LAG(total) OVER (ORDER BY month), 0), 1) AS pct_change
FROM monthly
ORDER BY month;

-- Q16 [STAT] ความสัมพันธ์ระหว่างจำนวนหน่วยที่สั่งกับต้นทุนยาที่จ่ายจริง (CORR)
SELECT ROUND(CORR(units_prescribed, dispensed_cost)::numeric, 3) AS corr_units_cost,
       COUNT(*) AS drugs_compared
FROM v_drug_cost_summary
WHERE units_prescribed > 0;

-- ---------------------------------------------------------------------
-- DASHBOARD / CHAT DEMO QUERIES (shown on the web dashboard and answerable in Chat)
-- ---------------------------------------------------------------------

-- Q17 [DASH] D1: จำนวนการจองต่อแพทย์ต่อสถานะ
SELECT doctor_name, status, booking_count FROM v_doctor_workload ORDER BY doctor_name, status;

-- Q18 [DASH] D2: ค่ารักษารายเดือนแยกตามแผนก
SELECT department, month, SUM(total_amount) AS total_amount
FROM v_visit_billing
GROUP BY department, month
ORDER BY month, department;

-- Q19 [DASH] D3: ยาที่ต้องสั่งซื้อเพิ่ม (ต่ำกว่าจุดสั่งซื้อ)
SELECT generic_name, trade_name, lot_number, location, quantity_on_hand, reorder_point
FROM v_inventory_stock_status
WHERE stock_status = 'REORDER_URGENT'
ORDER BY quantity_on_hand;
