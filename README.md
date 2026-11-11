# ระบบสารสนเทศโรงพยาบาล AIE313 + AI Chat

Supabase (PostgreSQL + Auth + Edge Function) · เว็บแอป HTML/JS แบบ static (Docker image บน Render) · AI Chat (MCP เป็นค่าเริ่มต้น, Text-to-SQL เป็นตัวสำรอง) ที่อ่านได้เฉพาะ 10 views แบบอ่านอย่างเดียว
งานที่เหลือของแต่ละคน: `docs/TEAM_HANDOFF.md` · แผนงาน: `docs/superpowers/plans/` · ER diagram: `docs/er/` · กรณีทดสอบ: `docs/test-cases.md` · query วิเคราะห์: `analysis/analysis_queries.sql`

## ขั้นตอน deploy
ลำดับ: **Supabase** (ฐานข้อมูล, Auth, Edge Function) → **Docker Hub** (image ของเว็บ) → **Render** (รันเว็บจาก image)
Image ไม่มี key อยู่ข้างใน เพราะ `config.js` ถูกสร้างตอน container เริ่มทำงานจาก env ที่ตั้งใน Render จึงเปิด repo บน Docker Hub เป็น public ได้

### 1. Supabase
1. สร้างโปรเจกต์ → SQL editor: รัน `schema.sql` แล้วตามด้วย `seed.sql` (21 ตาราง, 10 views, RLS, trigger ผูกบัญชีตอนสมัคร, role `chat_reader`, ฟังก์ชัน `run_readonly_query`)
   `schema.sql` รันได้ครั้งเดียวบนโปรเจกต์ที่ว่าง ถ้าเคยรันไปแล้ว (เช่นเจอ `already exists`) ให้สร้างโปรเจกต์ใหม่ หรือล้าง schema `public` ด้วยคำสั่งนี้ก่อน **ข้อมูลทุกตารางใน `public` จะหาย รวมถึงการผูกบัญชี (`staff.user_id` / `patient.user_id`)** บัญชีใน Auth ยังอยู่ แต่ต้องผูกใหม่ (ลบบัญชีแล้วสมัครใหม่ หรือ `UPDATE ... SET user_id`) และต้องลบ trigger `on_auth_user_created` บน `auth.users` ก่อนด้วย (`DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`) บรรทัด `ALTER DEFAULT PRIVILEGES` คืนสิทธิ์ตั้งต้นของ Supabase ถ้าไม่ใส่ `service_role` จะเรียก `role_of()` ไม่ได้และ chat จะตอบ 403 กับทุกบัญชี:
   ```sql
   DROP SCHEMA IF EXISTS public CASCADE;
   CREATE SCHEMA public;
   GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
   GRANT ALL ON SCHEMA public TO postgres;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
   ```
2. SQL editor: `ALTER ROLE service_role SET statement_timeout = '10s';` (จำกัดเวลา query ของ chat)
   **อัปเดตโปรเจกต์ที่ลง schema ไปแล้ว:** รันไฟล์ใน `db/migrations/` ที่ยังไม่เคยรันตามลำดับวันที่ (แต่ละไฟล์เป็น transaction เดียว) **ก่อน** deploy Edge Function เวอร์ชันเดียวกัน เช่น `2026-11-10_patient_portal.sql` (สิทธิ์บัญชีผู้ป่วย) แล้วตามด้วย `2026-11-10b_upcoming_bookings.sql` (view นัดหมายตั้งแต่วันนี้) และ `2026-11-11_user_link_trigger.sql` (เลิกใช้ `profiles` ย้ายการผูกบัญชีเดิมไป `staff.user_id` / `patient.user_id` และเพิ่ม trigger สมัครสมาชิก) โปรเจกต์ใหม่ใช้แค่ `schema.sql` + `seed.sql`
