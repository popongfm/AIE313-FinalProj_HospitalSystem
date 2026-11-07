# ผลการวิเคราะห์ด้วย SQL

ผลลัพธ์สร้างจากฐานข้อมูลข้อมูลจำลอง (seed 313) ด้วย `docs/report/gen_analysis_md.py` ช่อง "การแปลความหมาย" ให้สมาชิกผู้เขียนคำสั่งนั้นเติมเอง

## Q1 [JOIN] แพทย์แต่ละคนในแต่ละแผนกดูแลผู้ป่วย (visit) รายใดบ้าง ประเภทใด เมื่อไร (INNER JOIN 4 ตาราง)

```sql
SELECT d.name AS department, s.first_name || ' ' || s.last_name AS doctor, p.hn, v.visit_type, v.admit_date
FROM visit v
INNER JOIN patient p ON p.patient_id = v.patient_id
INNER JOIN staff s ON s.staff_id = v.staff_id
INNER JOIN department d ON d.department_id = s.department_id
ORDER BY d.name, doctor, v.admit_date
LIMIT 50;
```

**ผลลัพธ์** (50 แถว, แสดง 10 แถวแรก)

| department | doctor | hn | visit_type | admit_date |
|---|---|---|---|---|
| กุมารเวชกรรม | นภา ทองดี | HN0007 | IPD | 2026-07-08 09:30:00+07 |
| กุมารเวชกรรม | นภา ทองดี | HN0023 | OPD | 2026-08-09 10:00:00+07 |
| กุมารเวชกรรม | นภา ทองดี | HN0015 | OPD | 2026-08-12 13:00:00+07 |
| กุมารเวชกรรม | นภา ทองดี | HN0007 | IPD | 2026-09-18 08:00:00+07 |
| กุมารเวชกรรม | นภา ทองดี | HN0031 | IPD | 2026-09-26 14:30:00+07 |
| กุมารเวชกรรม | นภา ทองดี | HN0015 | OPD | 2026-10-09 15:15:00+07 |
| กุมารเวชกรรม | นภา ทองดี | HN0039 | OPD | 2026-10-25 17:45:00+07 |
| กุมารเวชกรรม | มาลี บุญมา | HN0017 | IPD | 2026-07-09 11:45:00+07 |
| กุมารเวชกรรม | มาลี บุญมา | HN0001 | IPD | 2026-07-30 12:30:00+07 |
| กุมารเวชกรรม | มาลี บุญมา | HN0033 | OPD | 2026-08-05 10:30:00+07 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q2 [JOIN] การจองคิวใดที่ยังไม่มีข้อเสนอแนะจากผู้ป่วย (LEFT JOIN + กรอง NULL)

```sql
SELECT b.booking_id, b.booking_date, s.first_name || ' ' || s.last_name AS doctor, p.hn, b.status
FROM booking b
INNER JOIN staff s ON s.staff_id = b.staff_id
INNER JOIN patient p ON p.patient_id = b.patient_id
LEFT JOIN feedback f ON f.booking_id = b.booking_id
WHERE f.feedback_id IS NULL AND b.status = 'completed'
ORDER BY b.booking_date DESC;
```

**ผลลัพธ์** (9 แถว)

| booking_id | booking_date | doctor | hn | status |
|---|---|---|---|---|
| 35 | 2026-11-03 | อนันต์ สุขสันต์ | HN0026 | completed |
| 36 | 2026-11-02 | พิมพ์ใจ พึ่งพา | HN0029 | completed |
| 45 | 2026-11-01 | ประเสริฐ รุ่งเรือง | HN0016 | completed |
| 42 | 2026-10-28 | ประเสริฐ รุ่งเรือง | HN0007 | completed |
| 43 | 2026-10-25 | ประเสริฐ รุ่งเรือง | HN0010 | completed |
| 48 | 2026-10-23 | มาลี บุญมา | HN0025 | completed |
| 49 | 2026-10-13 | ประเสริฐ รุ่งเรือง | HN0028 | completed |
| 32 | 2026-10-11 | อนันต์ สุขสันต์ | HN0017 | completed |
| 41 | 2026-10-08 | มาลี บุญมา | HN0004 | completed |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q3 [JOIN] ยาที่จ่ายแล้วแต่ละรายการ ใช้ lot ใด วันหมดอายุเมื่อไร และใครเป็นผู้จ่าย (INNER JOIN 6 ตาราง)

