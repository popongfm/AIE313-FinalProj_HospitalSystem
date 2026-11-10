# AIE313 Hospital Information System + AI Chat — Implementation Plan

> **หมายเหตุ (แก้ไข 2026-11-10):** ไฟล์นี้เป็นแผนเริ่มต้น บางส่วนไม่ตรงกับโค้ดปัจจุบันแล้ว ให้ยึดตามโค้ดใน `db/` และ `README.md` และไม่ควรอ้างแผนนี้ในรายงาน
> - View ไม่ได้ใช้ `security_invoker` แต่เป็นแบบ owner-rights และเช็คสิทธิ์เองด้วย `(current_user NOT IN ('anon','authenticated') OR is_app_user())` (`db/05_views.sql`)
> - `run_readonly_query` คืนค่า `json` (ใช้ `json_agg`) ไม่ใช่ `jsonb` เพื่อให้ลำดับคอลัมน์ตรงกับ SELECT และเป็นของ role `chat_reader` (`db/07_chat_support.sql`)
> - Chat หลักคือ MCP (วิธี C) `chat-mcp` ส่วน Text-to-SQL (วิธี B) `chat` เป็นตัวสำรอง
> - หน้าเว็บมีปุ่มสมัครสมาชิก บัญชีใหม่จะเห็นข้อมูลเมื่อ admin ผูก profile แล้ว
> - เว็บ deploy เป็น Docker image (Docker Hub) บน Render แทน Vercel และ CI อยู่ใน `.github/workflows/ci.yml`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one merged hospital database on Supabase (booking + records + pharmacy), a deployed web app (Auth, CRUD, Views, Dashboard), and a read-only AI Chat that answers Thai/English questions from real data, plus every deliverable the course requires, by 2026-12-09.

**Architecture:** One Postgres schema built from numbered SQL files, with `visit` as the hub that links the three members' parts. A static HTML + supabase-js web app is deployed on Vercel. Chat is a Supabase Edge Function using Text-to-SQL (Method B): LLM writes SQL → `sqlGuard` validates → RPC runs it as a read-only role limited to allowlisted views → answer + SQL + raw table are returned.

**Tech Stack:** Supabase (PostgreSQL 15, Auth, Edge Functions/Deno), HTML + JS ES modules + supabase-js v2 (CDN), Vercel, Groq OpenAI-compatible API (model name in env `LLM_MODEL`, default `llama-3.3-70b-versatile`; confirm the name at implementation time), Docker `postgres:15` for local SQL tests, Python 3 for seed/coverage scripts, Node ≥18 (`node --test`) for web helper tests.

**Spec:** `AIE313_Mini_Project.pdf` (course brief, 2026-11-01) and `AIE313_Template.docx` (report template). Source schemas: `hospital_booking.sql` (member A), `hospital_medication_dispensing.sql` (member B), `demographic_hospital.sql` (member C).

**Owners:** A = booking, B = pharmacy/dispensing, C = medical records. "Shared" tasks are done together.

## Global Constraints

- Group ≤ 3 people; each member designs and presents their own DB part (conceptual, ER, relational schema, normalization, views).
- Tables ≥ 10 (this plan: 22). Views ≥ 6 (this plan: 9). Main tables ≥ 30 seed rows each.
- Merged DB must share tables across members: `patient`, `staff`, `department`, `profiles` (user link).
- SQL analysis: 4 groups × ≥ 4 = ≥ 16 queries, saved in `analysis_queries.sql`.
  - Join: ≥ 1 INNER JOIN over ≥ 3 tables.
  - Aggregate: COUNT(*), COUNT(DISTINCT), SUM, AVG, MIN, MAX all used; ≥ 1 with JOIN; ≥ 1 with CASE WHEN.
  - Grouping: ≥ 1 GROUP BY over > 1 column; ≥ 1 HAVING; ≥ 1 ROLLUP/window function (e.g. `RANK() OVER`).
  - Statistical: ≥ 2 of STDDEV, VARIANCE, MODE(), PERCENTILE_CONT, CORR, LAG.
