-- Task 7: chat_logs, chat_reader role, run_readonly_query RPC.
DO $$
DECLARE v text; n int;
  names text[] := ARRAY['v_booking_queue_today','v_doctor_workload','v_feedback_summary','v_bed_occupancy','v_visit_billing',
                        'v_top_diagnosis','v_pharmacist_screening_queue','v_inventory_stock_status','v_drug_cost_summary'];
BEGIN
  -- chat_reader: SELECT on the 9 views only, nothing on base tables
  FOREACH v IN ARRAY names LOOP
    ASSERT has_table_privilege('chat_reader', 'public.' || v, 'SELECT'), 'chat_reader must read ' || v;
  END LOOP;
  ASSERT NOT has_table_privilege('chat_reader', 'public.patient', 'SELECT'), 'chat_reader must not read patient';
  ASSERT NOT has_table_privilege('chat_reader', 'public.chat_logs', 'SELECT'), 'chat_reader must not read chat_logs';
  ASSERT pg_get_userbyid((SELECT proowner FROM pg_proc WHERE proname = 'run_readonly_query')) = 'chat_reader',
         'run_readonly_query must be owned by chat_reader';
  ASSERT NOT has_schema_privilege('chat_reader', 'public', 'CREATE'), 'chat_reader must not keep CREATE on public';
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE r json;
BEGIN
  r := run_readonly_query('select * from v_doctor_workload limit 1');
  ASSERT json_typeof(r) = 'array' AND json_array_length(r) = 1, 'view query should return 1 row';
  -- columns must come back in SELECT order (jsonb would re-sort them: status, department, doctor_name, booking_count)
  r := run_readonly_query('select doctor_name, department, status, booking_count from v_doctor_workload limit 1');
  ASSERT (SELECT array_agg(k ORDER BY n) FROM json_object_keys(r->0) WITH ORDINALITY AS x(k, n))
         = ARRAY['doctor_name','department','status','booking_count'], 'columns must keep SELECT order';
  -- the views' access check must let the chat role through
  ASSERT json_array_length(run_readonly_query('select * from v_pharmacist_screening_queue')) >= 1, 'chat must read view rows';
  ASSERT current_user = 'service_role', 'caller role must be restored, got ' || current_user;
  ASSERT run_readonly_query('select * from v_doctor_workload where false')::text = '[]', 'empty result must be []';
  BEGIN
    PERFORM run_readonly_query('select * from patient');
    RAISE EXCEPTION 'reading a base table must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- the query cannot escalate: role switching and string-executed SQL on base tables must fail
  BEGIN
    PERFORM run_readonly_query('select set_config(''role'',''service_role'',true)');
    RAISE EXCEPTION 'role switch must fail';
  EXCEPTION WHEN invalid_parameter_value OR insufficient_privilege OR feature_not_supported THEN NULL; END;
  BEGIN
    PERFORM run_readonly_query('select query_to_xml(''select national_id from patient'',true,true,'''') from v_doctor_workload');
    RAISE EXCEPTION 'string-executed SQL on patient must fail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- ordinary signed-in users cannot call the RPC
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM run_readonly_query('select 1');
  RAISE EXCEPTION 'authenticated must not execute run_readonly_query';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

-- chat_logs: a user writes and reads only their own rows; anon nothing
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO chat_logs(user_id, question, generated_sql, row_count) VALUES (auth.uid(), 'q1', 'select 1', 1);
  ASSERT (SELECT count(*) FROM chat_logs) = 1, 'own chat log visible';
END $$;
RESET ROLE;
INSERT INTO chat_logs(user_id, question) VALUES ('00000000-0000-0000-0000-0000000000bb', 'someone else');
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT (SELECT count(*) FROM chat_logs) = 1, 'other users chat logs must be hidden'; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM chat_logs;
  RAISE EXCEPTION 'anon must not read chat_logs';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT 'chat support ok' AS result;
