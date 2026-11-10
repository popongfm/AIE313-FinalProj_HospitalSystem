# Report / presentation checklist (maps Template sections to what exists)

| Template section | Material in this repo | Still to do by the group |
|---|---|---|
| 1–3 ที่มา วัตถุประสงค์ ขอบเขต | — | เขียนใหม่ให้เป็นระบบโรงพยาบาล (Template ตัวอย่างเป็นโรงงานพลังงาน) ใส่ชื่อ/รหัส/ส่วนที่รับผิดชอบ |
| 4 System Analysis | — | วาด Use Case หรือ Activity Diagram (ผู้ใช้: ผู้ป่วย แพทย์ เภสัชกร ผู้ดูแล) |
| 5.1 แนวคิด/ภายนอก | `docs/er/*.mmd` | แต่ละคนอธิบาย entity/attribute/relationship ของส่วนตน |
| 5.2 ER-Diagram | `docs/er/er_full.png`, `er_member_{A,B,C}_*.png`, `er_core_shared.png` | ใส่รูปและอธิบายตารางกลาง (patient, staff, department, visit) |
| 5.3 Relational Schema | `schema.sql` (22 ตาราง) | แปลงเป็นตารางในรายงาน; A: booking, feedback · C: room, bed, visit, admission, diagnosis, lab_result, insurance_coverage, daily_charge · B: drug, drug_lot, prescription, prescription_item, dispense_record, inventory, drug_allergy_record · กลาง: department, staff, patient, profiles, chat_logs |
| 5.4 Normalization | ตัวอย่าง: `booking` (นัดหมาย) หรือ `visit`/`daily_charge` | เขียน 1NF→2NF→3NF อย่างน้อย 1 ตัวอย่าง |
| 5.5 Views (≥6) | 10 views ใน `db/05_views.sql` | อธิบายแต่ละ view และ SQL |
| 5.6 SQL Script | `schema.sql`, `seed.sql` | แนบไฟล์ |
| 6 SQL วิเคราะห์ | `analysis/analysis_queries.sql` (19 คำสั่ง), `docs/report/analysis.md` | เติม "การแปลความหมาย" ทุกข้อ และจับภาพผลลัพธ์ |
| 7 Web App | `web/` | ถ่ายภาพหน้าจอ Registration/Login/CRUD/Views/Dashboard จากระบบที่ deploy แล้ว (รวมข้อความ "ยังไม่ได้รับสิทธิ์" ของบัญชีที่เพิ่งสมัคร) |
| 8 Chat | `supabase/functions/chat-mcp/` (หลัก, MCP วิธี C), `supabase/functions/chat/` (สำรอง, Text-to-SQL วิธี B), `docs/test-cases.md` | ระบุ LLM+รุ่นที่ใช้ (Groq `openai/gpt-oss-120b` ผ่าน secret `LLM_MODEL`), วาดแผนภาพสถาปัตยกรรม (Web → Edge Function → LLM → Supabase), ภาพหน้าจอ Chat |
| 10 Testing | `docs/test-cases.md` | รันกรณี *todo* บนระบบจริง (รวมถามด้วย LLM จริง) |
| 12 นำเสนอรายบุคคล | `docs/er/er_member_*.png` | คนละ ~5 นาที: ER, schema, normalization, views, SQL 1 ตัวอย่าง |
| ส่งงาน | `schema.sql`, `seed.sql`, `analysis_queries.sql`, zip dataset, ลิงก์เว็บบน Render, ลิงก์ GitHub (และ Docker Hub), วิดีโอ ≤ 5 นาที | รายงาน PDF (TH Sarabun PSK 14pt), สไลด์ PDF รวมไฟล์เดียว, วิดีโอ |