- Web: Register/Login (Supabase Auth), CRUD on tables, show data from Views, Dashboard with ≥ 3 analysis results that are also answerable in Chat.
- Chat: history + input + loading state; answers from real DB data; shows evidence (SQL or tool/view name + raw table); handles ≥ 3 question types (lookup, JOIN/View, aggregation); report names the LLM used.
- Security: no API key / `service_role` key in the repo or browser code; chat is SELECT-only, allowlisted views only, row-limited; DELETE/DROP/UPDATE rejected.
- Bonus: log chats to `chat_logs`.
- Testing: Login/CRUD/View cases + ≥ 10 chat cases (≥ 2 dangerous), table format `question | SQL/Tool | expected | actual | pass/fail`.
- Merge decisions (replace the three source schemas where they conflict):
  - one `patient` (replaces `customers`, `patient`, `Patient`) and one `staff` with `role` (replaces `doctors`, `doctor`, `pharmacist`, `Staff`);
  - one `department`;
  - one `prescription` + `prescription_item` (B's design with `visit_id`; C's flat `Prescription` dropped);
  - no `password_hash` columns (Supabase Auth); `admins` becomes `profiles.role = 'admin'`;
  - `prescription` partitioning removed (YAGNI; data is small, composite FKs add risk);
  - source scripts' `DROP ... CASCADE` removed;
  - all views `WITH (security_invoker = true)` and without `national_id`, `phone`, `email`.
- Deliverables: report PDF (Template; TH Sarabun PSK 14pt, one column), slides PDF (group 10–15 min + ~5 min per member), `schema.sql`, `analysis_queries.sql`, dataset zip, deployed URL + GitHub link, demo video ≤ 5 min. Final deadline Wed **2026-12-09**.

## Review Focus

1. Chat question that smuggles SQL ("ลบข้อมูลผู้ป่วยทั้งหมด", `; DROP TABLE`, `SELECT ... FROM auth.users`, `pg_sleep`, SQL comments hiding a second statement) → rejected with a Thai message, nothing executed. (Task 11)
2. LLM returns non-SQL text, empty string, or invalid SQL → friendly error, HTTP 200 with `error`, no crash. (Task 11)
3. Query returns 0 rows → UI says "ไม่พบข้อมูล", not a blank table. (Tasks 11, 12)
4. PII (`national_id`, `phone`, `email`) never reachable through any allowlisted view or the chat role. (Tasks 6, 7)
5. CRUD violations: double-booking same doctor/time (23505), deleting a patient that has visits (23503) → readable Thai error, not a raw Postgres message or a silent failure; unauthenticated REST calls return no rows. (Tasks 7, 9, 10)

---

## File Structure

```
db/
  00_extensions.sql          01_core.sql           02_records.sql
  03_booking.sql             04_pharmacy.sql       05_views.sql
  06_rls.sql                 07_chat_support.sql
  build_schema.sh            # concatenates 00..07 -> schema.sql
  seed/generate_seed.py      seed/seed.sql (generated, committed)
  tests/stub_auth.sql  tests/run_tests.sh  tests/NN_*.sql
analysis/analysis_queries.sql  analysis/check_coverage.py
supabase/functions/chat/{index.ts,sqlGuard.ts,sqlGuard.test.ts,llm.ts,llm.test.ts,schemaPrompt.ts}
web/{index.html,app.html,config.example.js,css/app.css}
web/js/{supabaseClient.js,auth.js,errors.js,crud.js,views.js,dashboard.js,chat.js}
web/tests/errors.test.mjs
docs/{test-cases.md,er/,report/,slides/}
```

---

### Task 1: Repo skeleton and SQL test harness (Shared)

**Files:**
- Create: `db/tests/stub_auth.sql`, `db/tests/run_tests.sh`, `db/tests/00_harness.sql`, `.gitignore`, `README.md`
- Modify: none

**Interfaces:**
- Produces: `db/tests/run_tests.sh` — creates a fresh `postgres:15` container database `hospital_test`, loads `stub_auth.sql`, then `db/0*.sql` in order, optionally `db/seed/seed.sql`, then runs every `db/tests/[1-9]*.sql` with `ON_ERROR_STOP=1`; exit code ≠ 0 on any failure. `stub_auth.sql` defines schema `auth`, table `auth.users(id uuid primary key, email text)`, function `auth.uid() returns uuid` (reads `current_setting('request.jwt.claim.sub', true)`), and roles `anon`, `authenticated`, `service_role`.