3. **Auth** (หน้าเว็บมีปุ่มสมัครสมาชิกตามที่โจทย์กำหนด):
   - Authentication → Sign In / Providers: **เปิด "Allow new users to sign up"** ไว้
   - **"Confirm email"**: สำหรับ demo ให้ปิดไว้ เพราะ SMTP เริ่มต้นของ Supabase ส่งอีเมลยืนยันได้เฉพาะอีเมลของสมาชิกในโปรเจกต์ ถ้าจะเปิดไว้ต้องตั้ง SMTP เอง
   - หลังได้ URL จาก Render (ขั้นที่ 3) ให้ใส่ใน Authentication → URL Configuration: **Site URL** และ **Redirect URLs** = `https://<ชื่อ service>.onrender.com`
   - **ไม่ต้อง copy UUID เอง:** หน้าสมัคร (`register.html`) ให้เลือก "ผู้ป่วย / เจ้าหน้าที่" แล้ว trigger `handle_new_user` บน `auth.users` (`db/01_core.sql`) ผูกบัญชีให้ใน transaction เดียวกับการสมัคร
     - **ผู้ป่วย** กรอกชื่อ เลขบัตรประชาชน วันเกิด: ถ้าเลขบัตร + วันเกิดตรงกับเวชระเบียนเดิม ผูกกับแถวเดิม (HN เดิม) ถ้าไม่มี สร้างแถว `patient` ใหม่พร้อม HN ใหม่ ถ้าเลขบัตรนี้มีบัญชีแล้วหรือวันเกิดไม่ตรง การสมัครถูกยกเลิกทั้งหมด
     - **เจ้าหน้าที่** ผูกกับแถว `staff` ที่มีอีเมลเดียวกัน (admin เพิ่มแถวไว้ก่อน หรือเพิ่มทีหลังก็ได้ trigger ฝั่ง `staff` จะผูกบัญชีที่รออยู่ให้) ถ้ายังไม่มีอีเมลนี้ บัญชีจะรอและไม่เห็นข้อมูล (RLS, view และ chat เช็คสิทธิ์ทั้งหมด) การสมัครเองจึงไม่มีทางได้สิทธิ์เจ้าหน้าที่
     - **admin สำหรับ demo:** `seed.sql` มีแถว `staff` role `admin` อีเมล `admin@hospital.example` สมัครด้วยอีเมลนี้แล้วเป็น admin ทันที (เจ้าหน้าที่ใน seed ใช้ `staff1@hospital.example` … `staff20@hospital.example`)
     - เพิ่มเจ้าหน้าที่ใหม่ (SQL editor หรือ Table editor): `INSERT INTO staff(first_name, last_name, role, department_id, email) VALUES ('ชื่อ', 'สกุล', 'nurse', 8, 'nurse@example.com');`
     - เปลี่ยน role / อีเมลเจ้าหน้าที่ หรือผูก/ตัดบัญชี (`user_id`) ทำได้เฉพาะ admin หรือ SQL editor (trigger `trg_account_link_guard`)
   - สิทธิ์ตามบัญชี (role มาจาก `staff.role` หรือเป็น `patient` เมื่อผูกกับ `patient.user_id`; ดูด้วย `my_role()`):

     | บัญชี | ตาราง (CRUD) | รายงาน / Dashboard / Chat |
     |---|---|---|
     | ยังไม่ได้ผูก | ไม่เห็นอะไร | ไม่เห็นอะไร / chat ตอบ 403 |
     | `patient` | เห็นเฉพาะของตัวเองใน `patient`, `booking`, `visit`, `prescription`; จองคิว (ระบบใส่เลขคิวให้) และยกเลิกคิวของตัวเอง; แก้ได้เฉพาะเบอร์โทร อีเมล ที่อยู่ | ไม่มีแท็บรายงาน; Dashboard แสดงค่ารักษารายเดือนของตัวเอง; chat ตอบจาก view รายคน (เฉพาะของตัวเอง) และ view ภาพรวม |
     | `admin`, `doctor`, `pharmacist`, `nurse`, `technician` | ทุกตาราง (role/อีเมล/การผูกบัญชีของ staff แก้ได้เฉพาะ admin) | รายงานทุกแถว; Dashboard ตาม role (admin ทุกกราฟ D1–D5, doctor D1 D4, nurse D4 D1, pharmacist D5 D3) |
