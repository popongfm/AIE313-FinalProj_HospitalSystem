-- Thailand time (Asia/Bangkok, GMT+7): the database default, and "today" in views/checks even on a UTC connection.
DO $$ BEGIN
  ASSERT current_setting('TimeZone') = 'Asia/Bangkok', 'new connections use Asia/Bangkok, got ' || current_setting('TimeZone');
  ASSERT (SELECT setconfig::text FROM pg_db_role_setting WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()) AND setrole = 0) LIKE '%TimeZone=Asia/Bangkok%', 'database default';
  ASSERT to_char(now(), 'OF') = '+07', 'timestamptz output is GMT+7';
END $$;
SET LOCAL timezone TO 'UTC';   -- a connection that ignored the default
DO $$ BEGIN
  ASSERT hospital_today() = (now() AT TIME ZONE 'Asia/Bangkok')::date, 'hospital_today() is the Thai date on a UTC connection';
  ASSERT pg_get_viewdef('v_booking_queue_today') LIKE '%hospital_today()%' AND pg_get_viewdef('v_upcoming_bookings') LIKE '%hospital_today()%'
     AND pg_get_viewdef('v_inventory_stock_status') LIKE '%hospital_today()%', 'views use the Thai date, not CURRENT_DATE';
  ASSERT pg_get_functiondef('trg_booking_patient_guard'::regproc) LIKE '%hospital_today()%', 'past-date check uses the Thai date';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND definition ILIKE '%current_date%'), 'no view uses CURRENT_DATE';
END $$;
-- the chat query runs in Thai time even when the connection is UTC
DO $$ DECLARE r json; BEGIN
  r := run_readonly_query('select to_char(now(), ''OF'') as off, current_date = hospital_today() as same_day');
  ASSERT r->0->>'off' = '+07' AND (r->0->>'same_day')::boolean, 'run_readonly_query uses GMT+7: ' || r::text;
END $$;
SELECT 'timezone ok' AS result;