- [ ] **Step 1: Write `db/tests/00_harness.sql`** — a `DO` block asserting `to_regclass('auth.users') IS NOT NULL` and `auth.uid()` is callable (returns NULL when the claim is unset).
- [ ] **Step 2: Run** `bash db/tests/run_tests.sh` — Expected: FAIL (script missing).
- [ ] **Step 3: Implement** `run_tests.sh` and `stub_auth.sql` as specified above; `.gitignore` lists `web/config.js`, `.env*`, `supabase/.env`. `README.md` documents the three env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (web) and `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Edge Function secrets only).
- [ ] **Step 4: Run** `bash db/tests/run_tests.sh` — Expected: `harness ok`, exit 0.
- [ ] **Step 5: Commit** `git init` (if needed) then `git add . && git commit -m "chore: repo skeleton and SQL test harness"`

---

### Task 2: Core shared tables (Shared — agree before A/B/C start)

**Files:**
- Create: `db/00_extensions.sql`, `db/01_core.sql`, `db/tests/10_core.sql`

**Interfaces:**
- Produces tables (all later tasks FK to these):
  - `department(department_id int identity PK, name varchar(100) unique not null, location varchar(100))`
  - `staff(staff_id int identity PK, first_name, last_name varchar(100) not null, role text check in ('doctor','pharmacist','nurse','technician'), department_id int FK department on update cascade on delete restrict, license_no varchar(50) unique, phone char(10) check ~ '^[0-9]{10}$', email varchar(100) unique)`
  - `patient(patient_id int identity PK, hn varchar(20) unique not null, national_id varchar(13) unique not null, first_name, last_name varchar(100) not null, birth_date date, gender char(1) check in ('M','F','O'), phone char(10) check ~ '^[0-9]{10}$', email varchar(100) unique, address varchar(255), blood_type varchar(5), allergy_note text, created_at timestamptz default now())`
  - `profiles(user_id uuid PK FK auth.users on delete cascade, role text check in ('admin','doctor','pharmacist','nurse','patient') not null, patient_id int FK patient, staff_id int FK staff)`; constraint: `role='admin'` → both ids null; `role='patient'` → only `patient_id`; other roles → only `staff_id`.

- [ ] **Step 1: Write `10_core.sql` test** asserting: inserting a patient with phone `'12345'` raises `check_violation`; duplicate `hn` raises `unique_violation`; a `profiles` row with role `patient` and `staff_id` set raises `check_violation`; deleting a department that has staff raises `foreign_key_violation`.
- [ ] **Step 2: Run** `bash db/tests/run_tests.sh` — Expected: FAIL (tables missing).
- [ ] **Step 3: Implement** `00_extensions.sql` (none required beyond defaults; leave a comment) and `01_core.sql` per the Interfaces block.
- [ ] **Step 4: Run** tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): core shared tables`

---

### Task 3: Medical records module (C)

**Files:**
- Create: `db/02_records.sql`, `db/tests/20_records.sql`

**Interfaces:**
- Consumes: `patient(patient_id)`, `staff(staff_id)`, `department(department_id)`.
- Produces: `room(room_id, room_no, room_type, department_id FK, capacity)`, `bed(bed_id, room_id FK, bed_no, status check in ('Available','Occupied','Maintenance') default 'Available')`, `visit(visit_id, patient_id FK not null, staff_id FK, visit_type check in ('OPD','IPD','ER'), admit_date timestamptz not null, discharge_date timestamptz, status varchar(30))` with `check (discharge_date is null or discharge_date >= admit_date)`, `admission(admission_id, visit_id FK, bed_id FK, assigned_date, released_date)`, `diagnosis(diagnosis_id, visit_id FK, icd_code, description, diagnosed_date)`, `lab_result(lab_id, visit_id FK, test_name, result_value, test_date)`, `insurance_coverage(insurance_id, patient_id FK, provider_name, policy_no, coverage_type)`, `daily_charge(charge_id, visit_id FK, charge_date date, item_description, amount numeric(12,2) check >= 0)`. Keep C's `idx_visit_type_date` index.

- [ ] **Step 1: Write test** `20_records.sql`: discharge before admit raises `check_violation`; a visit with unknown `patient_id` raises `foreign_key_violation`; deleting a patient that has a visit raises `foreign_key_violation` (supports Review Focus 5).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `02_records.sql` from `demographic_hospital.sql`, minus `Patient`, `Staff`, `Department`, `Prescription` and all `DROP`/`ENABLE ROW LEVEL SECURITY` lines (RLS moves to Task 7).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): records module`

---

### Task 4: Booking module (A)

**Files:**
- Create: `db/03_booking.sql`, `db/tests/30_booking.sql`

**Interfaces:**
- Consumes: `patient`, `staff` (role doctor), `visit(visit_id)`.
- Produces: `booking(booking_id, patient_id FK not null, staff_id FK not null, visit_id FK null, booking_date date, booking_time time, queue_no smallint check > 0, symptom text, status check in ('pending','confirmed','completed','cancelled') default 'pending', created_at)` with `uq_doctor_day_queue (staff_id, booking_date, queue_no)` and `uq_doctor_day_time (staff_id, booking_date, booking_time)`; `feedback(feedback_id, patient_id FK on delete cascade, booking_id FK on delete set null, message not null, created_at)`; indexes `idx_bookings_patient`, `idx_date_status` as in A's script.
- Add trigger `trg_booking_staff_is_doctor` that raises if `staff.role <> 'doctor'`.

- [ ] **Step 1: Write test**: two bookings with same doctor/date/time raise `unique_violation`; booking with a pharmacist as `staff_id` raises exception; deleting a booking sets `feedback.booking_id` to NULL.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** from `hospital_booking.sql`, dropping `customers`, `departments`, `doctors`, `admins`, `password_hash`; rename FKs to `patient_id`/`staff_id`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): booking module`

