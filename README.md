# ระบบสารสนเทศโรงพยาบาล AIE313 + AI Chat

Supabase (PostgreSQL + Auth + Edge Function) · เว็บแอป HTML/JS แบบ static (Vercel) · AI Chat (MCP เป็นค่าเริ่มต้น, Text-to-SQL เป็นตัวสำรอง) ที่อ่านได้เฉพาะ 9 views แบบอ่านอย่างเดียว
งานที่เหลือของแต่ละคน: `docs/TEAM_HANDOFF.md` · แผนงาน: `docs/superpowers/plans/` · ER diagram: `docs/er/` · กรณีทดสอบ: `docs/test-cases.md` · query วิเคราะห์: `analysis/analysis_queries.sql`

## ขั้นตอน deploy (ทำครั้งเดียว)
1. **โปรเจกต์ Supabase** → SQL editor: รัน `schema.sql` แล้วตามด้วย `seed.sql` (22 ตาราง, 9 views, RLS, role `chat_reader`, ฟังก์ชัน `run_readonly_query`)
   ถ้าเคยรัน `schema.sql` เวอร์ชันเก่าไปแล้ว (ที่ล้มตรง `ALTER FUNCTION ... OWNER TO chat_reader` หรือทำให้ `run_readonly_query` ยังเป็นของ `postgres`) ให้เริ่มจากโปรเจกต์ใหม่ หรือรันคำสั่งนี้ก่อน: `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;`
2. **Auth** (หน้าเว็บมีปุ่มสมัครสมาชิกตามที่โจทย์กำหนด):
   - Authentication → Sign In / Providers: **เปิด "Allow new users to sign up"** ไว้
   - **"Confirm email"**: สำหรับ demo ให้ปิดไว้ เพราะ SMTP เริ่มต้นของ Supabase ส่งอีเมลยืนยันได้เฉพาะอีเมลของสมาชิกในโปรเจกต์ ถ้าจะเปิดไว้ต้องตั้ง SMTP เอง และใส่ URL ของ Vercel ใน Authentication → URL Configuration (Site URL / Redirect URLs) ลิงก์ยืนยันจึงจะพากลับมาที่เว็บ
   - บัญชีที่สมัครใหม่ **ยังไม่เห็นข้อมูล** (RLS, view และ chat เช็คสิทธิ์ทั้งหมด) จนกว่า admin จะผูกบัญชีกับ profile ที่ไม่ใช่ patient ใน SQL editor ดู uuid ได้ที่ Authentication → Users:
     `INSERT INTO profiles(user_id, role) VALUES ('<auth user uuid>', 'admin');`
     `INSERT INTO profiles(user_id, role, staff_id) VALUES ('<auth user uuid>', 'doctor', <staff_id>);` (หรือ `pharmacist` / `nurse`)
   - **ต้องทำ:** `ALTER ROLE service_role SET statement_timeout = '10s';` (จำกัดเวลา query ของ chat)
3. **Edge Functions** (ต้องมี Supabase CLI) chat หลักคือ **MCP (Method C)** `chat-mcp` ส่วน `chat` (Text-to-SQL, Method B) เก็บไว้เป็นทางเลือก (ตั้ง `CHAT_FUNCTION=chat` ใน Vercel ถ้าจะใช้):
   `supabase functions deploy chat-mcp --project-ref <ref>` (และ `chat` ถ้าต้องการ) แล้วตามด้วย
   `supabase secrets set GROQ_API_KEY=<key> LLM_MODEL=llama-3.3-70b-versatile --project-ref <ref>`
   (Supabase ใส่ `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ให้อัตโนมัติ) ตรวจชื่อโมเดลว่ายังใช้ได้ที่ https://console.groq.com/docs/models
4. **Vercel**: import repo จาก GitHub แล้วตั้ง env `SUPABASE_URL` และ `SUPABASE_ANON_KEY` (ใช้เฉพาะ key แบบ *anon/publishable*) `vercel.json` จะรัน `scripts/write-config.mjs` ซึ่งไม่ยอมรับ key แบบ service_role
5. รันกรณีทดสอบที่ติดว่า *todo* ใน `docs/test-cases.md` ซ้ำบน URL ที่ deploy แล้ว (ถามคำถาม chat ชุดเดิมกับ LLM จริง)

## พัฒนาและทดสอบในเครื่อง
- ห้าม commit key: `bash scripts/check-secrets.sh`
- เว็บ: คัดลอก `web/config.example.js` → `web/config.js` (git ไม่เก็บไฟล์นี้) แล้วรัน `python3 -m http.server -d web 8080`
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

เปิดใช้ deploy อัตโนมัติ (เจ้าของ repo ทำครั้งเดียว): Settings → Secrets and variables → Actions → เพิ่ม **secret** `SUPABASE_ACCESS_TOKEN` (สร้างที่ supabase.com/dashboard/account/tokens) และ **variable** `SUPABASE_PROJECT_REF` ถ้ายังไม่ตั้ง job deploy จะข้ามไปเฉยๆ โดย CI ยังผ่าน ส่วนเว็บ deploy ผ่าน Vercel อยู่แล้ว และ database ยังต้องรัน SQL ที่เปลี่ยนเองใน SQL editor เพราะ `schema.sql` รันซ้ำบนฐานข้อมูลเดิมไม่ได้

## ตัวแปร environment
| ที่ใช้ | ชื่อ | หมายเหตุ |
|---|---|---|
| เว็บ (เปิดเผยได้) | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | อยู่ใน `web/config.js` ซึ่ง git ไม่เก็บ |
| Secret ของ Edge Function | `GROQ_API_KEY`, `LLM_MODEL` (ไม่บังคับ), `LLM_BASE_URL` (ไม่บังคับ) | ห้ามอยู่ใน git หรือ browser |
