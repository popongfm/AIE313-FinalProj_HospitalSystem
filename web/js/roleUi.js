// What each account sees in the app, by the account's role (my_role(): staff.role or 'patient'). Pure (no DOM, no network) so node --test can load it.
// The database (RLS) still decides which rows come back; this only picks tabs and Dashboard charts.
export const ALL_TABS = ['data', 'views', 'dash', 'chat'];
// every staff chart, in Dashboard order; admin (and any role the page does not know) sees all of them
export const STAFF_CHARTS = ['workload', 'billing', 'lowStock', 'beds', 'screening'];
const ROLE_CHARTS = {
  doctor: ['workload', 'beds'],
  nurse: ['beds', 'workload'],
  pharmacist: ['screening', 'lowStock'],
  patient: ['myBilling'],
};
// patients have no reports tab
export function tabsFor(access = {}) {
  return access.patient ? ['data', 'dash', 'chat'] : [...ALL_TABS];
}
export function chartsFor(role) {
  return [...(typeof role === 'string' && Object.hasOwn(ROLE_CHARTS, role) ? ROLE_CHARTS[role] : STAFF_CHARTS)];
}
// the label in the app bar: who this account is in the hospital
const ROLE_LABELS = { admin: 'ผู้ดูแลระบบ', doctor: 'แพทย์', nurse: 'พยาบาล', pharmacist: 'เภสัชกร', patient: 'ผู้ป่วย' };
export function roleLabel(access = {}) {
  if (!access.linked) return 'รอผูกบัญชี';
  if (access.patient) return ROLE_LABELS.patient;
  return (typeof access.role === 'string' && Object.hasOwn(ROLE_LABELS, access.role)) ? ROLE_LABELS[access.role] : 'เจ้าหน้าที่';
}
