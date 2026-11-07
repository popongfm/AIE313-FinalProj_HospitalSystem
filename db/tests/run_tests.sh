#!/usr/bin/env bash
# Builds a fresh test database from db/0*.sql (+ seed if present) and runs db/tests/NN_*.sql.
# Uses PGHOST/PGPORT/PGUSER if set; otherwise starts a throwaway docker postgres:15.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=hospital_test
if [ -z "${PGHOST:-}" ]; then
  docker rm -f hospital-pg >/dev/null 2>&1 || true
  docker run -d --name hospital-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:15 >/dev/null
  export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=pw
  until pg_isready -q; do sleep 1; done
fi
P=(psql -X -q -v ON_ERROR_STOP=1)
"${P[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
P+=(-d "$DB")
"${P[@]}" -f db/tests/stub_auth.sql
for f in db/0*.sql; do [ -e "$f" ] && "${P[@]}" -f "$f"; done
fail=0
seeded=0
for t in db/tests/[0-9][0-9]_*.sql; do
  # tests numbered >= 50 expect seed data; earlier ones need an empty database
  n=$(basename "$t" | cut -c1-2)
  if [ "$seeded" = 0 ] && [ "$((10#$n))" -ge 50 ] && [ -f db/seed/seed.sql ]; then "${P[@]}" -f db/seed/seed.sql; seeded=1; fi
  # each test runs in its own rolled-back transaction so tests never see each other's rows
  if (echo 'BEGIN;'; cat "$t"; echo 'ROLLBACK;') | "${P[@]}" -t -A >/tmp/t.out 2>&1; then echo "PASS $t: $(grep -v "^ROLLBACK" /tmp/t.out | tail -n1)"; else echo "FAIL $t"; cat /tmp/t.out; fail=1; fi
done
exit $fail
