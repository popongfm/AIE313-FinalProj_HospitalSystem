\i db/tests/helpers.sql
-- ids are looked up, never hard-coded: identity sequences survive ROLLBACK
INSERT INTO department(name) VALUES ('IPD');
INSERT INTO patient(hn,national_id,first_name,last_name) VALUES ('HN1','1100000000001','Anan','Ploy');
INSERT INTO staff(first_name,last_name,role,department_id) SELECT 'Somchai','Dee','doctor',department_id FROM department WHERE name='IPD';
INSERT INTO visit(patient_id,staff_id,visit_type,admit_date)
  SELECT p.patient_id, s.staff_id, 'OPD', '2026-10-01 09:00+07' FROM patient p, staff s WHERE p.hn='HN1';

SELECT pg_temp.expect_state($$INSERT INTO visit(patient_id,visit_type,admit_date,discharge_date) SELECT patient_id,'IPD','2026-10-02 09:00+07','2026-10-01 09:00+07' FROM patient WHERE hn='HN1'$$, '23514');
SELECT pg_temp.expect_state($$INSERT INTO visit(patient_id,visit_type,admit_date) VALUES (-1,'OPD',now())$$, '23503');
SELECT pg_temp.expect_state($$DELETE FROM patient WHERE hn='HN1'$$, '23503');
SELECT pg_temp.expect_state($$INSERT INTO visit(patient_id,visit_type,admit_date) SELECT patient_id,'XYZ',now() FROM patient WHERE hn='HN1'$$, '23514');
SELECT pg_temp.expect_state($$INSERT INTO daily_charge(visit_id,charge_date,amount) SELECT visit_id,current_date,-5 FROM visit LIMIT 1$$, '23514');
INSERT INTO visit(patient_id,visit_type,admit_date) SELECT patient_id,'ER',now() FROM patient WHERE hn='HN1';
SELECT 'records ok' AS result;
