-- Harness self-test: auth stub is loaded and auth.uid() is callable.
DO $$
BEGIN
  ASSERT to_regclass('auth.users') IS NOT NULL, 'auth.users stub missing';
  ASSERT auth.uid() IS NULL, 'auth.uid() should be NULL when claim unset';
  ASSERT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon')), 'role anon missing';
  ASSERT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'), 'role authenticated missing';
  ASSERT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role'), 'role service_role missing';
END $$;
SELECT 'harness ok' AS result;
