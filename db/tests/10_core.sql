-- Task 2: core shared tables. Each block expects a specific SQLSTATE.
\i db/tests/helpers.sql

INSERT INTO department(name) VALUES ('Cardiology');
INSERT INTO staff(first_name,last_name,role,department_id,license_no) SELECT 'Somchai','Dee','doctor',department_id,'D-1' FROM department;
INSERT INTO patient(hn,national_id,first_name,last_name) VALUES ('HN1','1100000000001','Anan','Ploy');

SELECT pg_temp.expect_state($$INSERT INTO patient(hn,national_id,first_name,last_name,phone) VALUES ('HN2','1100000000002','A','B','12345')$$, '23514');
SELECT pg_temp.expect_state($$INSERT INTO patient(hn,national_id,first_name,last_name) VALUES ('HN1','1100000000003','A','B')$$, '23505');
SELECT pg_temp.expect_state($$INSERT INTO staff(first_name,last_name,role) VALUES ('A','B','janitor')$$, '23514');
SELECT pg_temp.expect_state($$DELETE FROM department WHERE name='Cardiology'$$, '23503');

-- accounts are linked by user_id in patient / staff (no profiles table); one account per row
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-000000000001','p@x.th');
UPDATE patient SET user_id = '00000000-0000-0000-0000-000000000001' WHERE hn='HN1';
SELECT pg_temp.expect_state($$INSERT INTO patient(hn,national_id,first_name,last_name,user_id) VALUES ('HN9','1100000000009','A','B','00000000-0000-0000-0000-000000000001')$$, '23505');
SELECT pg_temp.expect_state($$UPDATE patient SET user_id = '00000000-0000-0000-0000-0000000000ff' WHERE hn='HN1'$$, '23503');
DO $$ BEGIN ASSERT to_regclass('public.profiles') IS NULL, 'profiles table should be gone'; END $$;
-- deleting the account keeps the medical record and only unlinks it
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001';
DO $$ BEGIN ASSERT (SELECT user_id FROM patient WHERE hn='HN1') IS NULL, 'record must survive account deletion, unlinked'; END $$;
SELECT 'core ok' AS result;
