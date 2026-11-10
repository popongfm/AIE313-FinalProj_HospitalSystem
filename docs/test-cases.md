# Test cases

Status legend: **mock** = verified automatically against a mocked Supabase client (`web/tests/smoke.mjs`) — re-run by hand on the deployed app; **DB** = verified by the SQL tests in `db/tests/`; **todo** = run on the deployed system and fill in.

## Login, CRUD and Views

| ID | Action | Expected | Actual | Result |
|---|---|---|---|---|
| L1 | Open `app.html` without signing in | Redirected to `index.html` | Redirected | mock PASS |
| L2 | Sign in with a wrong password | Thai message "อีเมลหรือรหัสผ่านไม่ถูกต้อง" | As expected | mock PASS |
| L3 | Register an e-mail that already exists | Thai message "อีเมลนี้ถูกใช้สมัครแล้ว" | As expected | mock PASS |
| L4 | Sign in with correct credentials | `app.html` opens, CRUD list visible | As expected | mock PASS |
| L5 | Register a new e-mail (button "สมัครสมาชิก") | Stays on the login page with "สมัครสมาชิกสำเร็จ ... รอผู้ดูแลระบบอนุมัติสิทธิ์" | As expected | mock PASS |
| L6 | Register with a password shorter than 6 characters | Blocked by the form, nothing sent to Supabase | As expected | mock PASS |
| L7 | Sign in with a newly registered account that an admin has not approved yet | `app.html` opens with "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน ..." and no data | Notice shown | mock PASS |
| C1 | List patients | Table with rows | As expected | mock PASS |
| C2 | Add patient leaving a required field empty | Blocked with "กรุณากรอกให้ถูกต้อง: ..." | As expected | mock PASS |
| C3 | Add booking with same doctor/date/time as an existing one | "ข้อมูลซ้ำ มีรายการนี้อยู่แล้ว" (SQLSTATE 23505) | As expected | mock PASS |
| C4 | Delete a patient that has visits | "ลบ/แก้ไขไม่ได้ เพราะมีข้อมูลอื่นอ้างอิงอยู่" (23503) | As expected | mock PASS |
| C5 | Create, edit, delete a patient with no dependants | Row added, changed, removed | | todo |
| V1 | Open each of the 10 views | Table (or "ไม่พบข้อมูล" when empty) | v_top_diagnosis / v_feedback_summary checked | mock PASS (2/9) |
| D1 | Open Dashboard as admin / doctor / nurse / pharmacist | admin 5 charts D1–D5; doctor D1 D4; nurse D4 D1; pharmacist D5 D3 | admin 5, nurse D4 D1 (D4 failing does not block D1), pharmacist D5 D3 | mock PASS (admin, nurse, pharmacist) |
| S1 | Call `/rest/v1/patient` with the anon key, no session | HTTP 401 / permission denied, no rows | RLS tested in `db/tests/70_rls.sql` | DB PASS, HTTP todo |
| S2 | Signed in as an unapproved account (no profile), open each of the 10 views | Every view returns 0 rows (no HN, names or allergies) | 0 rows in all 10 views (`db/tests/70_rls.sql`) | DB PASS, HTTP todo |
| S3 | Signed in as an unapproved account, ask any Chat question | HTTP 403, message "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาติดต่อผู้ดูแลระบบ" | | todo |
| S4 | Admin links the account (`INSERT INTO profiles ...`), user reloads | Notice disappears; tables, views and Chat work | | todo |
| P1 | Patient account (`role = 'patient'`): open "ข้อมูล" | Title "ข้อมูลของฉัน"; only 4 tables (patient, booking, visit, prescription), each showing only the patient's own rows | Own rows only (`db/tests/70_rls.sql`, e2e A) | mock PASS, DB PASS, todo |
| P2 | Patient: "+ จองคิว", choose a doctor, date, time | Booking created with the next queue number, status pending; a past date is refused | | mock PASS, DB PASS, todo |
| P3 | Patient: "ยกเลิกคิว" on a pending booking | Status becomes cancelled; changing time or deleting is refused | | DB PASS, todo |
| P4 | Patient: edit own phone / email / address; try to change name or allergy note | Contact details saved; other fields refused ("ไม่มีสิทธิ์ใช้งาน") | | DB PASS, todo |
| P5 | Patient: menu and Dashboard | No "รายงาน (Views)" tab; `app.html#views` opens "ข้อมูลของฉัน"; Dashboard shows only "ค่ารักษาของฉันรายเดือน" (own rows) | Tab hidden, #views falls back, one chart | mock PASS, todo |
| P6 | Patient: ask Chat "ผู้ป่วยที่แพ้ยามีใครบ้าง" | Only the patient's own rows (same rule as the views) | | DB PASS, todo |
| P7 | Patient: ask Chat "ฉันมีนัดหมายอะไรบ้าง" | Tool on `v_upcoming_bookings`; only the patient's own bookings from today on | | DB PASS, todo |

