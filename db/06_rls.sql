-- Row Level Security: anon gets nothing; linked staff users (profiles) get the app tables and views.
-- (Fine-grained per-role policies can replace "authenticated_all" later.)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- is_app_user() is defined in 01_core.sql (the views in 05_views.sql use it too).

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF t <> 'profiles' THEN
      EXECUTE format('CREATE POLICY authenticated_all ON %I FOR ALL TO authenticated USING (is_app_user()) WITH CHECK (is_app_user())', t);
    END IF;
  END LOOP;
END $$;

-- A signed-in user may only READ their own profile row (roles are assigned by an admin, never self-service).
CREATE POLICY own_profile ON profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
