\i db/tests/helpers.sql
INSERT INTO department(name) VALUES ('GP');
INSERT INTO patient(hn,national_id,first_name,last_name) VALUES ('HN1','1100000000001','Anan','Ploy');
INSERT INTO staff(first_name,last_name,role,department_id) SELECT 'Doc','One','doctor',department_id FROM department;
INSERT INTO staff(first_name,last_name,role,department_id) SELECT 'Pharm','One','pharmacist',department_id FROM department;
INSERT INTO booking(patient_id,staff_id,booking_date,booking_time,queue_no)
  SELECT p.patient_id,s.staff_id,'2026-11-20','09:00',1 FROM patient p, staff s WHERE s.role='doctor';

-- same doctor/date/time -> unique violation (different queue_no)
SELECT pg_temp.expect_state($$INSERT INTO booking(patient_id,staff_id,booking_date,booking_time,queue_no) SELECT p.patient_id,s.staff_id,'2026-11-20','09:00',2 FROM patient p, staff s WHERE s.role='doctor'$$, '23505');
-- same doctor/date/queue_no -> unique violation (different time)
SELECT pg_temp.expect_state($$INSERT INTO booking(patient_id,staff_id,booking_date,booking_time,queue_no) SELECT p.patient_id,s.staff_id,'2026-11-20','10:00',1 FROM patient p, staff s WHERE s.role='doctor'$$, '23505');
-- a pharmacist cannot take bookings
SELECT pg_temp.expect_state($$INSERT INTO booking(patient_id,staff_id,booking_date,booking_time,queue_no) SELECT p.patient_id,s.staff_id,'2026-11-21','09:00',1 FROM patient p, staff s WHERE s.role='pharmacist'$$, '23514');
SELECT pg_temp.expect_state($$INSERT INTO booking(patient_id,staff_id,booking_date,booking_time,queue_no,status) SELECT p.patient_id,s.staff_id,'2026-11-22','09:00',1,'weird' FROM patient p, staff s WHERE s.role='doctor'$$, '23514');

-- deleting a booking keeps feedback but nulls the link
INSERT INTO feedback(patient_id,booking_id,message) SELECT patient_id,booking_id,'ดีมาก' FROM booking;
DELETE FROM booking;
DO $$ BEGIN ASSERT (SELECT count(*) FROM feedback WHERE booking_id IS NULL) = 1, 'feedback should survive with NULL booking_id'; END $$;
SELECT 'booking ok' AS result;
