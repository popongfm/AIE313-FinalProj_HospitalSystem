# AIE313 — งานที่เหลือสำหรับสมาชิก (ส่งภายใน 9 ธ.ค. 2569)

โค้ด ฐานข้อมูล เว็บ และ Chat (MCP) เสร็จแล้วในรีโป รายละเอียด deploy ดู `README.md` และรายการเทียบ Template ดู `docs/report/REPORT_CHECKLIST.md`

## แบ่งส่วนฐานข้อมูล
| สมาชิก | ตารางที่รับผิดชอบ | ER ของตน | Views ของตน |
|---|---|---|---|
| A — Booking | booking, feedback | `docs/er/er_member_A_booking.png` | v_booking_queue_today, v_upcoming_bookings, v_doctor_workload, v_feedback_summary |
| B — Pharmacy | drug, drug_lot, prescription, prescription_item, dispense_record, inventory, drug_allergy_record | `docs/er/er_member_B_pharmacy.png` | v_pharmacist_screening_queue, v_inventory_stock_status, v_drug_cost_summary |
| C — Records | room, bed, visit, admission, diagnosis, lab_result, insurance_coverage, daily_charge | `docs/er/er_member_C_records.png` | v_bed_occupancy, v_visit_billing, v_top_diagnosis |
| ใช้ร่วมกัน | department, staff, patient, profiles, chat_logs | `docs/er/er_core_shared.png` | — |

## ทุกคนต้องทำ (ส่วนบุคคล ~5 นาที/คน + ตอบคำถามสด)
1. อ่านและเข้าใจตาราง/ER/View ของตัวเอง (ผู้สอนอาจให้แก้ Query สด)
2. เขียน "การแปลความหมายผลลัพธ์" ของ Query ที่ตนรับผิดชอบใน `docs/report/analysis.md` (ตอนนี้เป็น placeholder) — แบ่งจาก `analysis/analysis_queries.sql` (19 คำสั่ง แต่ละคำสั่งมีแท็ก JOIN/AGG/GROUP/STAT/DASH)
3. เขียน Normalization 1NF→2NF→3NF อย่างน้อย 1 ตัวอย่างจากตารางของตน
4. เลือก SQL/View 1 ตัวอย่าง (JOIN หรือ Aggregation) ไว้อธิบายตอนนำเสนอ
5. ระบุหน้าที่ของตนในเว็บ/Chat

## งานกลุ่ม (ตกลงว่าใครทำ)
- [ ] สร้าง Supabase project, รัน `schema.sql` แล้ว `seed.sql`, เปิด sign-up และปิด Confirm email สำหรับ demo, สมัครบัญชีจากหน้าเว็บแล้วเพิ่มแถว `profiles`, ตั้ง `statement_timeout` (ขั้นตอนใน README)
- [ ] ขอ Groq API key, deploy `chat-mcp`, ตั้ง secret (ห้ามใส่ key ในรีโป)
- [ ] push GitHub (รัน `bash scripts/check-secrets.sh` ก่อน), build image ขึ้น Docker Hub, สร้าง Web Service บน Render จาก image แล้วตั้ง `SUPABASE_URL` / `SUPABASE_ANON_KEY` และใส่ URL ของ Render ใน Supabase Auth (ขั้นตอนใน README)
- [ ] ทดสอบบนเว็บจริง: Registration, Login, CRUD (ลอง double-booking และลบผู้ป่วยที่มี visit), Views, Dashboard, ถาม Chat ด้วย LLM จริง, บัญชีที่ยังไม่อนุมัติต้องไม่เห็นข้อมูล (S2–S4) แล้วกรอกผลที่ค้างใน `docs/test-cases.md`
- [ ] ถ่ายภาพหน้าจอระบบจริงใส่รายงาน
- [ ] รายงาน PDF ตาม Template (TH Sarabun PSK 14pt): ที่มา วัตถุประสงค์ ขอบเขต, Use Case/Activity Diagram, ระบุ LLM+รุ่นที่ใช้ และแผนภาพ Web → Edge Function (MCP) → LLM → Supabase
- [ ] สไลด์ PDF รวมไฟล์เดียว (ส่วนกลุ่ม 10–15 นาที + ส่วนบุคคลของทุกคน)
- [ ] วิดีโอสาธิต ≤ 5 นาที: Registration/Login, CRUD, View, Chat
- [ ] zip Dataset

## ไฟล์ที่ต้องส่ง
รายงาน PDF · สไลด์ PDF · `schema.sql` + `seed.sql` · `analysis/analysis_queries.sql` · zip Dataset · ลิงก์เว็บที่ deploy · ลิงก์ GitHub · วิดีโอ

## ข้อควรรู้
- Chat ใช้ MCP (วิธี C) เป็นค่าเริ่มต้น; มี Text-to-SQL (วิธี B) เป็นตัวสำรอง
- สมัครสมาชิกเองได้จากหน้าเว็บ (โจทย์บังคับหน้า Registration) แต่ต้องมีแถวใน `profiles` จึงจะเห็นข้อมูล — ตาราง, view และ chat เช็คสิทธิ์นี้ทั้งหมด คนนอกที่สมัครเข้ามาจึงอ่านข้อมูลผู้ป่วยไม่ได้
- บัญชี role `patient` (ผูกกับ `patient_id`) เห็นเฉพาะข้อมูลของตัวเอง จองและยกเลิกคิวเองได้ แก้ได้เฉพาะเบอร์โทร อีเมล ที่อยู่ (policy และ trigger อยู่ท้าย `db/06_rls.sql`) ส่วนบุคลากรเห็นทุกแถว — ตารางสรุปอยู่ใน README
- ทุก view มีเงื่อนไข `(current_user NOT IN ('anon','authenticated') OR is_app_user())` ใน WHERE เพื่อเช็คสิทธิ์ข้างต้น ควรอธิบายได้ตอนนำเสนอ View ของตัวเอง
- ข้อมูลทั้งหมดเป็นข้อมูลจำลอง
