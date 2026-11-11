# Role-based Reports & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patient accounts no longer get the "รายงาน (Views)" tab, and the Dashboard shows each role only the charts for its job, while admin sees every chart.

**Architecture:** One pure module `web/js/roleUi.js` decides which tabs an account gets (`tabsFor`) and which charts a role gets (`chartsFor`); `app.js` uses `tabsFor` to hide/guard tabs, and `dashboard.js` becomes a registry of chart builders it draws in `chartsFor(role)` order. This is a UI change only: the database (views, RLS) is untouched, because the patient Chat answers from the per-patient views and the patient Dashboard reads its own rows of `v_visit_billing`.

**Tech Stack:** Vanilla ES modules, Chart.js 4.4.1 (CDN), supabase-js, `node --test` unit tests, Playwright smoke test with mocked Supabase (`web/tests/smoke.mjs`).

**Spec:** the user's request (2026-11-10):
1. "รายงาน (view) ไม่ควรมีสำหรับ user ทั่วไป (patient)"
2. "Dashboard ควรแยกสิ่งที่จะนำเสนอตาม role แต่ถ้าเป็น Admin เห็นทั้งหมดได้"

Roles come from `profiles.role` (`db/01_core.sql:38`): `admin`, `doctor`, `pharmacist`, `nurse`, `patient`. `getAccess()` returns `{ linked, role, patient }` (`web/js/authMessages.js` `accessFromProfile`).

## Decisions taken for the spec (review these first)

| Role | Tabs | Dashboard charts (in this order) |
|---|---|---|
| `admin` | data, views, dash, chat | `workload`, `billing`, `lowStock`, `beds`, `screening` (every staff chart) |
| `doctor` | data, views, dash, chat | `workload`, `beds` |
| `nurse` | data, views, dash, chat | `beds`, `workload` |
| `pharmacist` | data, views, dash, chat | `screening`, `lowStock` |
| `patient` | data, dash, chat (**no views**) | `myBilling` |
| `null` / unknown role (profile read failed; app already "counts as staff") | data, views, dash, chat | same as admin |

Chart catalog (ids are the contract between `roleUi.js` and `dashboard.js`):

