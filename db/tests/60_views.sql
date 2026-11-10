-- Task 6: the 9 allowlisted views.
DO $$
DECLARE v text; n bigint;
  names text[] := ARRAY['v_booking_queue_today','v_upcoming_bookings','v_doctor_workload','v_feedback_summary','v_bed_occupancy','v_visit_billing',
                        'v_top_diagnosis','v_pharmacist_screening_queue','v_inventory_stock_status','v_drug_cost_summary'];
BEGIN
  ASSERT (SELECT count(*) FROM pg_views WHERE schemaname = 'public') = 10, 'expected exactly 10 views in public';
  FOREACH v IN ARRAY names LOOP
    ASSERT to_regclass('public.' || v) IS NOT NULL, 'missing view ' || v;
    EXECUTE format('SELECT count(*) FROM %I', v) INTO n;
    ASSERT n >= 1, v || ' returned no rows';
  END LOOP;
  -- Review Focus 4: no PII columns in any chat-visible view
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = ANY (names)
                       AND column_name IN ('national_id','phone','email','address','birth_date')), 'PII column exposed in a view';
  ASSERT (SELECT count(*) = count(DISTINCT inventory_id) FROM v_inventory_stock_status), 'v_inventory_stock_status has duplicate inventory rows';
  -- column contracts used by dashboard D1-D3 and the analysis queries
  PERFORM doctor_name, status, booking_count FROM v_doctor_workload LIMIT 1;
  PERFORM department, month, total_amount FROM v_visit_billing LIMIT 1;
  PERFORM stock_status, quantity_on_hand, reorder_point FROM v_inventory_stock_status LIMIT 1;
  ASSERT EXISTS (SELECT 1 FROM v_inventory_stock_status WHERE stock_status = 'REORDER_URGENT'), 'seed should include a low-stock item';
END $$;
SELECT 'views ok' AS result;
