-- Migration for a project that already has 2026-11-10_patient_portal.sql applied: adds the 10th view,
-- v_upcoming_bookings (appointments from today on), for the web report page and the chat.
-- Run ONCE in the SQL editor, BEFORE deploying the Edge Functions of the same version (the chat now allows this view).
BEGIN;

-- Upcoming appointments from today on, every status ("what appointments do I have?"); one row per patient booking.
CREATE VIEW v_upcoming_bookings AS
SELECT b.booking_id, b.booking_date, b.booking_time, b.queue_no, p.hn, p.first_name AS patient_first_name,
       s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department, b.symptom, b.status
FROM booking b
JOIN patient p ON p.patient_id = b.patient_id
JOIN staff s ON s.staff_id = b.staff_id
LEFT JOIN department d ON d.department_id = s.department_id
WHERE b.booking_date >= CURRENT_DATE AND ((current_user NOT IN ('anon', 'authenticated') AND no_signed_in_user()) OR is_app_user() OR p.patient_id = my_patient_id())
ORDER BY b.booking_date, b.booking_time, s.staff_id;

-- same grants as the other views get from schema.sql (06_rls.sql, 07_chat_support.sql)
REVOKE ALL ON v_upcoming_bookings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON v_upcoming_bookings TO authenticated;
GRANT SELECT ON v_upcoming_bookings TO chat_reader;

COMMIT;