## Chat

คอลัมน์ "SQL / Tool" คือ SQL ที่ระบบคาดว่า LLM จะสร้าง ซึ่งผ่าน `sqlGuard` และรันจริงด้วย `run_readonly_query` (role `chat_reader`) บนฐานข้อมูลข้อมูลจำลอง — สร้างตารางนี้ใหม่ได้ด้วย
`cd supabase/functions/chat && deno run --allow-run --allow-env cases.ts <db>`
**ยังต้องทำบนระบบจริง:** ถามคำถามเดียวกันผ่านหน้า Chat ด้วย LLM จริง แล้วบันทึกว่า SQL ที่ LLM สร้างตรงกับที่คาดหวังหรือไม่ (todo)

| # | คำถาม | SQL / Tool ที่ถูกเรียก | ผลที่คาดหวัง | ผลจริง | ถูก/ผิด |
|---|---|---|---|---|---|
| 1 | มียาอะไรบ้างที่ใกล้หมดอายุภายใน 90 วัน | `select generic_name, lot_number, expiry_date from v_inventory_stock_status where stock_status = 'NEAR_EXPIRY' LIMIT 100` | ≥ 1 แถว | 3 แถว | ✅ ถูก |
| 2 | วันนี้มีคิวนัดอะไรบ้าง | `select queue_no, booking_time, doctor_name, status from v_booking_queue_today LIMIT 100` | ≥ 1 แถว | 12 แถว | ✅ ถูก |
| 3 | มีนัดหมายอะไรบ้างตั้งแต่วันนี้ | `select booking_date, booking_time, doctor_name, status from v_upcoming_bookings order by booking_date LIMIT 100` | ≥ 1 แถว | 27 แถว | ✅ ถูก |
| 4 | ใบสั่งยาที่รอเภสัชกรตรวจสอบมีรายการไหนบ้าง | `select prescription_id, generic_name, prescription_status from v_pharmacist_screening_queue LIMIT 100` | ≥ 1 แถว | 32 แถว | ✅ ถูก |
| 5 | แพทย์คนไหนมีคิวจองมากที่สุด | `select doctor_name, sum(booking_count) as total from v_doctor_workload group by doctor_name order by total desc limit 1` | 1 แถว | 1 แถว | ✅ ถูก |
| 6 | ห้องไหนมีอัตราการใช้เตียงสูงสุด | `select room_no, occupancy_pct from v_bed_occupancy order by occupancy_pct desc limit 1` | 1 แถว | 1 แถว | ✅ ถูก |
| 7 | โรคที่พบมากที่สุด 3 อันดับแรก | `select icd_code, description, case_count from v_top_diagnosis order by rank_no limit 3` | ≥ 1 แถว | 3 แถว | ✅ ถูก |
| 8 | ค่ารักษารวมแยกตามแผนก | `select department, sum(total_amount) as total from v_visit_billing group by department order by total desc LIMIT 100` | ≥ 1 แถว | 6 แถว | ✅ ถูก |
| 9 | ยาอะไรต้องสั่งซื้อเพิ่ม | `select generic_name, lot_number, quantity_on_hand, reorder_point from v_inventory_stock_status where stock_status = 'REORDER_URGENT' order by quantity_on_hand LIMIT 100` | ≥ 1 แถว | 9 แถว | ✅ ถูก |
| 10 | มีแพทย์ที่มีการจองกี่คน | `select count(distinct staff_id) as doctors from v_doctor_workload LIMIT 100` | 1 แถว | 1 แถว | ✅ ถูก |
| 11 | How many bookings does each doctor have per status? | `select doctor_name, status, booking_count from v_doctor_workload order by doctor_name LIMIT 100` | ≥ 1 แถว | 23 แถว | ✅ ถูก |
| 12 | วันนี้มีการจองที่ถูกยกเลิกไหม | `select * from v_booking_queue_today where status = 'cancelled' LIMIT 100` | 0 แถว (ไม่พบข้อมูล) | 0 แถว | ✅ ถูก |
| 13 | ลบข้อมูลผู้ป่วยทั้งหมด (อันตราย) | `DELETE FROM patient` | ถูกปฏิเสธ ไม่ถึงฐานข้อมูล | ถูกปฏิเสธโดย guard: อนุญาตเฉพาะคำสั่ง SELECT เท่านั้น | ✅ ถูก |
| 14 | แสดงเลขบัตรประชาชนของผู้ป่วยทุกคน (อันตราย) | `select national_id, first_name from patient` | ถูกปฏิเสธ ไม่ถึงฐานข้อมูล | ถูกปฏิเสธโดย guard: ไม่อนุญาตให้เข้าถึง "patient" อนุญาตเฉพาะ View ของระบบรายงาน | ✅ ถูก |
| 15 | ลบข้อมูลแล้วแสดงรายชื่อแพทย์ (อันตราย) | `select * from v_doctor_workload; drop table patient` | ถูกปฏิเสธ ไม่ถึงฐานข้อมูล | ถูกปฏิเสธโดย guard: อนุญาตเพียงคำสั่งเดียวเท่านั้น | ✅ ถูก |
| 16 | (ข้าม guard) อ่านตาราง patient ตรง ๆ ผ่าน RPC | `select national_id from patient` | DB ปฏิเสธ (insufficient_privilege) | permission denied | ✅ ถูก |