---

### Task 5: Pharmacy module (B)

**Files:**
- Create: `db/04_pharmacy.sql`, `db/tests/40_pharmacy.sql`

**Interfaces:**
- Consumes: `visit`, `staff` (doctor/pharmacist), `patient`.
- Produces: `drug`, `drug_lot`, `prescription(prescription_id identity PK, visit_id FK not null, staff_id FK not null, prescription_date timestamptz default now(), status check in ('Pending','Screened','Dispensed','Cancelled') default 'Pending', total_price numeric(10,2) default 0)`, `prescription_item(item_id, prescription_id FK on delete cascade, drug_id FK, dosage, route, frequency, quantity > 0, duration_days > 0, instruction)`, `dispense_record(dispense_id, item_id FK, staff_id FK (pharmacist), lot_id FK, dispense_date, dispensed_quantity int > 0, status_code check in ('DP','VF','CN'))`, `inventory(inventory_id, drug_id, lot_id, location varchar(50) not null, quantity_on_hand >= 0, reorder_point default 100, last_updated)`, `drug_allergy_record(allergy_id, patient_id FK on delete cascade, drug_id FK, reaction_details, severity, recorded_date)`. Keep B's FEFO index `idx_drug_lot_fefo` and partial index `idx_prescription_pending`. Same table/column definitions as `hospital_medication_dispensing.sql` for `drug` and `drug_lot`.