```sql
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
```

**ผลลัพธ์** (50 แถว, แสดง 10 แถวแรก)

| prescription_id | generic_name | lot_number | expiry_date | dispensed_quantity | pharmacist |
|---|---|---|---|---|---|
| 32 | Amlodipine | LOT-001-A | 2028-01-06 | 28 | รัตนา ใจดี |
| 19 | Amlodipine | LOT-001-A | 2028-01-06 | 35 | รัตนา ใจดี |
| 38 | Losartan | LOT-004-A | 2028-01-21 | 40 | จินตนา บุญมา |
| 4 | Omeprazole | LOT-005-A | 2028-01-26 | 54 | ชาติชาย ศรีสุข |
| 4 | Omeprazole | LOT-005-A | 2028-01-26 | 5 | ชาติชาย ศรีสุข |
| 28 | Paracetamol | LOT-006-A | 2028-01-31 | 10 | เอกชัย สุขสันต์ |
| 13 | Ibuprofen | LOT-007-A | 2028-02-05 | 30 | สุรชัย รุ่งเรือง |
| 17 | Cefalexin | LOT-009-A | 2028-02-15 | 18 | วารี พึ่งพา |
| 28 | Azithromycin | LOT-010-A | 2028-02-20 | 24 | จินตนา บุญมา |
| 12 | Azithromycin | LOT-010-A | 2028-02-20 | 53 | วารี พึ่งพา |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q4 [JOIN] ผู้ป่วยรายใดมีค่ารักษารวมสูงกว่าค่าเฉลี่ยของผู้ป่วยทั้งหมด (JOIN + Subquery)

```sql
SELECT p.hn, p.first_name, SUM(c.amount) AS total_charge
FROM patient p
INNER JOIN visit v ON v.patient_id = p.patient_id
INNER JOIN daily_charge c ON c.visit_id = v.visit_id
GROUP BY p.hn, p.first_name
HAVING SUM(c.amount) > (SELECT SUM(amount) / COUNT(DISTINCT v2.patient_id)
                        FROM daily_charge c2 INNER JOIN visit v2 ON v2.visit_id = c2.visit_id)
ORDER BY total_charge DESC;
```

**ผลลัพธ์** (10 แถว)

| hn | first_name | total_charge |
|---|---|---|
| HN0001 | สมชาย | 21244.02 |
| HN0017 | เอกชัย | 20603.49 |
| HN0007 | อนันต์ | 19570.68 |
| HN0004 | สุดา | 16428.56 |
| HN0011 | ปิยะ | 11702.42 |
| HN0037 | เอกชัย | 9597.16 |
| HN0014 | รัตนา | 7480.11 |
| HN0021 | สมชาย | 6735.19 |
| HN0034 | รัตนา | 5578.91 |
| HN0024 | สุดา | 5297.52 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q5 [AGG] ภาพรวมค่าใช้จ่าย: จำนวนรายการ ผู้ป่วยที่ไม่ซ้ำ ยอดรวม เฉลี่ย ต่ำสุด สูงสุด (ใช้ Aggregate ครบ + JOIN)

```sql
SELECT COUNT(*) AS charge_lines, COUNT(DISTINCT v.patient_id) AS distinct_patients,
       SUM(c.amount) AS total_amount, ROUND(AVG(c.amount), 2) AS avg_amount,
       MIN(c.amount) AS min_amount, MAX(c.amount) AS max_amount
FROM daily_charge c
INNER JOIN visit v ON v.visit_id = c.visit_id;
```

**ผลลัพธ์** (1 แถว)

| charge_lines | distinct_patients | total_amount | avg_amount | min_amount | max_amount |
|---|---|---|---|---|---|
| 120 | 40 | 208003.40 | 1733.36 | 161.91 | 5847.09 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q6 [AGG] จำนวนการจองแยกตามสถานะในแถวเดียว (Aggregate + CASE WHEN)

```sql
SELECT COUNT(*) AS total_bookings,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
FROM booking;
```

**ผลลัพธ์** (1 แถว)

