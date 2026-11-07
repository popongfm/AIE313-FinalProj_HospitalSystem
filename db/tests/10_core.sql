-- Task 2: core shared tables. Each block expects a specific SQLSTATE.
\i db/tests/helpers.sql

INSERT INTO department(name) VALUES ('Cardiology');
INSERT INTO staff(first_name,last_name,role,department_id,license_no) SELECT 'Somchai','Dee','doctor',department_id,'D-1' FROM department;
INSERT INTO patient(hn,national_id,first_name,last_name) VALUES ('HN1','1100000000001','Anan','Ploy');

SELECT pg_temp.expect_state($$INSERT INTO patient(hn,national_id,first_name,last_name,phone) VALUES ('HN2','1100000000002','A','B','12345')$$, '23514');
SELECT pg_temp.expect_state($$INSERT INTO patient(hn,national_id,first_name,last_name) VALUES ('HN1','1100000000003','A','B')$$, '23505');
SELECT pg_temp.expect_state($$INSERT INTO staff(first_name,last_name,role) VALUES ('A','B','janitor')$$, '23514');
SELECT pg_temp.expect_state($$DELETE FROM department WHERE name='Cardiology'$$, '23503');

INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-000000000001','p@x.th');
SELECT pg_temp.expect_state($$INSERT INTO profiles(user_id,role,patient_id,staff_id) SELECT '00000000-0000-0000-0000-000000000001','patient',p.patient_id,s.staff_id FROM patient p, staff s$$, '23514');
INSERT INTO profiles(user_id,role,patient_id) SELECT '00000000-0000-0000-0000-000000000001','patient',patient_id FROM patient WHERE hn='HN1';
SELECT 'core ok' AS result;
