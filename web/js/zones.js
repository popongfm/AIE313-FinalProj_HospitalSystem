// Hospital wayfinding zones (same colours as the signs on index.html): every table, report and chart belongs to one.
// Pure (no DOM, no network) so node --test can load it.
export const ZONES = {
  appt: { id: 'appt', label: 'นัดหมาย', en: 'Appointments', icon: 'calendar', color: 'var(--z-appt)' },
  rec: { id: 'rec', label: 'เวชระเบียน', en: 'Medical records', icon: 'clipboard', color: 'var(--z-rec)' },
  rx: { id: 'rx', label: 'เภสัชกรรม', en: 'Pharmacy', icon: 'capsule', color: 'var(--z-rx)' },
  rep: { id: 'rep', label: 'รายงาน', en: 'Reports', icon: 'chart', color: 'var(--z-rep)' },
};
// the 10 reports, in menu order, with their Thai names
export const VIEW_LABELS = {
  v_booking_queue_today: 'คิวนัดวันนี้', v_upcoming_bookings: 'นัดหมายที่กำลังจะถึง', v_doctor_workload: 'ภาระงานแพทย์', v_feedback_summary: 'สรุปความพึงพอใจ',
  v_bed_occupancy: 'อัตราการใช้เตียง', v_visit_billing: 'ค่ารักษาตามการเข้ารับบริการ', v_top_diagnosis: 'การวินิจฉัยที่พบบ่อย',
  v_pharmacist_screening_queue: 'คิวคัดกรองใบสั่งยา', v_inventory_stock_status: 'สถานะสต็อกยา', v_drug_cost_summary: 'สรุปต้นทุนยา',
};
export const VIEWS = Object.keys(VIEW_LABELS);
const ZONE_OF = {
  patient: 'rec', booking: 'appt', visit: 'rec', prescription: 'rx', drug: 'rx', inventory: 'rx',
  v_booking_queue_today: 'appt', v_upcoming_bookings: 'appt', v_doctor_workload: 'appt', v_feedback_summary: 'appt',
  v_bed_occupancy: 'rec', v_visit_billing: 'rec', v_top_diagnosis: 'rec',
  v_pharmacist_screening_queue: 'rx', v_inventory_stock_status: 'rx', v_drug_cost_summary: 'rx',
  workload: 'appt', billing: 'rec', lowStock: 'rx', beds: 'rec', screening: 'rx', myBilling: 'rec',
};
export function zoneFor(key) { return ZONES[Object.hasOwn(ZONE_OF, key) ? ZONE_OF[key] : 'rep']; }