| total_bookings | pending | confirmed | completed | cancelled |
|---|---|---|---|---|
| 50 | 9 | 18 | 19 | 4 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q7 [AGG] สต็อกยารวม วันหมดอายุที่ใกล้สุดและไกลสุด จากสถานะสต็อก

```sql
SELECT COUNT(*) AS stock_rows, SUM(quantity_on_hand) AS total_units,
       MIN(expiry_date) AS earliest_expiry, MAX(expiry_date) AS latest_expiry,
       SUM(CASE WHEN stock_status = 'REORDER_URGENT' THEN 1 ELSE 0 END) AS urgent_rows
FROM v_inventory_stock_status;
```

**ผลลัพธ์** (1 แถว)

| stock_rows | total_units | earliest_expiry | latest_expiry | urgent_rows |
|---|---|---|---|---|
| 45 | 15990 | 2026-12-07 | 2028-07-01 | 9 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q8 [AGG] ระยะเวลานอนโรงพยาบาลเฉลี่ย (วัน) เฉพาะผู้ป่วยในที่จำหน่ายแล้ว เทียบจำนวน visit แต่ละประเภท

```sql
SELECT COUNT(*) FILTER (WHERE visit_type = 'OPD') AS opd_visits,
       COUNT(*) FILTER (WHERE visit_type = 'IPD') AS ipd_visits,
       COUNT(*) FILTER (WHERE visit_type = 'ER') AS er_visits,
       ROUND(AVG(CASE WHEN visit_type = 'IPD' AND discharge_date IS NOT NULL
                      THEN EXTRACT(EPOCH FROM discharge_date - admit_date) / 86400 END)::numeric, 2) AS avg_ipd_days
FROM visit;
```

**ผลลัพธ์** (1 แถว)

| opd_visits | ipd_visits | er_visits | avg_ipd_days |
|---|---|---|---|
| 36 | 18 | 6 | 5.06 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q9 [GROUP] ค่ารักษารวมแยกตามแผนกและประเภทการรักษา พร้อมยอดรวมย่อย (GROUP BY หลายคอลัมน์ + ROLLUP)

```sql
SELECT d.name AS department, v.visit_type, SUM(c.amount) AS total_amount
FROM daily_charge c
INNER JOIN visit v ON v.visit_id = c.visit_id
INNER JOIN staff s ON s.staff_id = v.staff_id
INNER JOIN department d ON d.department_id = s.department_id
GROUP BY ROLLUP (d.name, v.visit_type)
ORDER BY d.name NULLS LAST, v.visit_type NULLS LAST;
```

**ผลลัพธ์** (22 แถว, แสดง 10 แถวแรก)

| department | visit_type | total_amount |
|---|---|---|
| กุมารเวชกรรม | IPD | 66055.06 |
| กุมารเวชกรรม | OPD | 16015.60 |
| กุมารเวชกรรม |  | 82070.66 |
| ฉุกเฉิน | ER | 2465.65 |
| ฉุกเฉิน | IPD | 16428.56 |
| ฉุกเฉิน | OPD | 8396.57 |
| ฉุกเฉิน |  | 27290.78 |
| ศัลยกรรม | ER | 4306.48 |
| ศัลยกรรม | IPD | 12777.63 |
| ศัลยกรรม | OPD | 13430.97 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q10 [GROUP] ยาที่ถูกสั่งในใบสั่งยาตั้งแต่ 3 ใบขึ้นไป (GROUP BY + HAVING)

```sql
SELECT dg.generic_name, COUNT(DISTINCT i.prescription_id) AS prescriptions, SUM(i.quantity) AS units
FROM prescription_item i
INNER JOIN drug dg ON dg.drug_id = i.drug_id
GROUP BY dg.generic_name
HAVING COUNT(DISTINCT i.prescription_id) >= 3
ORDER BY prescriptions DESC, dg.generic_name;
```

**ผลลัพธ์** (15 แถว, แสดง 10 แถวแรก)