4. **Edge Functions** (ต้องมี Supabase CLI: `brew install supabase/tap/supabase` แล้ว `supabase login`) รันในโฟลเดอร์ repo
   chat หลักคือ **MCP (วิธี C)** `chat-mcp` ส่วน `chat` (Text-to-SQL, วิธี B) เป็นตัวสำรอง:
   `supabase functions deploy chat-mcp --project-ref <ref>` (และ `chat` ถ้าต้องการ)
   `supabase secrets set GROQ_API_KEY=<key> LLM_MODEL=openai/gpt-oss-120b --project-ref <ref>`
   (`<ref>` คือรหัสโปรเจกต์ใน URL ของ Dashboard; Supabase ใส่ `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ให้ function อัตโนมัติ) ตรวจชื่อโมเดลว่ายังใช้ได้ที่ https://console.groq.com/docs/models (Groq ปิด `llama-3.3-70b-versatile` ไปเมื่อ 16 ส.ค. 2026; ถ้าไม่ตั้ง `LLM_MODEL` function จะใช้ `openai/gpt-oss-120b`)
   Supabase CLI รุ่นใหม่ใช้ `--remote=<ref>` แทน `--project-ref <ref>` และใส่ `--use-api --yes` ได้ถ้าไม่มี Docker หรือหน้าถามกดเลือกไม่ได้
   **chat ขึ้น "ระบบ AI ไม่พร้อมใช้งาน":** สาเหตุจริงอยู่ใน Supabase → Edge Functions → `chat-mcp` → Logs (`LLM call failed: ...`) หรือ SQL editor: `SELECT created_at, error FROM chat_logs WHERE error LIKE 'llm_unavailable%' ORDER BY created_at DESC LIMIT 5;`
5. จด **Project URL** และ **anon / publishable key** จาก Project Settings → API ไว้ใช้ใน Render (ห้ามใช้ `service_role` / `sb_secret_` key — server จะไม่ยอมเริ่มทำงาน)

### 2. Docker Hub (image ของเว็บ)
Render รันบนเครื่อง x86 ดังนั้น image ต้องเป็น `linux/amd64` แม้จะ build บน Mac ชิป Apple (M1/M2/…) เลือกทางใดทางหนึ่ง:
- **Build บน Mac** (ต้องมี Docker Desktop) ในโฟลเดอร์ repo:
  ```bash
  docker login
  docker buildx build --platform linux/amd64 -t <dockerhub-user>/aie313-hospital-web:latest --push .
  ```
- **ให้ CI build ให้** (job `Web image` ใน `.github/workflows/ci.yml`): ใน GitHub repo → Settings → Secrets and variables → Actions เพิ่ม secret `DOCKERHUB_USERNAME` และ `DOCKERHUB_TOKEN` (Docker Hub → Account settings → Personal access tokens, สิทธิ์ Read & Write) หลังจากนั้นทุกครั้งที่ push เข้า `main` และ test ผ่านครบ CI จะ push image ขึ้น Docker Hub ให้ ถ้าใส่ secret `RENDER_DEPLOY_HOOK_URL` ด้วย Render จะ deploy image ใหม่ให้อัตโนมัติ

ลองรันในเครื่องก่อนได้: `docker run --rm -p 8080:10000 -e SUPABASE_URL=<url> -e SUPABASE_ANON_KEY=<anon key> <dockerhub-user>/aie313-hospital-web:latest` แล้วเปิด http://localhost:8080

### 3. Render (web hosting)
1. Render Dashboard → **+ New → Web Service** → Source Code: **Existing Image** → Image URL: `docker.io/<dockerhub-user>/aie313-hospital-web:latest` → **Connect**
2. ตั้งชื่อ (จะเป็น URL `https://<ชื่อ>.onrender.com`), region **Singapore**, plan **Free**
3. Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (และ `CHAT_FUNCTION=chat` ถ้าจะใช้ Text-to-SQL แทน MCP)
4. Advanced → **Health Check Path**: `/healthz` → **Deploy**
5. กลับไปใส่ URL ของ Render ใน Supabase (ขั้น 1.3)
- push image ใหม่แล้ว Render **ไม่ deploy เอง**: กด Manual Deploy → **Deploy latest reference** หรือเอา Deploy Hook (Settings → Deploy Hook) ไปใส่เป็น secret `RENDER_DEPLOY_HOOK_URL` ให้ CI สั่ง deploy
- Plan Free จะหลับเมื่อไม่มีคนใช้ 15 นาที เปิดครั้งแรกรอประมาณ 1 นาที ควรเปิดเว็บทิ้งไว้ก่อนอัดวิดีโอหรือนำเสนอ

### 4. ทดสอบบนระบบจริง
รันกรณีทดสอบที่ติดว่า *todo* ใน `docs/test-cases.md` บน URL ของ Render (สมัครสมาชิก, บัญชีที่ยังไม่อนุมัติ S2–S4, ถามคำถาม chat ชุดเดิมกับ LLM จริง)

ทางเลือก: `vercel.json` ยังใช้ deploy บน Vercel ได้ (import repo แล้วตั้ง env 2 ตัวเดียวกัน)

## พัฒนาและทดสอบในเครื่อง
- ห้าม commit key: `bash scripts/check-secrets.sh`
- เว็บ: คัดลอก `web/config.example.js` → `web/config.js` (git ไม่เก็บไฟล์นี้) แล้วรัน `python3 -m http.server -d web 8080` หรือรันแบบเดียวกับใน container: `SUPABASE_URL=… SUPABASE_ANON_KEY=… PORT=8080 node scripts/serve.mjs`
- ทดสอบ SQL (Postgres ≥15 ในเครื่องหรือ docker): `PGHOST=… PGPORT=… PGUSER=… bash db/tests/run_tests.sh`
- สร้างไฟล์ส่งงาน: `bash db/build_schema.sh` → `schema.sql`, `seed.sql` · สร้าง seed ใหม่: `python3 db/seed/generate_seed.py --seed 313 > db/seed/seed.sql`
- Unit test ของเว็บ: `node --test web/tests/*.test.mjs scripts/*.test.mjs` · smoke test บน browser (mock Supabase): `PLAYWRIGHT_PATH=<playwright> node web/tests/smoke.mjs`
- MCP chat: `cd supabase/functions/chat-mcp && deno test --allow-env` · รันกรณีทดสอบกับฐานข้อมูล: `deno run --allow-run --allow-env cases.ts <db>` · สร้าง view catalog ใหม่หลังแก้ view: `python3 gen_view_catalog.py <db> > viewCatalog.ts`
- Chat แบบ Text-to-SQL: `deno test --allow-env supabase/functions/chat/` · สร้าง prompt ใหม่หลังแก้ view: `python3 supabase/functions/chat/gen_schema_prompt.py <db> > supabase/functions/chat/schemaPrompt.ts`
- ER diagram: `python3 docs/er/gen_er.py <db> docs/er` แล้วตามด้วย `mmdc -i docs/er/er_full.mmd -o docs/er/er_full.png -s 2 -w 2200`
- e2e บน Supabase ในเครื่อง (ต้องมี Docker): `supabase init` (ครั้งแรก) → `supabase start` → รัน `schema.sql` + `seed.sql` ด้วย `psql` → `supabase functions serve --env-file <ไฟล์ที่มี LLM_BASE_URL=http://host.docker.internal:9100>` → `npm ci --prefix tests/e2e` แล้ว `node tests/e2e/supabase.e2e.mjs` โดยตั้ง env ตาม `supabase status -o env` (ขั้นตอนเดียวกับ job `Supabase e2e` ใน `.github/workflows/ci.yml`)

## CI/CD (GitHub Actions)
ทุก pull request และทุกการ push เข้า `main` จะรัน `.github/workflows/ci.yml` ผลดูได้ที่แท็บ Actions และหน้า PR

| Job | ตรวจอะไร |
|---|---|
| Static checks | ไม่มี key ใน repo, `schema.sql`/`seed.sql` ตรงกับไฟล์ใน `db/`, `seed.sql` ตรงกับ generator |
| Database tests | `db/tests` บน Postgres 17, query วิเคราะห์ครบตามโจทย์, `viewCatalog.ts`/`schemaPrompt.ts` ตรงกับ view, กรณีทดสอบ chat ทั้งสองแบบ |
| Edge Function tests | `deno check` + `deno test` ของ `chat` และ `chat-mcp` |
| Web tests | unit test และ smoke test บน Chromium |
| Supabase e2e | เปิด Supabase ตัวจริงด้วย Supabase CLI, ลง `schema.sql` ด้วย role `postgres` แบบ SQL editor แล้วทดสอบ 130 เคสผ่าน API: สิทธิ์ของทุก role, SQL/argument อันตรายจาก LLM (ใช้ LLM จำลอง ไม่ต้องมี Groq key), CRUD และข้อความ error |
| Deploy Edge Functions | หลังทุก job ผ่านบน `main` จะ deploy `chat-mcp` และ `chat` ให้อัตโนมัติ |
| Web image (Docker Hub → Render) | ทุก PR: build image `linux/amd64` แล้วเปิด container ลองจริง (`/healthz`, หน้าเว็บ, `config.js` มาจาก env, ไม่มี key ใน image, ไม่ยอมเริ่มเมื่อได้ service_role key) · หลังทุก job ผ่านบน `main`: push ขึ้น Docker Hub และสั่ง Render deploy |

เปิดใช้ deploy อัตโนมัติ (เจ้าของ repo ทำครั้งเดียว): Settings → Secrets and variables → Actions → เพิ่ม **secret** `SUPABASE_ACCESS_TOKEN` (สร้างที่ supabase.com/dashboard/account/tokens) และ **variable** `SUPABASE_PROJECT_REF` สำหรับเว็บเพิ่ม **secret** `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` และ `RENDER_DEPLOY_HOOK_URL` (Render → service → Settings → Deploy Hook) ถ้ายังไม่ตั้ง job deploy จะข้ามไปเฉยๆ โดย CI ยังผ่าน ส่วน database ยังต้องรัน SQL ที่เปลี่ยนเองใน SQL editor เพราะ `schema.sql` รันซ้ำบนฐานข้อมูลเดิมไม่ได้

## ตัวแปร environment
| ที่ใช้ | ชื่อ | หมายเหตุ |
|---|---|---|
| เว็บ (เปิดเผยได้) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CHAT_FUNCTION` (ไม่บังคับ) | ตั้งใน Render; ในเครื่องอยู่ใน `web/config.js` ซึ่ง git ไม่เก็บ |
| GitHub Actions secret | `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `RENDER_DEPLOY_HOOK_URL` (ไม่บังคับ) | ใช้ push image และสั่ง Render deploy |
| Secret ของ Edge Function | `GROQ_API_KEY`, `LLM_MODEL` (ไม่บังคับ), `LLM_BASE_URL` (ไม่บังคับ) | ห้ามอยู่ใน git หรือ browser |
