\i db/tests/helpers.sql
INSERT INTO department(name) VALUES ('Pharmacy');
INSERT INTO patient(hn,national_id,first_name,last_name) VALUES ('HN1','1100000000001','Anan','Ploy');
INSERT INTO staff(first_name,last_name,role,department_id) SELECT 'Doc','One','doctor',department_id FROM department;
INSERT INTO staff(first_name,last_name,role,department_id) SELECT 'Pharm','One','pharmacist',department_id FROM department;
INSERT INTO visit(patient_id,visit_type,admit_date) SELECT patient_id,'OPD',now() FROM patient;
INSERT INTO drug(generic_name,trade_name,dosage_form,strength,unit) VALUES ('Amlodipine','Norvasc','Tablet','5 mg','tab');
INSERT INTO drug_lot(drug_id,lot_number,manufacture_date,expiry_date,cost_per_unit,initial_quantity)
  SELECT drug_id,'L1','2026-01-01','2028-01-01',2.5,500 FROM drug;
INSERT INTO prescription(visit_id,staff_id) SELECT v.visit_id,s.staff_id FROM visit v, staff s WHERE s.role='doctor';
INSERT INTO prescription_item(prescription_id,drug_id,dosage,route,frequency,quantity,duration_days)
  SELECT p.prescription_id,d.drug_id,'1 tab','PO','OD',30,30 FROM prescription p, drug d;

SELECT pg_temp.expect_state($$INSERT INTO dispense_record(item_id,staff_id,lot_id,dispensed_quantity) SELECT i.item_id,s.staff_id,l.lot_id,0 FROM prescription_item i, staff s, drug_lot l WHERE s.role='pharmacist'$$, '23514');
SELECT pg_temp.expect_state($$INSERT INTO drug_lot(drug_id,lot_number,manufacture_date,expiry_date,cost_per_unit,initial_quantity) SELECT drug_id,'L1','2026-02-01','2028-02-01',1,10 FROM drug$$, '23505');
SELECT pg_temp.expect_state($$INSERT INTO inventory(drug_id,lot_id,location,quantity_on_hand) SELECT l.drug_id,l.lot_id,'A1',-1 FROM drug_lot l$$, '23514');
-- a doctor cannot dispense
SELECT pg_temp.expect_state($$INSERT INTO dispense_record(item_id,staff_id,lot_id,dispensed_quantity) SELECT i.item_id,s.staff_id,l.lot_id,5 FROM prescription_item i, staff s, drug_lot l WHERE s.role='doctor'$$, '23514');
-- a pharmacist can
INSERT INTO dispense_record(item_id,staff_id,lot_id,dispensed_quantity) SELECT i.item_id,s.staff_id,l.lot_id,5 FROM prescription_item i, staff s, drug_lot l WHERE s.role='pharmacist';
-- deleting a prescription removes its items (cascade)
DELETE FROM dispense_record; DELETE FROM prescription;
DO $$ BEGIN ASSERT (SELECT count(*) FROM prescription_item)=0, 'items must cascade'; END $$;
SELECT 'pharmacy ok' AS result;