| generic_name | prescriptions | units |
|---|---|---|
| Gliclazide | 8 | 291 |
| Metronidazole | 6 | 161 |
| Levothyroxine | 5 | 150 |
| Omeprazole | 5 | 209 |
| Prednisolone | 5 | 250 |
| Tramadol | 5 | 154 |
| Ciprofloxacin | 4 | 189 |
| Salbutamol | 4 | 132 |
| Azithromycin | 3 | 94 |
| Cetirizine | 3 | 130 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q11 [GROUP] จัดอันดับแพทย์ตามจำนวนการจองคิว (GROUP BY + RANK() OVER)

```sql
SELECT s.first_name || ' ' || s.last_name AS doctor, COUNT(*) AS bookings,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS rank_no
FROM booking b
INNER JOIN staff s ON s.staff_id = b.staff_id
GROUP BY s.staff_id, s.first_name, s.last_name
ORDER BY rank_no, doctor;
```

**ผลลัพธ์** (8 แถว)

| doctor | bookings | rank_no |
|---|---|---|
| ธนากร จันทร์เพ็ญ | 8 | 1 |
| ประเสริฐ รุ่งเรือง | 8 | 1 |
| มาลี บุญมา | 7 | 3 |
| อนันต์ สุขสันต์ | 7 | 3 |
| นภา ทองดี | 6 | 5 |
| พิมพ์ใจ พึ่งพา | 6 | 5 |
| ปิยะ วงศ์ใหญ่ | 5 | 7 |
| กัญญา แก้วมณี | 3 | 8 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q12 [GROUP] จำนวนการจองรายเดือนแยกตามสถานะ (GROUP BY 2 คอลัมน์)

```sql
SELECT to_char(booking_date, 'YYYY-MM') AS month, status, COUNT(*) AS bookings
FROM booking
GROUP BY to_char(booking_date, 'YYYY-MM'), status
ORDER BY month, status;
```

**ผลลัพธ์** (6 แถว)

| month | status | bookings |
|---|---|---|
| 2026-10 | cancelled | 3 |
| 2026-10 | completed | 14 |
| 2026-11 | cancelled | 1 |
| 2026-11 | completed | 5 |
| 2026-11 | confirmed | 18 |
| 2026-11 | pending | 9 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q13 [STAT] ค่าเฉลี่ย ส่วนเบี่ยงเบนมาตรฐาน และความแปรปรวนของค่ารักษาต่อรายการ แยกตามประเภทการรักษา

```sql
SELECT v.visit_type, ROUND(AVG(c.amount), 2) AS mean_amount,
       ROUND(STDDEV(c.amount), 2) AS stddev_amount, ROUND(VARIANCE(c.amount), 2) AS variance_amount
FROM daily_charge c
INNER JOIN visit v ON v.visit_id = c.visit_id
GROUP BY v.visit_type
ORDER BY v.visit_type;
```

**ผลลัพธ์** (3 แถว)

| visit_type | mean_amount | stddev_amount | variance_amount |
|---|---|---|---|
| ER | 776.37 | 439.42 | 193088.92 |
| IPD | 3688.81 | 1781.73 | 3174572.41 |
| OPD | 915.14 | 397.13 | 157710.95 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q14 [STAT] มัธยฐานของค่ารักษา และรหัสโรค (ICD) ที่พบบ่อยที่สุด (PERCENTILE_CONT, MODE)

```sql
SELECT (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) FROM daily_charge) AS median_charge,
       (SELECT MODE() WITHIN GROUP (ORDER BY icd_code) FROM diagnosis) AS most_common_icd;
```

**ผลลัพธ์** (1 แถว)

| median_charge | most_common_icd |
|---|---|
| 1147.605 | I10 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q15 [STAT] ยอดค่ารักษารายเดือนและอัตราการเปลี่ยนแปลงเทียบเดือนก่อน (LAG, ROUND)

```sql
WITH monthly AS (
  SELECT month, SUM(total_amount) AS total FROM v_visit_billing GROUP BY month
)
SELECT month, total,
       ROUND(100.0 * (total - LAG(total) OVER (ORDER BY month)) / NULLIF(LAG(total) OVER (ORDER BY month), 0), 1) AS pct_change
FROM monthly
ORDER BY month;
```

**ผลลัพธ์** (5 แถว)

