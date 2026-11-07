# ระบบสารสนเทศโรงพยาบาล AIE313 + AI Chat

Supabase (PostgreSQL + Auth + Edge Function) · เว็บแอป HTML/JS แบบ static (Vercel) · Chat แบบ Text-to-SQL ที่อ่านได้เฉพาะ 9 views แบบอ่านอย่างเดียว
แผนงาน: `docs/superpowers/plans/` · ER diagram: `docs/er/` · กรณีทดสอบ: `docs/test-cases.md` · query วิเคราะห์: `analysis/analysis_queries.sql`

## ขั้นตอน deploy (ทำครั้งเดียว)
1. **โปรเจกต์ Supabase** → SQL editor: รัน `schema.sql` แล้วตามด้วย `seed.sql` (22 ตาราง, 9 views, RLS, role `chat_reader`, ฟังก์ชัน `run_readonly_query`)
   ถ้าเคยรัน `schema.sql` เวอร์ชันเก่าไปแล้ว (ที่ล้มตรง `ALTER FUNCTION ... OWNER TO chat_reader` หรือทำให้ `run_readonly_query` ยังเป็นของ `postgres`) ให้เริ่มจากโปรเจกต์ใหม่ หรือรันคำสั่งนี้ก่อน: `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;`
2. Auth → **ปิด "Allow new users to sign up"** แล้วสร้างผู้ใช้เองที่ Auth → Users จากนั้นผูกผู้ใช้แต่ละคนกับ profile ในฐานะ admin ไม่อย่างนั้น RLS จะไม่แสดงข้อมูลอะไรเลย:
   `INSERT INTO profiles(user_id, role) VALUES ('<auth user uuid>', 'admin');`
   **ต้องทำ:** `ALTER ROLE service_role SET statement_timeout = '10s';` (จำกัดเวลา query ของ chat)
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

## ตัวแปร environment
| ที่ใช้ | ชื่อ | หมายเหตุ |
|---|---|---|
| เว็บ (เปิดเผยได้) | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | อยู่ใน `web/config.js` ซึ่ง git ไม่เก็บ |
| Secret ของ Edge Function | `GROQ_API_KEY`, `LLM_MODEL` (ไม่บังคับ), `LLM_BASE_URL` (ไม่บังคับ) | ห้ามอยู่ใน git หรือ browser |