| id | Title (exact copy) | Source | Shape |
|---|---|---|---|
| `workload` | `D1 จำนวนการจองต่อแพทย์ แยกตามสถานะ` | `v_doctor_workload` | unchanged (stacked bar) |
| `billing` | `D2 ค่ารักษารายเดือน แยกตามแผนก (บาท)` | `v_visit_billing` | unchanged |
| `lowStock` | `D3 ยาที่ต่ำกว่าจุดสั่งซื้อ` | `v_inventory_stock_status` | unchanged |
| `beds` | `D4 เตียงที่ใช้อยู่และว่าง แยกตามแผนก` | `v_bed_occupancy` `department,occupied_beds,available_beds` | stacked bar, labels = department (null → `ไม่ระบุแผนก`), datasets `ใช้อยู่` (sum occupied_beds), `ว่าง` (sum available_beds) |
| `screening` | `D5 ใบสั่งยารอคัดกรอง แยกตามสถานะ` | `v_pharmacist_screening_queue` `prescription_id,prescription_status` | bar, labels = status, value = **distinct** prescription_id count (the view has one row per item) |
| `myBilling` | `ค่ารักษาของฉันรายเดือน (บาท)` | `v_visit_billing` `month,total_amount` (RLS returns only the patient's own rows) | bar, one dataset `ค่ารักษา`, months ascending |

Database access is **not** changed: a patient can still `select` the views through the API (summary views have no patient identity; per-patient views are filtered to own rows). If you want the API closed too, that is a separate DB migration — out of scope here.

## Global Constraints

- No new dependencies; Chart.js stays `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`.
- UI copy in Thai, exactly as in the tables above and in the task steps.
- `roleUi.js` and `helpers.js` stay pure (no DOM, no supabase import) so `node --test` can load them.
- Work on branch `feat/role-dashboard` off `main`; commit messages follow the repo style (`feat(web): …` Thai or English).
- All of `node --test web/tests/*.test.mjs scripts/*.test.mjs` and `node web/tests/smoke.mjs` must pass at the end of every task.

## Review Focus

1. A patient who opens `app.html#views` (old bookmark / landing shortcut / `aie313.nextTab`) must land on the data tab, never on the reports page → smoke test in Task 3.
2. A patient clicking where the hidden button was, or a script dispatching a click with `data-tab="views"`, must not mount the reports page → `show()` ignores tabs not in `tabsFor(access)`; covered by the hash test plus the `tabsFor` unit test.
3. One chart's query failing (e.g. view missing) must not stop the other charts of that role from drawing; error text goes to the shared `.err` line → each builder catches its own error; smoke test in Task 2 with a mocked error on one view.
4. A role string the UI does not know (e.g. a future `technician` profile, or `null` after a failed profile read) must still get a working dashboard, not an empty page or a crash → `chartsFor` falls back to the admin list; unit test in Task 1.
5. `v_pharmacist_screening_queue` returns one row per prescription item; counting rows would overstate the queue → `countDistinctBy` unit test with two items of one prescription in Task 1.

---

### Task 1: Pure role rules and the distinct-count helper

**Files:**
- Create: `web/js/roleUi.js`
- Modify: `web/js/helpers.js` (append one export)
- Test: `web/tests/roleUi.test.mjs` (new), `web/tests/helpers.test.mjs` (append)

**Interfaces:**
- Produces:
  - `export const ALL_TABS = ['data', 'views', 'dash', 'chat']`
  - `export const STAFF_CHARTS = ['workload', 'billing', 'lowStock', 'beds', 'screening']`
  - `export function tabsFor(access: { patient?: boolean } = {}): string[]` — patient → `['data', 'dash', 'chat']`, otherwise `ALL_TABS` (a copy).
  - `export function chartsFor(role: string | null | undefined): string[]` — the table above; `admin`, `null`, `undefined` and any unknown string → copy of `STAFF_CHARTS`.
  - `export function countDistinctBy(rows: object[], groupKey: string, idKey: string): { key: any, count: number }[]` in `helpers.js` — groups in first-seen order.

- [ ] **Step 1: Write the failing tests** in `web/tests/roleUi.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tabsFor, chartsFor, ALL_TABS, STAFF_CHARTS } from '../js/roleUi.js';

test('patient has no reports tab; staff and unknown get every tab', () => {
  assert.deepEqual(tabsFor({ patient: true }), ['data', 'dash', 'chat']);
  assert.deepEqual(tabsFor({ patient: false, role: 'nurse' }), ['data', 'views', 'dash', 'chat']);
  assert.deepEqual(tabsFor(), ALL_TABS);
});
test('dashboard charts per role; admin sees every staff chart', () => {
  assert.deepEqual(chartsFor('admin'), ['workload', 'billing', 'lowStock', 'beds', 'screening']);
  assert.deepEqual(chartsFor('doctor'), ['workload', 'beds']);
  assert.deepEqual(chartsFor('nurse'), ['beds', 'workload']);
  assert.deepEqual(chartsFor('pharmacist'), ['screening', 'lowStock']);
  assert.deepEqual(chartsFor('patient'), ['myBilling']);
});
test('unknown or missing role falls back to the admin set', () => {
  for (const r of [null, undefined, 'technician']) assert.deepEqual(chartsFor(r), STAFF_CHARTS);
});
test('returned arrays are copies', () => {
  chartsFor('admin').push('x'); tabsFor().push('x');
  assert.equal(chartsFor('admin').length, 5); assert.equal(tabsFor().length, 4);
});
```

Append to `web/tests/helpers.test.mjs` (add `countDistinctBy` to its import):

```js
test('countDistinctBy counts each id once per group', () => {
  const rows = [{ s: 'Pending', id: 1 }, { s: 'Pending', id: 1 }, { s: 'Screened', id: 2 }, { s: 'Pending', id: 3 }];
  assert.deepEqual(countDistinctBy(rows, 's', 'id'), [{ key: 'Pending', count: 2 }, { key: 'Screened', count: 1 }]);
  assert.deepEqual(countDistinctBy([], 's', 'id'), []);
});
```

- [ ] **Step 2: Run to verify failure**
Run: `node --test web/tests/roleUi.test.mjs web/tests/helpers.test.mjs`
Expected: FAIL — `Cannot find module .../roleUi.js` and `countDistinctBy` is not exported.

- [ ] **Step 3: Implement** `web/js/roleUi.js` (a `ROLE_CHARTS` object literal for doctor/nurse/pharmacist/patient, `Object.hasOwn` lookup so `'constructor'` falls back) and `countDistinctBy` in `helpers.js` (`Map` of key → `Set` of ids).

- [ ] **Step 4: Run to verify pass**
Run: `node --test web/tests/*.test.mjs scripts/*.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**
```bash
git checkout -b feat/role-dashboard
git add web/js/roleUi.js web/js/helpers.js web/tests/roleUi.test.mjs web/tests/helpers.test.mjs
git commit -m "feat(web): กำหนดแท็บและกราฟ Dashboard ตาม role (roleUi.js)"
```

### Task 2: Dashboard draws only the role's charts

**Files:**
- Modify: `web/js/dashboard.js` (whole `mountDashboard`)
- Modify: `web/js/app.js:5` (`dash` mount passes `access`)
- Test: `web/tests/smoke.mjs`

**Interfaces:**
- Consumes: `chartsFor(role)` from Task 1; `countDistinctBy`, `pivot`, `sumBy` from `helpers.js`.
- Produces: `export async function mountDashboard(el: HTMLElement, access: { role?: string } = {}): Promise<void>`; internal `const CHARTS = { workload, billing, lowStock, beds, screening, myBilling }`, each `async (grid, msg) => void` that creates its card with the exact title from the catalog, queries, and draws (or shows `ไม่พบข้อมูล`). Charts are created in `chartsFor(access.role)` order; each builder wraps its own work in `try/catch` and on error sets `msg.textContent = friendlyError(error)` and shows the card's empty state.

- [ ] **Step 1: Extend the smoke mock and write failing checks** in `web/tests/smoke.mjs`:
  - Add to `DB`: `v_bed_occupancy: [{ department: 'อายุรกรรม', occupied_beds: 3, available_beds: 1 }, { department: 'อายุรกรรม', occupied_beds: 1, available_beds: 1 }, { department: null, occupied_beds: 0, available_beds: 2 }]`, `v_pharmacist_screening_queue: [{ prescription_id: 1, prescription_status: 'Pending' }, { prescription_id: 1, prescription_status: 'Pending' }, { prescription_id: 2, prescription_status: 'Screened' }]`; add profiles `{ user_id: 'u-pharm', role: 'pharmacist' }`, `{ user_id: 'u-nurse', role: 'nurse' }`; map e-mails `ph@b.th` → `u-pharm`, `ns@b.th` → `u-nurse` in `signInWithPassword`.
  - Add a way to fail one view: in `then()`, `if (window.__failView === table) return res({ data: null, error: { code: '42P01', message: 'relation does not exist' } });`
  - Replace the check `dashboard draws 3 charts with merged D2 totals` with `admin dashboard draws all 5 staff charts in order`: reset `window.__charts = []` before clicking; wait for length 5; assert `window.__charts[1].data.datasets[0].data` deep-equals `[150]`; assert the 5 `#panel h3` texts start with `D1`,`D2`,`D3`,`D4`,`D5`; assert D4 (`__charts[3]`) labels `['อายุรกรรม','ไม่ระบุแผนก']` and datasets data `[4, 0]` and `[2, 2]`; assert D5 (`__charts[4]`) labels `['Pending','Screened']`, data `[1, 1]`.
  - Place the pharmacist and nurse checks just before `no uncaught page errors` (after every admin and patient check), each starting from `goto base + '/index.html'` with `mock_session` removed, as the patient check does.
  - Add check `pharmacist dashboard shows only D5 then D3` (log out, log in `ph@b.th`, click dash): `#panel h3` texts are exactly `['D5 ใบสั่งยารอคัดกรอง แยกตามสถานะ', 'D3 ยาที่ต่ำกว่าจุดสั่งซื้อ']`.
  - Add check `nurse dashboard: one failing chart does not block the other` (log in `ns@b.th`, set `window.__failView = 'v_bed_occupancy'` via `page.evaluate` after load, click dash): two `h3` (D4, D1), D1 chart drawn (`__charts` has a config whose first dataset label is a booking status), `#panel .err` non-empty, D4 card shows `ไม่พบข้อมูล`. Clear `__failView` after.
- [ ] **Step 2: Run to verify failure**
Run: `PLAYWRIGHT_PATH=<playwright> node web/tests/smoke.mjs`
Expected: the three new/changed dashboard checks FAIL (only 3 charts, no role filtering).
- [ ] **Step 3: Implement** the `CHARTS` registry in `dashboard.js` (move D1–D3 bodies into `workload`/`billing`/`lowStock` unchanged; add `beds`, `screening`, `myBilling` per the catalog), loop `for (const id of chartsFor(access.role)) await CHARTS[id](grid, msg);`, and change `app.js` mount to `dash: async (el, access) => (await import('./dashboard.js')).mountDashboard(el, access)`.
- [ ] **Step 4: Run to verify pass** — same command; Expected: every line `PASS`, exit 0. Also `node --test web/tests/*.test.mjs scripts/*.test.mjs` PASS.
- [ ] **Step 5: Commit**
```bash
git add web/js/dashboard.js web/js/app.js web/tests/smoke.mjs
git commit -m "feat(web): Dashboard แสดงกราฟตาม role (admin เห็นทั้งหมด) เพิ่ม D4 เตียง D5 คิวคัดกรองยา และกราฟค่ารักษาของผู้ป่วย"
```

### Task 3: Patients get no reports tab

**Files:**
- Modify: `web/js/app.js` (`HEADINGS.dash`, `PATIENT_HEADINGS`, `init`/`show`)
- Test: `web/tests/smoke.mjs`

**Interfaces:**
- Consumes: `tabsFor(access)` from Task 1.

- [ ] **Step 1: Write failing smoke checks** (after the existing patient check, still signed in as `pt@b.th`):
  - `patient: no reports tab, own-billing dashboard`: `await page.isVisible('[data-tab=views]')` is `false`; visible nav buttons' `data-tab` = `['data','dash','chat']`; reset `__charts`, click dash; `#page-title` = `ภาพรวมของฉัน`; exactly one `#panel h3` = `ค่ารักษาของฉันรายเดือน (บาท)`; its chart data = `[150]` (mock `v_visit_billing` rows summed for `2026-10`).
  - `patient: app.html#views falls back to the data tab`: `goto about:blank` then `goto base + '/app.html#views'`; wait for `#t`; `#page-title` = `ข้อมูลของฉัน`; `#v` count is 0.
  - In the admin dashboard check from Task 2, also assert `#page-desc` = `กราฟตามหน้าที่ของบัญชีนี้ ผู้ดูแลระบบเห็นทุกกราฟ`.
- [ ] **Step 2: Run to verify failure** — smoke command; Expected: these checks FAIL (views button visible, title falls back to `Dashboard`).
- [ ] **Step 3: Implement** in `app.js`:
  - `HEADINGS.dash = ['Dashboard', 'กราฟตามหน้าที่ของบัญชีนี้ ผู้ดูแลระบบเห็นทุกกราฟ']`.
  - `PATIENT_HEADINGS`: delete `views`; add `dash: ['ภาพรวมของฉัน', 'ค่ารักษารายเดือนของคุณ']`.
  - In `init`: `const tabs = tabsFor(access);` set `b.hidden = !tabs.includes(b.dataset.tab)` on each `#nav button`; `show(tab)` returns early when `!tabs.includes(tab)`; start with `show(tabs.includes(wanted) ? wanted : 'data')`.
- [ ] **Step 4: Run to verify pass** — smoke command and `node --test …`; Expected: all PASS, `no uncaught page errors` PASS.
- [ ] **Step 5: Commit**
```bash
git add web/js/app.js web/tests/smoke.mjs
git commit -m "feat(web): ซ่อนแท็บรายงาน (Views) จากบัญชีผู้ป่วย"
```

### Task 4: Docs match the new behaviour

**Files:**
- Modify: `README.md:34-38` (permission table), `docs/test-cases.md` rows `D1`, `P5`

- [ ] **Step 1: Update README table** — header stays; `patient` last column becomes: `ไม่มีแท็บรายงาน; Dashboard แสดงค่ารักษารายเดือนของตัวเอง; chat ตอบจาก view รายคน (เฉพาะของตัวเอง) และ view ภาพรวม`; staff row becomes `ทุกตาราง | รายงานทุกแถว; Dashboard ตาม role (admin ทุกกราฟ, doctor D1 D4, nurse D4 D1, pharmacist D5 D3)`.
- [ ] **Step 2: Update test-cases** — `D1`: `Open Dashboard as admin / doctor / nurse / pharmacist` → expected `admin 5 charts D1–D5; doctor D1 D4; nurse D4 D1; pharmacist D5 D3`, result `mock PASS (admin, nurse, pharmacist)`; `P5`: `Patient: menu and Dashboard` → expected `No "รายงาน (Views)" tab; #views opens "ข้อมูลของฉัน"; Dashboard shows only "ค่ารักษาของฉันรายเดือน"`, status `mock PASS, todo`.
- [ ] **Step 3: Verify** — `bash db/build_schema.sh && git diff --exit-code -- schema.sql seed.sql` (no DB change, must be clean); full web tests pass.
- [ ] **Step 4: Commit**
```bash
git add README.md docs/test-cases.md
git commit -m "docs: สิทธิ์รายงานและ Dashboard ตาม role"
```