| month | total | pct_change |
|---|---|---|
| 2026-07 | 88305.90 |  |
| 2026-08 | 44076.23 | -50.1 |
| 2026-09 | 41459.98 | -5.9 |
| 2026-10 | 32151.82 | -22.5 |
| 2026-11 | 2009.47 | -93.8 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q16 [STAT] ความสัมพันธ์ระหว่างจำนวนหน่วยที่สั่งกับต้นทุนยาที่จ่ายจริง (CORR)

```sql
SELECT ROUND(CORR(units_prescribed, dispensed_cost)::numeric, 3) AS corr_units_cost,
       COUNT(*) AS drugs_compared
FROM v_drug_cost_summary
WHERE units_prescribed > 0;
```

**ผลลัพธ์** (1 แถว)

| corr_units_cost | drugs_compared |
|---|---|
| 0.302 | 32 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q17 [DASH] D1: จำนวนการจองต่อแพทย์ต่อสถานะ

```sql
SELECT doctor_name, status, booking_count FROM v_doctor_workload ORDER BY doctor_name, status;
```

**ผลลัพธ์** (23 แถว, แสดง 10 แถวแรก)

| doctor_name | status | booking_count |
|---|---|---|
| กัญญา แก้วมณี | completed | 1 |
| กัญญา แก้วมณี | confirmed | 1 |
| กัญญา แก้วมณี | pending | 1 |
| ธนากร จันทร์เพ็ญ | completed | 2 |
| ธนากร จันทร์เพ็ญ | confirmed | 4 |
| ธนากร จันทร์เพ็ญ | pending | 2 |
| นภา ทองดี | cancelled | 2 |
| นภา ทองดี | completed | 2 |
| นภา ทองดี | confirmed | 2 |
| ประเสริฐ รุ่งเรือง | completed | 5 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q18 [DASH] D2: ค่ารักษารายเดือนแยกตามแผนก

```sql
SELECT department, month, SUM(total_amount) AS total_amount
FROM v_visit_billing
GROUP BY department, month
ORDER BY month, department;
```

**ผลลัพธ์** (22 แถว, แสดง 10 แถวแรก)

| department | month | total_amount |
|---|---|---|
| กุมารเวชกรรม | 2026-07 | 30488.03 |
| ฉุกเฉิน | 2026-07 | 20324.91 |
| ศัลยกรรม | 2026-07 | 10533.48 |
| สูตินรีเวชกรรม | 2026-07 | 2260.22 |
| ออร์โธปิดิกส์ | 2026-07 | 15624.53 |
| อายุรกรรม | 2026-07 | 9074.73 |
| กุมารเวชกรรม | 2026-08 | 18178.19 |
| ฉุกเฉิน | 2026-08 | 1590.70 |
| ศัลยกรรม | 2026-08 | 8170.86 |
| สูตินรีเวชกรรม | 2026-08 | 5578.91 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_

## Q19 [DASH] D3: ยาที่ต้องสั่งซื้อเพิ่ม (ต่ำกว่าจุดสั่งซื้อ)

```sql
SELECT generic_name, trade_name, lot_number, location, quantity_on_hand, reorder_point
FROM v_inventory_stock_status
WHERE stock_status = 'REORDER_URGENT'
ORDER BY quantity_on_hand;
```

**ผลลัพธ์** (9 แถว)

| generic_name | trade_name | lot_number | location | quantity_on_hand | reorder_point |
|---|---|---|---|---|---|
| Morphine | MST | LOT-015-A | คลัง D-07 | 18 | 100 |
| Metronidazole | Flagyl | LOT-035-A | คลัง D-09 | 19 | 100 |
| Gliclazide | Diamicron | LOT-025-A | คลัง B-08 | 24 | 100 |
| Omeprazole | Losec | LOT-005-B | คลัง A-05 | 26 | 100 |
| Azithromycin | Zithromax | LOT-010-A | คลัง C-02 | 31 | 100 |
| Famotidine | Pepcid | LOT-030-A | คลัง C-04 | 36 | 100 |
| Prednisolone | Deltasone | LOT-020-A | คลัง A-03 | 42 | 100 |
| Omeprazole | Losec | LOT-005-A | คลัง B-06 | 44 | 100 |
| Azithromycin | Zithromax | LOT-010-B | คลัง B-01 | 56 | 100 |

**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_
