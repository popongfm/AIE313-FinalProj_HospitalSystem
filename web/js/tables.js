// CRUD form definitions. `type` is 'text' | 'number' | 'date' | 'time' | 'select'.
import { statusInfo } from './helpers.js';
// select options: the database value, shown with its Thai name
const statuses = (values) => values.map((value) => ({ value, label: statusInfo(value).label }));
const t = (name, label, required = false) => ({ name, label, type: 'text', required });
const n = (name, label, required = false) => ({ name, label, type: 'number', required });
const d = (name, label, required = false) => ({ name, label, type: 'date', required });
const s = (name, label, options, required = false) => ({ name, label, type: 'select', options, required });
export const TABLES = {
  patient: { label: 'ผู้ป่วย', pk: 'patient_id', cols: [t('hn', 'HN', true), t('national_id', 'เลขบัตรประชาชน', true), t('first_name', 'ชื่อ', true), t('last_name', 'นามสกุล', true),
    d('birth_date', 'วันเกิด'), s('gender', 'เพศ', [{ value: 'M', label: 'ชาย' }, { value: 'F', label: 'หญิง' }, { value: 'O', label: 'อื่น ๆ' }]), t('phone', 'โทรศัพท์ (10 หลัก)'), t('email', 'อีเมล'), t('address', 'ที่อยู่'), t('blood_type', 'หมู่เลือด'), t('allergy_note', 'บันทึกการแพ้')] },
  booking: { label: 'การจองคิว', pk: 'booking_id', cols: [n('patient_id', 'รหัสผู้ป่วย', true), n('staff_id', 'รหัสแพทย์', true), d('booking_date', 'วันที่นัด', true),
    { name: 'booking_time', label: 'เวลา', type: 'time', required: true }, n('queue_no', 'ลำดับคิว', true), t('symptom', 'อาการ'), s('status', 'สถานะ', statuses(['pending', 'confirmed', 'completed', 'cancelled']), true)] },
  visit: { label: 'การเข้ารับบริการ', pk: 'visit_id', cols: [n('patient_id', 'รหัสผู้ป่วย', true), n('staff_id', 'รหัสแพทย์'), s('visit_type', 'ประเภท', ['OPD', 'IPD', 'ER'], true),
    { name: 'admit_date', label: 'วันที่รับ', type: 'datetime-local', required: true }, { name: 'discharge_date', label: 'วันที่จำหน่าย', type: 'datetime-local', required: false }, t('status', 'สถานะ')] },
  prescription: { label: 'ใบสั่งยา', pk: 'prescription_id', cols: [n('visit_id', 'รหัส visit', true), n('staff_id', 'รหัสแพทย์', true), s('status', 'สถานะ', statuses(['Pending', 'Screened', 'Dispensed', 'Cancelled']), true), n('total_price', 'ราคารวม')] },
  drug: { label: 'ยา', pk: 'drug_id', cols: [t('generic_name', 'ชื่อสามัญ', true), t('trade_name', 'ชื่อการค้า', true), t('dosage_form', 'รูปแบบ', true), t('strength', 'ความแรง', true), t('unit', 'หน่วย', true)] },
  inventory: { label: 'สต็อกยา', pk: 'inventory_id', cols: [n('drug_id', 'รหัสยา', true), n('lot_id', 'รหัส lot', true), t('location', 'ตำแหน่งเก็บ', true), n('quantity_on_hand', 'จำนวนคงเหลือ', true), n('reorder_point', 'จุดสั่งซื้อ')] },
};

// Patient accounts (patient.user_id = the account): only their own rows come back from the database (RLS in 06_rls.sql).
// insert/edit/remove say which buttons to show; the database allows exactly these and nothing more.
export const PATIENT_TABLES = {
  patient: { label: 'ข้อมูลของฉัน', pk: 'patient_id', insert: false, remove: false,   // edit = contact details only
    cols: [t('phone', 'โทรศัพท์ (10 หลัก)'), t('email', 'อีเมล'), t('address', 'ที่อยู่')] },
  booking: { label: 'คิวนัดของฉัน', pk: 'booking_id', edit: false, remove: false, cancel: true, addLabel: '+ จองคิว',   // book and cancel; queue number is assigned
    cols: [{ name: 'staff_id', label: 'แพทย์', type: 'select', source: 'doctors', numeric: true, required: true },
      { name: 'booking_date', label: 'วันที่นัด', type: 'date', required: true, minToday: true },
      { name: 'booking_time', label: 'เวลา', type: 'time', required: true }, t('symptom', 'อาการ')] },
  visit: { label: 'การเข้ารับบริการของฉัน', pk: 'visit_id', readOnly: true, cols: [] },
  prescription: { label: 'ใบสั่งยาของฉัน', pk: 'prescription_id', readOnly: true, cols: [] },
};
