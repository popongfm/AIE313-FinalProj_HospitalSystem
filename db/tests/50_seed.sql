-- Task 6: seed data volume and logical consistency.
DO $$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient','visit','booking','feedback','diagnosis','lab_result','insurance_coverage','daily_charge',
                           'bed','drug','drug_lot','prescription','prescription_item','dispense_record','inventory','drug_allergy_record'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    ASSERT n >= 30, format('%s has only %s rows (need >= 30)', t, n);
  END LOOP;
  ASSERT (SELECT count(*) FROM staff) >= 20 AND (SELECT count(*) FROM department) >= 8, 'staff/department reference data too small';
  ASSERT NOT EXISTS (SELECT 1 FROM dispense_record dr JOIN prescription_item i USING (item_id) JOIN drug_lot l ON l.lot_id = dr.lot_id
                     WHERE l.drug_id <> i.drug_id), 'dispensed lot must belong to the prescribed drug';
  ASSERT NOT EXISTS (SELECT 1 FROM dispense_record dr JOIN drug_lot l USING (lot_id) WHERE l.expiry_date < dr.dispense_date::date),
         'dispensed an expired lot';
  ASSERT NOT EXISTS (SELECT 1 FROM admission a JOIN visit v USING (visit_id) WHERE v.visit_type <> 'IPD'), 'admission only for IPD visits';
  ASSERT (SELECT count(*) FROM booking WHERE booking_date = CURRENT_DATE) >= 5, 'need bookings dated today for v_booking_queue_today';
  -- sequences were advanced so new rows (CRUD) do not collide with seed ids
  INSERT INTO department(name) VALUES ('__probe__');
  DELETE FROM department WHERE name = '__probe__';
END $$;
SELECT 'seed ok' AS result;