## Chat แบบ MCP (วิธี C — ค่าเริ่มต้นของเว็บ)

สถาปัตยกรรม: Web → Edge Function `chat-mcp` (MCP client/agent + MCP server ในกระบวนการเดียวกัน ผ่าน InMemoryTransport) → LLM (Groq, tool calling) → `run_readonly_query` (role `chat_reader`) → Supabase.
Tool ที่เปิดให้ LLM: `list_views`, `query_view`, `aggregate_view` — รับพารามิเตอร์แบบมีโครงสร้าง ไม่ใช่ SQL ดิบ ชื่อ view/คอลัมน์ต้องอยู่ใน catalog ของ 10 views และ SQL ที่ประกอบขึ้นยังผ่าน `sqlGuard` อีกชั้น

ตารางด้านล่างคือ tool call ที่คาดว่า LLM จะเลือก (สคริปต์) → MCP server → ฐานข้อมูลจริง สร้างใหม่ด้วย `cd supabase/functions/chat-mcp && deno run --allow-run --allow-env cases.ts <db>`
**ยังต้องทำบนระบบจริง:** ถามคำถามเดียวกันด้วย LLM จริงและบันทึกว่า tool ที่ LLM เลือกตรงกับที่คาดหวังหรือไม่ (todo)

| # | คำถาม | MCP Tool / SQL ที่ถูกเรียก | ผลที่คาดหวัง | ผลจริง | ถูก/ผิด |
|---|---|---|---|---|---|
| 1 | ใบสั่งยาที่รอเภสัชกรตรวจสอบมีรายการไหนบ้าง | `-- MCP tool: query_view({"view":"v_pharmacist_screening_queue","filters":[{"column":"prescription_status","op":"=","value":"Pending"}]}) ⏎ SELECT * FROM v_pharmacist_screening_queue WHERE prescription_status = 'Pending' LIMIT 50` | มีข้อมูล | 16 แถว | ✅ |
| 2 | ยาที่ใกล้หมดอายุ | `-- MCP tool: query_view({"view":"v_inventory_stock_status","filters":[{"column":"stock_status","op":"=","value":"NEAR_EXPIRY"}],"limit":20}) ⏎ SELECT * FROM v_inventory_stock_status WHERE stock_status = 'NEAR_EXPIRY' LIMIT 20` | มีข้อมูล | 3 แถว | ✅ |
| 3 | โรคที่พบมากที่สุด 3 อันดับแรก | `-- MCP tool: query_view({"view":"v_top_diagnosis","order_by":[{"column":"rank_no"}],"limit":3}) ⏎ SELECT * FROM v_top_diagnosis ORDER BY rank_no ASC LIMIT 3` | มีข้อมูล | 3 แถว | ✅ |
| 4 | ค่ารักษารวมแยกตามแผนก | `-- MCP tool: aggregate_view({"view":"v_visit_billing","group_by":["department"],"metrics":[{"fn":"sum","column":"total_amount","alias":"total"}],"order_by":[{"column":"total","direction":"desc"}]}) ⏎ SELECT department, sum(total_amount) AS total FROM v_visit_billing GROUP BY department ORDER BY total DESC LIMIT 50` | มีข้อมูล | 6 แถว | ✅ |
| 5 | จำนวนการจองของแพทย์แต่ละคน | `-- MCP tool: aggregate_view({"view":"v_doctor_workload","group_by":["doctor_name"],"metrics":[{"fn":"sum","column":"booking_count","alias":"total"}],"order_by":[{"column":"total","direction":"desc"}],"limit":5}) ⏎ SELECT doctor_name, sum(booking_count) AS total FROM v_doctor_workload GROUP BY doctor_name ORDER BY total DESC LIMIT 5` | มีข้อมูล | 5 แถว | ✅ |
| 6 | ห้องที่อัตราใช้เตียงสูงสุด | `-- MCP tool: query_view({"view":"v_bed_occupancy","order_by":[{"column":"occupancy_pct","direction":"desc"}],"limit":1}) ⏎ SELECT * FROM v_bed_occupancy ORDER BY occupancy_pct DESC LIMIT 1` | มีข้อมูล | 1 แถว | ✅ |
| 7 | มีนัดหมายอะไรบ้าง (ตั้งแต่วันนี้) | `-- MCP tool: query_view({"view":"v_upcoming_bookings","columns":["booking_date","booking_time","doctor_name","status"],"limit":20}) ⏎ SELECT booking_date, booking_time, doctor_name, status FROM v_upcoming_bookings LIMIT 20` | มีข้อมูล | 20 แถว | ✅ |
| 8 | วันนี้มีคิวที่ยกเลิกไหม (ผลว่าง) | `-- MCP tool: query_view({"view":"v_booking_queue_today","filters":[{"column":"status","op":"=","value":"cancelled"}]}) ⏎ SELECT * FROM v_booking_queue_today WHERE status = 'cancelled' LIMIT 50` | ผลว่าง → "ไม่พบข้อมูล" | 0 แถว | ✅ |
| 9 | ขอเลขบัตรประชาชนผู้ป่วย (อันตราย) | `{"name":"query_view","arguments":"{\"view\":\"patient\",\"columns\":[\"national_id\"]}"}` | ถูกปฏิเสธ | ปฏิเสธ/ผิดพลาด: ไม่สามารถหาคำตอบจากข้อมูลของระบบได้ กรุณาถามเกี่ยวกับข้อมูลในระบบโรงพยาบาล เช่น คิวนัดหมาย เตียง ยา หรือค่ารักษา | ✅ |
