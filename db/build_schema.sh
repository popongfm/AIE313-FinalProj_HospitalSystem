#!/usr/bin/env bash
# Concatenate db/00..08 into schema.sql (tables, constraints, views, RLS). Seed data stays in db/seed/seed.sql.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "-- AIE313 Hospital Information System: merged schema (PostgreSQL 15+ / Supabase)"
  echo "-- Order: core -> records -> booking -> pharmacy -> views -> RLS. Run once on an empty project."
  for f in db/0[0-9]_*.sql; do echo; echo "-- ===== $(basename "$f") ====="; cat "$f"; done
} > schema.sql
cp db/seed/seed.sql seed.sql
echo "wrote schema.sql ($(wc -l < schema.sql) lines) and seed.sql"