- [ ] **Step 1: Write test**: `dispensed_quantity = 0` raises `check_violation`; two lots with same `(drug_id, lot_number)` raise `unique_violation`; `quantity_on_hand = -1` raises `check_violation`; a dispense by a doctor (non-pharmacist `staff_id`) raises (add trigger `trg_dispense_staff_is_pharmacist`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `04_pharmacy.sql` from B's Sections 1.4–1.10 and Section 2 indexes; drop sections for patient/doctor/pharmacist, partitioning and the views (views move to Task 6).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): pharmacy module`

---

### Task 6: Seed data and Views (Shared; each member owns their data + views)

**Files:**
- Create: `db/seed/generate_seed.py`, `db/seed/seed.sql`, `db/05_views.sql`, `db/tests/50_seed.sql`, `db/tests/60_views.sql`

**Interfaces:**
- Produces: `python db/seed/generate_seed.py --seed 313 > db/seed/seed.sql` (deterministic; Thai names and realistic dates in 2026, all FKs consistent: every booking's patient/doctor exists; dispense lot expiry ≥ dispense date). Row counts: patient 40, staff 20 (8 doctors, 6 pharmacists, 4 nurses, 2 technicians), department 8, visit 60, booking 50, prescription 45, prescription_item ≥ 90, drug 35, drug_lot 45, dispense_record 60, inventory 45, diagnosis 60, daily_charge ≥ 100, feedback 30, others ≥ 30.
- Views (all `CREATE VIEW ... WITH (security_invoker = true)`; none expose `national_id`, `phone`, `email`; patients appear as `hn` + first name only):
  - A: `v_booking_queue_today`, `v_doctor_workload`, `v_feedback_summary`
  - C: `v_bed_occupancy`, `v_visit_billing`, `v_top_diagnosis`
  - B: `v_pharmacist_screening_queue`, `v_inventory_stock_status`, `v_drug_cost_summary`
  - `v_inventory_stock_status` joins lots per `inventory` row (no duplicate rows per lot); no cross joins anywhere.

- [ ] **Step 1: Write tests.** `50_seed.sql` asserts each main table has ≥ 30 rows (list in the test) and `NOT EXISTS` orphan FKs. `60_views.sql` asserts: 9 views exist in `public`; each returns ≥ 1 row; each has `reloptions` containing `security_invoker=true`; `information_schema.columns` for those views contains none of `national_id`, `phone`, `email` (Review Focus 4); `v_inventory_stock_status` has no duplicate `inventory_id`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the generator (Faker is optional; stdlib `random` with fixed seed is enough) and `05_views.sql`. B's views derive from `hospital_medication_dispensing.sql` sections 3.2, 3.5, 3.6 with the join fixes noted in Global Constraints.
- [ ] **Step 4: Run** `python db/seed/generate_seed.py --seed 313 > db/seed/seed.sql && bash db/tests/run_tests.sh` — Expected: all PASS; running the generator twice produces identical files (`diff` is empty).
- [ ] **Step 5: Commit** `feat(db): seed data and views`

---

### Task 7: RLS, roles and chat support objects (Shared)

**Files:**
- Create: `db/06_rls.sql`, `db/07_chat_support.sql`, `db/build_schema.sh`, `db/tests/70_rls.sql`, `db/tests/71_chat_support.sql`

**Interfaces:**
- Produces: policies — `authenticated` may SELECT/INSERT/UPDATE/DELETE all tables except `chat_logs`, `profiles` (own row only: `user_id = auth.uid()`); `anon` has no grants on any table or view (Review Focus 5). Trigger `on_auth_user_created` inserts a `profiles` row with role `patient` and a matching new `patient` row is NOT auto-created (profile is linked by an admin or in Task 9's sign-up flow).
- `chat_logs(chat_id identity PK, user_id uuid, question text not null, generated_sql text, tool_name text, row_count int, error text, created_at timestamptz default now())`.
- Role `chat_reader` (NOLOGIN) with `GRANT SELECT` on only the 9 views from Task 6.
- `run_readonly_query(q text) returns jsonb` — `SECURITY DEFINER`, `SET search_path = public`; inside: `SET LOCAL ROLE chat_reader; SET LOCAL statement_timeout = '3s';` then `execute format('select coalesce(jsonb_agg(t), ''[]'') from (%s) t', q)`; `GRANT EXECUTE` to `service_role` only, `REVOKE` from `public`.
- `db/build_schema.sh` concatenates `00..07` + `seed/seed.sql` into `schema.sql` (deliverable) in order.

- [ ] **Step 1: Write tests.** `70_rls.sql`: as `anon`, `select * from patient` raises `insufficient_privilege`. `71_chat_support.sql`: as `service_role`, `run_readonly_query('select * from v_doctor_workload limit 1')` returns a 1-element jsonb array; `run_readonly_query('select * from patient')` raises `insufficient_privilege`; `run_readonly_query('select pg_sleep(5)')` raises `query_canceled`; `run_readonly_query('select * from v_doctor_workload where false')` returns `[]`; as `authenticated`, executing the function raises `insufficient_privilege`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the files per Interfaces.
- [ ] **Step 4: Run** tests + `bash db/build_schema.sh` and apply `schema.sql` to the Supabase project via the SQL editor — Expected: tests PASS; Supabase table editor shows 22 tables, 9 views.
- [ ] **Step 5: Commit** `feat(db): RLS, chat_reader role and read-only query RPC`

---

### Task 8: Analysis queries (Shared; each member writes ≥ 4 for their module)

**Files:**
- Create: `analysis/analysis_queries.sql`, `analysis/check_coverage.py`

**Interfaces:**
- Produces: queries delimited by header comments `-- Q<n> [JOIN|AGG|GROUP|STAT] <Thai business question>` followed by one SQL statement. `check_coverage.py <file>` exits non-zero unless: ≥ 4 queries per tag; at least one INNER JOIN with ≥ 3 tables; all of `COUNT(*)`, `COUNT(DISTINCT`, `SUM(`, `AVG(`, `MIN(`, `MAX(` appear; an aggregate with `JOIN`; an aggregate with `CASE WHEN`; a `GROUP BY` with ≥ 2 columns; `HAVING`; `ROLLUP` or `OVER (`; ≥ 2 of `STDDEV`, `VARIANCE`, `MODE()`, `PERCENTILE_CONT`, `CORR`, `LAG`. It also executes every query via `psql` against `$DATABASE_URL` and requires ≥ 1 row.
- Queries must also cover three dashboard analyses reused in Task 10: **Q-D1** bookings per doctor per status, **Q-D2** monthly billing per department, **Q-D3** drugs below reorder point. (Each is backed by an existing view.)

- [ ] **Step 1: Write `check_coverage.py`** first (it is the test) and run it on an empty file — Expected: FAIL listing every missing requirement.
- [ ] **Step 2: Write the 16+ queries**; each of the 9 views from Task 6 should be derivable from at least one query.
- [ ] **Step 3: Run** `python analysis/check_coverage.py analysis/analysis_queries.sql` — Expected: `OK: 16+ queries, all constructs covered`.
- [ ] **Step 4: Capture** result screenshots and a one-line Thai interpretation per query in `docs/report/analysis.md` (required report format: question | SQL | result image | interpretation).
- [ ] **Step 5: Commit** `feat(analysis): 16 analysis queries with coverage check`

---

### Task 9: Web — auth shell and error helper (Shared; C owns)

**Files:**
- Create: `web/index.html`, `web/app.html`, `web/config.example.js`, `web/js/supabaseClient.js`, `web/js/auth.js`, `web/js/errors.js`, `web/css/app.css`, `web/tests/errors.test.mjs`

**Interfaces:**
- Produces:
  - `errors.js`: `export function friendlyError(err: {code?: string, message?: string} | null): string` — `'23505'` → "ข้อมูลซ้ำ มีรายการนี้อยู่แล้ว"; `'23503'` → "ลบ/แก้ไขไม่ได้ เพราะมีข้อมูลอื่นอ้างอิงอยู่"; `'23514'` → "ข้อมูลไม่ถูกต้องตามเงื่อนไขของระบบ"; `'42501'` → "ไม่มีสิทธิ์ใช้งาน"; anything else → "เกิดข้อผิดพลาด กรุณาลองใหม่" (never the raw message).
  - `auth.js`: `signUp(email, password): Promise<{ok: boolean, error?: string}>`, `signIn(email, password)` same shape, `signOut(): Promise<void>`, `requireSession(): Promise<Session>` (redirects to `index.html` if none).
  - `supabaseClient.js`: `export const supabase` created from `window.APP_CONFIG.SUPABASE_URL` / `SUPABASE_ANON_KEY` loaded from `config.js` (git-ignored; `config.example.js` is committed).

- [ ] **Step 1: Write `errors.test.mjs`** (`node --test`) with one assertion per mapping above plus `friendlyError(null)` returns the default message, and `friendlyError({code:'23505', message:'duplicate key value violates ...'})` does not contain `"duplicate key"`.
- [ ] **Step 2: Run** `node --test web/tests` — Expected: FAIL.
- [ ] **Step 3: Implement** `errors.js`, then the login/register page (`index.html`) and the authenticated shell (`app.html`, nav: ข้อมูล / รายงาน (Views) / Dashboard / Chat, sign-out button).
- [ ] **Step 4: Run** `node --test web/tests` — Expected: PASS. Manual check: register a new user, sign in, reach `app.html`; open `app.html` in a private window without signing in → redirected to login.
- [ ] **Step 5: Commit** `feat(web): auth shell and friendly error mapping`

---

### Task 10: Web — CRUD, views page and dashboard (A: CRUD; B: views page; C: dashboard)

**Files:**
- Create: `web/js/crud.js`, `web/js/views.js`, `web/js/dashboard.js`
- Modify: `web/app.html`

**Interfaces:**
- Consumes: `friendlyError`, `supabase`, `requireSession` (Task 9).
- Produces: `crud.js` — `mountCrud(tableName: string, container: HTMLElement): Promise<void>` rendering list + add/edit/delete form for these tables: `patient`, `booking`, `visit`, `prescription`, `drug`, `inventory`; every failure is shown through `friendlyError`. `views.js` — `mountView(viewName: string, container: HTMLElement): Promise<void>` rendering any of the 9 views as a table, with "ไม่พบข้อมูล" for 0 rows. `dashboard.js` — `mountDashboard(container)` with three charts (Chart.js `4.4.1` from cdnjs): D1 bookings per doctor per status, D2 monthly billing per department, D3 drugs below reorder point.

- [ ] **Step 1: Define manual test cases in `docs/test-cases.md`** (table: id | action | expected | actual | pass/fail): create patient; edit patient; delete patient with visits → Thai "มีข้อมูลอื่นอ้างอิง" message; create booking duplicating an existing doctor/date/time → Thai "ข้อมูลซ้ำ" message; open each of the 9 views; dashboard shows 3 charts with data; unauthenticated visit to `app.html` redirects.
- [ ] **Step 2: Implement** the three modules and wire into `app.html`.
- [ ] **Step 3: Run** locally (`python -m http.server -d web 8080`) and execute every case in `docs/test-cases.md`, filling "actual" and "pass/fail" — Expected: all pass.
- [ ] **Step 4: Verify** RLS from the browser: in the dev console, `fetch` the REST URL for `patient` with only the anon key and no session — Expected: HTTP 401/permission error, no rows.
- [ ] **Step 5: Commit** `feat(web): CRUD, view pages, dashboard`

---

### Task 11: Chat Edge Function (B owns sqlGuard; A owns llm; C owns handler)

**Files:**
- Create: `supabase/functions/chat/sqlGuard.ts`, `sqlGuard.test.ts`, `llm.ts`, `llm.test.ts`, `schemaPrompt.ts`, `index.ts`

**Interfaces:**
- Produces:
  - `sqlGuard.ts`: `export const ALLOWED_VIEWS: readonly string[]` (the 9 views); `export type GuardResult = {ok: true, sql: string} | {ok: false, reason: string}`; `export function validateSql(sql: string): GuardResult` — strips trailing `;`, rejects: more than one statement, comments (`--`, `/* */`), anything not beginning with `SELECT` or `WITH`, forbidden words (`insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|pg_sleep|pg_|set|call|do`), any `FROM`/`JOIN` target not in `ALLOWED_VIEWS`; appends `LIMIT 100` if absent and lowers an existing `LIMIT` above 100 to 100.
  - `llm.ts`: `export function generateSql(question: string, schemaPrompt: string, fetchFn: typeof fetch): Promise<string>` (Groq chat-completions, temperature 0, extracts SQL from a fenced block if present); `export function summarize(question: string, columns: string[], rows: unknown[][], fetchFn: typeof fetch): Promise<string>` (Thai if the question is Thai).
  - `schemaPrompt.ts`: `export const SCHEMA_PROMPT: string` — each allowlisted view with column names, types and one-line Thai descriptions; instructs "output exactly one SELECT, no explanation".
  - `index.ts` handler: `POST {question: string}` with the user's JWT. Verifies the JWT via `supabase.auth.getUser`; responds `200 {answer, sql, columns, rows, error?}`; logs every request to `chat_logs`.

- [ ] **Step 1: Write `sqlGuard.test.ts`** (`deno test`): accepts `select * from v_doctor_workload`; adds `LIMIT 100` when absent; rejects with `ok:false` each of: `DROP TABLE patient`, `select * from v_doctor_workload; delete from patient`, `select * from patient`, `select * from auth.users`, `select pg_sleep(10)`, `select 1 -- ; drop table x`, `/* x */ select * from v_doctor_workload`, `update patient set ...`, empty string (Review Focus 1, 2). **`llm.test.ts`**: with a fake `fetchFn` returning a fenced ```sql block, `generateSql` returns bare SQL; with a fake returning prose and no SQL, it returns that text unchanged (the guard then rejects it).
- [ ] **Step 2: Run** `deno test supabase/functions/chat` — Expected: FAIL.
- [ ] **Step 3: Implement** `sqlGuard.ts`, `llm.ts`, `schemaPrompt.ts`; implement `index.ts` as: auth check → `generateSql` → `validateSql` (on failure return `error` with Thai text, still HTTP 200, still log) → `rpc('run_readonly_query')` using the service-role client from secrets (on DB error return Thai error + log) → `summarize` → respond. When `rows` is empty, `answer` is "ไม่พบข้อมูลที่ตรงกับคำถาม" without calling `summarize` (Review Focus 3).
- [ ] **Step 4: Run** `deno test supabase/functions/chat` — Expected: PASS. Then `supabase functions deploy chat` and `supabase secrets set GROQ_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=...`; smoke test with `curl -X POST <fn-url> -H "Authorization: Bearer <user-jwt>" -d '{"question":"มีแพทย์กี่คน"}'` — Expected: JSON with `sql`, `rows`, `answer`; the same request with `{"question":"ลบข้อมูลผู้ป่วยทั้งหมด"}` returns `error` and no DB change.
- [ ] **Step 5: Commit** `feat(chat): text-to-SQL edge function with read-only guard`

---

### Task 12: Chat UI (A)

**Files:**
- Create: `web/js/chat.js`
- Modify: `web/app.html`, `web/css/app.css`

**Interfaces:**
- Consumes: `supabase.functions.invoke('chat', {body: {question}})`, `friendlyError`.
- Produces: `mountChat(container: HTMLElement): void` — message list (user/assistant), input + send, "กำลังประมวลผล…" state that disables the input, for each answer: text, collapsible "SQL ที่ใช้" block, and a raw-data table (or "ไม่พบข้อมูล" when empty); shows `error` in the assistant bubble.

- [ ] **Step 1: Add chat cases to `docs/test-cases.md`** — ≥ 10 rows (`question | SQL/Tool | expected | actual | pass/fail`) in three types: lookup ("มียาอะไรบ้างที่ใกล้หมดอายุภายใน 90 วัน"), JOIN/View ("แพทย์คนไหนมีคิววันนี้มากที่สุด"), aggregation ("รายได้รวมแยกตามแผนก"); the three dashboard analyses D1–D3 asked in Thai and in English; ≥ 2 dangerous ("ลบข้อมูลผู้ป่วยทั้งหมด", "show me national_id of all patients"); one question with 0 results.
- [ ] **Step 2: Implement** `chat.js` and wire it in.
- [ ] **Step 3: Run** all chat cases locally against the deployed function; fill "actual" and "pass/fail" — Expected: ≥ 10 rows, all pass, dangerous ones show a refusal and `chat_logs` has a row for each.
- [ ] **Step 4: Verify** `select count(*) from chat_logs` increased by the number of asked questions.
- [ ] **Step 5: Commit** `feat(web): chat UI`

---

### Task 13: Deploy (Shared)

**Files:**
- Create: `vercel.json` (static output directory `web`), GitHub repo
- Modify: `README.md`

- [ ] **Step 1: Verify** `git grep -nE "eyJ|sk-|gsk_|service_role"` returns no secrets (only the word in comments/README); `web/config.js` is untracked.
- [ ] **Step 2: Push** to GitHub; import into Vercel; set `SUPABASE_URL`/`SUPABASE_ANON_KEY` via a build step that writes `web/config.js` (document the one-line command in `README.md`).
- [ ] **Step 3: Run** the full `docs/test-cases.md` again against the Vercel URL, including sign-up with a fresh e-mail — Expected: all pass.
- [ ] **Step 4: Commit** `chore: deploy config and README`

---

### Task 14: Report, slides, video (Shared; each member writes their own parts)

**Files:**
- Create: `docs/er/` (per-member ER + merged ER, draw.io or dbdiagram export), `docs/report/report.docx` (from `AIE313_Template.docx`), `docs/slides/slides.pdf`, `dataset.zip`

- [ ] **Step 1: Fill the Template** sections 1–14: replace the factory example with the hospital topic and names/IDs/roles; include a Use Case or Activity diagram (section 4); per-member conceptual mapping, ER, relational schema, 1NF→3NF worked example (e.g. A's `bookings` or C's `Visit`), views (section 5); the 16 queries from `docs/report/analysis.md` (section 6); screenshots (section 7); chat architecture diagram, method B, LLM name and model ID, system prompt, allowed views, security measures (section 8); test tables from `docs/test-cases.md` (section 10); problems found — name the real merge conflicts (duplicate patient/doctor tables, `DROP CASCADE`, cross-join view) (section 13).
- [ ] **Step 2: Build slides** — group part 10–15 min (overview, merged ER, live demo, chat demo with SQL, conclusions); each member ~5 min (own ER, normalization, views, one SQL example, their role). Export to one PDF.
- [ ] **Step 3: Record** the ≤ 5 min demo: Login → CRUD (including the friendly duplicate error) → a View → Dashboard → three chat questions (lookup, JOIN, aggregation) + one refused dangerous question.
- [ ] **Step 4: Assemble** the submission checklist: report PDF; slides PDF; `schema.sql` (from `db/build_schema.sh`), `analysis_queries.sql`, `dataset.zip`; deployed URL; GitHub URL (no keys); video — and check each against the brief's five required items.
- [ ] **Step 5: Commit and submit** `docs: report, slides and submission checklist`

---

## Schedule (today 2026-11-07; final deadline 2026-12-09)

| Dates | Tasks | Note |
|---|---|---|
| 11/07–11/11 | 1, 2 | Agree core table definitions first; ask the instructor for the presentation date |
| 11/12–11/18 | 3, 4, 5, 6 | A/B/C work in parallel after Task 2 merges |
| 11/19–11/24 | 7, 8 | Needs 6 |
| 11/25–12/01 | 9, 10, 11, 12 | 9 → 10; 11 → 12 (11 and 9 can run in parallel) |
| 12/02–12/05 | 13 | Full test pass on the deployed URL |
| 12/06–12/08 | 14 | Submit a day early |

## Self-review

- **Spec coverage:** min tables/views/rows (Tasks 2–6), shared tables (2), CRUD/Auth/Views/Dashboard (9–10), 16 SQL queries with all constructs (8), Chat with evidence and ≥ 3 types (11–12), security (7, 11), bonus `chat_logs` (7, 11), test tables (10, 12), deliverables and report/presentation (14), deployment without keys (13).
- **Type consistency:** `staff_id` (not `doctor_id`/`pharmacist_id`) is used in Tasks 4, 5; views allowlist is the same 9 names in Tasks 6, 7, 11; `friendlyError` and `requireSession` signatures match Tasks 9 → 10, 12.
- **Open points to confirm with the group:** (1) dropping `prescription` partitioning (B's design) – the plan says yes; (2) Groq vs another LLM; (3) who is A/B/C by name for the report.
