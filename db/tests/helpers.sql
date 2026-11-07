-- shared test helper: \i db/tests/helpers.sql
CREATE OR REPLACE FUNCTION pg_temp.expect_state(stmt text, state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'expected % but statement succeeded: %', state, stmt;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> state THEN RAISE EXCEPTION 'expected % got % (%) for: %', state, SQLSTATE, SQLERRM, stmt; END IF;
END $$;
