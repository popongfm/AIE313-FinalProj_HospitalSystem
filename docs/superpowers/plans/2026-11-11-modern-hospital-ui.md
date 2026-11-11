# Modern Hospital UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Visual tasks also follow `frontend-design` (one bold idea, quiet everything else, critique from screenshots).

**Goal:** The web app (login, register, and above all the staff/patient app) looks and feels like a modern hospital system: a real button and form-control system, styled dropdowns, status badges, a slide-in edit drawer, toasts, loading skeletons, searchable tables, themed charts and a cleaner chat, without changing any behaviour the tests pin.

**Architecture:** CSS-first. `css/app.css` gets a token layer (spacing, radii, elevation, status tones) and a component layer (buttons, inputs, select, badge, drawer, toast, skeleton, toolbar). Small pure modules decide *what* to show (`zones.js`, new functions in `helpers.js`, `roleUi.js`) and are unit-tested; two DOM modules (`icons.js`, `ui.js`) build the repeated pieces; page modules (`crud.js`, `views.js`, `table.js`, `dashboard.js`, `chat.js`, `app.js`) use them. Native `<select>` stays native (keyboard, screen readers, Playwright `selectOption`), restyled with CSS.

**Tech Stack:** Vanilla ES modules, no build step; Chart.js 4.4.1 (CDN); supabase-js; `node --test`; Playwright smoke test with mocked Supabase (`web/tests/smoke.mjs`).

**Spec:** the user's request (2026-11-11): "แก้ UX/UI Design ให้ดูดีและดูเป็นโรงพยาบาลที่ทันสมัย ปุ่ม/drop down สวยกว่านี้ ฟังก์ชันต่างๆ ดูสวยงาม". The design decisions below turn that into something checkable — review them first.

## Design direction (decisions to review)

**The one bold idea — hospital wayfinding inside the app.** The landing page already uses wayfinding zone colours (นัดหมาย blue, เวชระเบียน green, เภสัชกรรม amber, รายงาน purple). The app carries them in: every table, report and chart belongs to a zone, and the page shows a *zone sign* (colour bar + icon + zone name) like the signs on a hospital corridor. Everything else stays quiet: white surfaces, one green for actions, no gradients in the app, no load animations.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--scrub` / `--scrub-deep` | `#0f6b5e` / `#0b4f46` | unchanged | primary action, focus, active tab |
| `--mist` (page background) | `#f3f7f5` | `#0e1917` | page background |
| `--paper` (surfaces) | `#ffffff` | `#14221f` | cards, drawer, table |
| zones | appt `#2f5d9e`, rec `#0f6b5e`, rx `#9a5d0c`, rep `#74467f` | unchanged | zone sign, chart card accent, view optgroups |
| tone ok | `#157347` on `#e3f4ea` | `#7fd6a4` on `#16352a` | badge |
| tone info | `#2f5d9e` on `#e6eef9` | `#9cc0f2` on `#1b2b45` | badge |
| tone warn | `#8a5208` on `#fdf1de` | `#f2c27a` on `#3a2a12` | badge |
| tone danger | `#b4232f` on `#fbeaea` | `#f08a8a` on `#3a1c1f` | badge, armed delete, error |
| tone neutral | `#4f6862` on `#eef2f0` | `#9db3ac` on `#1d2b28` | badge, unknown status |

Spacing scale `--s1..--s8` = 4, 8, 12, 16, 20, 24, 32, 48 px. Radii by hierarchy, not one value for all: `--r-sm 6px` (badges, table buttons), `--r-md 10px` (inputs, buttons), `--r-lg 14px` (cards, drawer). Elevation: `--e1` cards (border only, no shadow), `--e2` drawer/toast `0 18px 40px -18px rgb(6 38 33 / .45)`. Control height 44px (36px for `.sm`). Type: keep IBM Plex Sans Thai (body/UI) + Noto Serif Thai (headings, zone sign) — scale 13/14/16/18/22/30. Sentence case, no ALL-CAPS labels, no `→` in buttons, no numbered markers.

Motion: only in answer to the user — drawer slides in (220 ms ease-out), toast fades in; both off under `prefers-reduced-motion`.

## Global Constraints

- No build step and no new runtime dependency; Chart.js stays 4.4.1 from cdnjs; Google Fonts link unchanged.
- Data from the database is always written with `textContent` (never `innerHTML`).
- Every selector `web/tests/smoke.mjs` uses keeps working unchanged: `#t #v #new #form #f_<column> #err #list #out #panel #log #q #send #ex #nav [data-tab] #page-title #page-desc #pending #logout #tz-clock #signup #login #email #password #submit`, `.msg.user`, `.msg.bot`, `.booking-card .confirm-booking`, `.cancel-booking`, `#panel h3` (exact chart titles), `#panel .card .empty`, `#panel canvas`, `#panel .card:first-child .empty`.
- While a list loads, the container's `textContent` is exactly `กำลังโหลด...`; an empty result still contains `ไม่พบข้อมูล`.
- `#t` options stay in `TABLES`/`PATIENT_TABLES` key order (patient test asserts it) and `#t` stays visible.
- `#form` is also the login form id in `index.html`: drawer styles target the class `.drawer`, never `#form`.
- Light and dark (`prefers-color-scheme`), breakpoints 980px and 720px, text contrast ≥ 4.5:1, visible `:focus-visible` on every control.
- All existing checks pass at every commit: `node --test web/tests/*.test.mjs scripts/*.test.mjs` and `PLAYWRIGHT_PATH=… node web/tests/smoke.mjs`.

## Review Focus

1. Clicking the icon *inside* a nav or table button (target is the `<svg>`, not the button) must still switch tab / run the action.
2. Drawer: Escape, backdrop click and ยกเลิก close it and return focus to the button that opened it; switching table in `#t` while it is open closes it; the app-bar tabs stay clickable while it is open (existing smoke checks rely on this); a second click on บันทึก while saving does nothing.
3. Status values in any case or unknown (`pending`, `Pending`, `REORDER_URGENT`, `Admitted`, `null`) — known ones get a Thai label and tone, unknown ones show as-is in neutral, `null`/empty shows nothing.
4. Table search with Thai text, digits and mixed case hides non-matching rows *without* rebuilding the table, so the row→action mapping in `crud.js` (`data[rows.indexOf(r)]`) stays correct; the count reads `แสดง 1 จาก 3 รายการ`.
5. Patient table (11 columns) on a 390px screen: horizontal scroll inside the table, pinned จัดการ column still visible, drawer full-width.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `web/tests/harness.mjs` | static server + mocked Supabase + Chart stub, shared by smoke and screenshots | create (moved out of `smoke.mjs`) |
| `web/tests/screens.mjs` | PNG screenshots of every page, desktop/mobile × light/dark | create |
| `web/js/zones.js` | zone catalogue and which table/view/chart belongs to which zone | create |
| `web/js/helpers.js` | + `statusInfo`, `matchesQuery` | modify |
| `web/js/roleUi.js` | + `roleLabel` | modify |
| `web/js/icons.js` | inline SVG icon set | create |
| `web/js/ui.js` | `button`, `badge`, `toast`, `skeleton`, `zoneSign` DOM builders | create |
| `web/css/app.css` | tokens + components + page styles | modify |
| `web/app.html`, `web/js/app.js` | nav icons, role chip, toast region | modify |
| `web/js/table.js`, `web/js/views.js` | badges, numeric columns, search toolbar, report labels | modify |
| `web/js/crud.js`, `web/js/tables.js` | drawer form, action buttons, toasts, Thai status options | modify |
| `web/js/dashboard.js` | chart theme, zone-accented chart cards | modify |
| `web/js/chat.js` | chat layout, typing indicator, chips | modify |

---

### Task 1: Shared test harness and screenshot baseline

**Files:**
- Create: `web/tests/harness.mjs`, `web/tests/screens.mjs`
- Modify: `web/tests/smoke.mjs` (import from harness; no check changes), `.gitignore` (add `web/tests/screens/`)

**Interfaces:**
- Produces: `startServer(): Promise<{ base: string, close(): void }>`; `MOCK_SUPABASE: string`; `newMockedContext(browser): Promise<BrowserContext>` (routes `config.js`, jsdelivr → mock, cdnjs → Chart stub exactly as `smoke.mjs` does today); `loadPlaywright(): { chromium }` (reads `PLAYWRIGHT_PATH`, default `'playwright'`).

- [ ] **Step 1: Branch and tools.** `cd hospital && git checkout -b feat/modern-hospital-ui`. On the user's Mac via device_bash, git needs delete permission in the folder (lock files) — request it once with `device_request_delete_permission`. Install Playwright in scratch: `npm i --prefix ~/pw playwright@1.63.0 && npx --prefix ~/pw playwright install chromium`. If the download is blocked, stage `web/` into the cloud container and run there.
- [ ] **Step 2: Baseline.** Run both test commands; expected: unit `fail 0`, smoke all `PASS`.
- [ ] **Step 3: Move** the server, `MOCK_SUPABASE` string and the three `ctx.route` calls into `harness.mjs`; `smoke.mjs` imports them. Every `check(...)` body is unchanged.
- [ ] **Step 4: Run smoke** — same PASS list as Step 2.
- [ ] **Step 5: Write `screens.mjs`.** For each of `{ width: 1280, height: 860 }` and `{ width: 390, height: 844, isMobile: true }` × `colorScheme: 'light' | 'dark'`: screenshot `index.html`, `register.html`, then signed in as `a@b.th` (admin): `app.html#data` (patient table), the drawer after clicking `#new`, `#views` with `v_inventory_stock_status`, `#dash`, `#chat` after asking `มีแพทย์กี่คน`; and as `pt@b.th`: `#data` with `booking`. Files: `web/tests/screens/<page>-<w>-<scheme>.png`. `fullPage: true`.
- [ ] **Step 6: Run** `PLAYWRIGHT_PATH=~/pw/node_modules/playwright node web/tests/screens.mjs` → prints the PNG list; open a few to confirm they render (these are the "before" images).
- [ ] **Step 7: Commit** `test(web): shared Playwright harness + screenshot script`.

### Task 2: Pure decisions — zones, status, search, role label

**Files:**
- Create: `web/js/zones.js`, `web/tests/zones.test.mjs`
- Modify: `web/js/helpers.js`, `web/js/roleUi.js`, `web/tests/helpers.test.mjs`, `web/tests/roleUi.test.mjs`

**Interfaces:**
- Produces:
  - `ZONES: { appt, rec, rx, rep }`, each `{ id, label, en, icon, color }` — labels `นัดหมาย`/`Appointments`/`calendar`/`var(--z-appt)`, `เวชระเบียน`/`Medical records`/`clipboard`/`var(--z-rec)`, `เภสัชกรรม`/`Pharmacy`/`capsule`/`var(--z-rx)`, `รายงาน`/`Reports`/`chart`/`var(--z-rep)`.
  - `zoneFor(key: string) -> zone` (falls back to `ZONES.rep`). Map: `patient rec, booking appt, visit rec, prescription rx, drug rx, inventory rx`; views `v_booking_queue_today v_upcoming_bookings v_doctor_workload v_feedback_summary → appt`, `v_bed_occupancy v_visit_billing v_top_diagnosis → rec`, `v_pharmacist_screening_queue v_inventory_stock_status v_drug_cost_summary → rx`; charts `workload appt, billing rec, lowStock rx, beds rec, screening rx, myBilling rec`.
  - `VIEW_LABELS: Record<viewName, string>` — `คิวนัดวันนี้, นัดหมายที่กำลังจะถึง, ภาระงานแพทย์, สรุปความพึงพอใจ, อัตราการใช้เตียง, ค่ารักษาตามการเข้ารับบริการ, การวินิจฉัยที่พบบ่อย, คิวคัดกรองใบสั่งยา, สถานะสต็อกยา, สรุปต้นทุนยา` (in `VIEWS` order).
  - `statusInfo(value) -> { tone: 'ok'|'info'|'warn'|'danger'|'neutral', label: string } | null` (helpers.js). Lookup by exact value first, then by lower-case (own keys only); `null`/`''` → `null`; unknown → `{ tone: 'neutral', label: String(value) }`.
  - `isStatusColumn(name: string) -> boolean` — `name === 'status' || name.endsWith('_status')`.
  - `matchesQuery(cells: string[], query: string) -> boolean` — trims, lower-cases, NFC-normalises both sides; empty query → `true`; matches if any cell contains it.
  - `roleLabel(access) -> string` (roleUi.js).

Status table (value → tone, label). Exact-case entries (prescriptions use capitalised values, bookings lower-case): `Pending warn รอคัดกรอง`, `Screened info คัดกรองแล้ว`, `Dispensed ok จ่ายยาแล้ว`, `Cancelled neutral ยกเลิก`. Lower-case entries: `pending warn รอยืนยัน`, `confirmed info ยืนยันแล้ว`, `completed ok เสร็จสิ้น`, `cancelled neutral ยกเลิก`, `normal ok ปกติ`, `near_expiry warn ใกล้หมดอายุ`, `reorder_urgent danger ต้องสั่งด่วน`, `available ok ว่าง`, `occupied info มีผู้ป่วย`, `maintenance neutral ปิดซ่อม`.

- [ ] **Step 1: Write failing tests**
```js
test('statusInfo: known values any case, unknown neutral, empty null', () => {
  assert.deepEqual(statusInfo('pending'), { tone: 'warn', label: 'รอยืนยัน' });
  assert.deepEqual(statusInfo('Pending'), { tone: 'warn', label: 'รอคัดกรอง' });
  assert.deepEqual(statusInfo('Dispensed'), { tone: 'ok', label: 'จ่ายยาแล้ว' });
  assert.deepEqual(statusInfo('CONFIRMED'), { tone: 'info', label: 'ยืนยันแล้ว' });
  assert.deepEqual(statusInfo('REORDER_URGENT'), { tone: 'danger', label: 'ต้องสั่งด่วน' });
  assert.deepEqual(statusInfo('Admitted'), { tone: 'neutral', label: 'Admitted' });
  assert.equal(statusInfo(null), null); assert.equal(statusInfo(''), null);
  assert.equal(statusInfo('constructor').tone, 'neutral');   // own keys only
});
test('isStatusColumn', () => { for (const c of ['status', 'stock_status', 'prescription_status']) assert.ok(isStatusColumn(c)); assert.ok(!isStatusColumn('statusbar')); });
test('matchesQuery: Thai, digits, case, blank', () => {
  assert.ok(matchesQuery(['HN1', 'อนันต์'], 'อนัน')); assert.ok(matchesQuery(['Warfarin'], ' warf ')); assert.ok(matchesQuery(['1100000000001'], '0001'));
  assert.ok(matchesQuery(['x'], '')); assert.ok(!matchesQuery(['HN1', 'อนันต์'], 'สมชาย'));
});
// zones.test.mjs
test('every table, view and chart has a zone', () => { for (const k of [...Object.keys(TABLES), ...VIEWS, ...STAFF_CHARTS, 'myBilling']) assert.notEqual(zoneFor(k), undefined); assert.equal(zoneFor('booking').id, 'appt'); assert.equal(zoneFor('v_inventory_stock_status').id, 'rx'); assert.equal(zoneFor('nope').id, 'rep'); assert.equal(zoneFor('constructor').id, 'rep'); });
test('VIEW_LABELS covers VIEWS', () => assert.deepEqual(Object.keys(VIEW_LABELS), VIEWS));
// roleUi.test.mjs
test('roleLabel', () => {
  assert.equal(roleLabel({ linked: true, role: 'admin' }), 'ผู้ดูแลระบบ'); assert.equal(roleLabel({ linked: true, role: 'doctor' }), 'แพทย์');
  assert.equal(roleLabel({ linked: true, role: 'nurse' }), 'พยาบาล'); assert.equal(roleLabel({ linked: true, role: 'pharmacist' }), 'เภสัชกร');
  assert.equal(roleLabel({ linked: true, patient: true, role: 'patient' }), 'ผู้ป่วย'); assert.equal(roleLabel({ linked: true, role: null }), 'เจ้าหน้าที่');
  assert.equal(roleLabel({ linked: false }), 'รอผูกบัญชี');
});
```
- [ ] **Step 2: Run** `node --test web/tests/*.test.mjs` → FAIL (not exported).
- [ ] **Step 3: Implement** in `zones.js`, `helpers.js`, `roleUi.js`. `VIEWS` moves from `views.js` into `zones.js` (views.js imports supabase, so node cannot load it) and `views.js` re-exports it.
- [ ] **Step 4: Run** → PASS; smoke still PASS.
- [ ] **Step 5: Commit** `feat(web): zones, status labels, table search and role label helpers`.

### Task 3: Token layer, control system, icons and UI builders

**Files:**
- Modify: `web/css/app.css` (`:root` tokens, Base, Controls, Messages; new sections Badge, Drawer, Toast, Skeleton, Toolbar, Zone sign)
- Create: `web/js/icons.js`, `web/js/ui.js`, `web/tests/icons.test.mjs`

**Interfaces:**
- Produces:
  - `ICONS: Record<name, string>` (SVG path data, 24×24, stroke icons) with exactly: `calendar clipboard capsule chart table chat plus edit trash x-circle search close send check logout user`. `icon(name, cls?) -> SVGSVGElement` (`aria-hidden="true"`, `focusable="false"`, class `icon`).
  - `button(label, { icon?, variant?: 'primary'|'secondary'|'ghost'|'danger', size?: 'sm', type?: 'button'|'submit' } = {}) -> HTMLButtonElement` — label lives in `<span class="label">`; `setLabel(btn, text)` changes only that span.
  - `badge(value) -> HTMLSpanElement | null` — uses `statusInfo`; `<span class="badge" data-tone="warn" data-value="pending" title="pending">รอยืนยัน</span>`.
  - `toast(message, tone = 'ok')` — appends to `#toasts` (created on first use: `role="status"`, `aria-live="polite"`), removes after 3500 ms.
  - `skeleton(rows = 6) -> HTMLDivElement` — `aria-busy="true"`, one `<span class="visually-hidden">กำลังโหลด...</span>` (its whole `textContent`) + empty bar divs.
  - `zoneSign(zone, title) -> HTMLDivElement` — `.zone-sign` with `style="--zone: …"`, icon, `<strong>` zone label + `<span>` title; `updateZoneSign(el, zone, title)`.

CSS contract (selectors the later tasks rely on): `button`, `.btn` = secondary; `.primary`, `.ghost`, `.danger`, `.sm`; `button[data-armed="1"]` = danger look; `select` with chevron (`appearance: none`, data-URI chevron, light and dark variants, `padding-right: 40px`); `.badge[data-tone]`; `.drawer`, `.drawer-backdrop`, `.drawer-head`, `.drawer-body`, `.drawer-foot`, `.drawer-err`; `#toasts .toast[data-tone]`; `.skeleton`; `.toolbar`, `.table-search`, `.table-count`; `.zone-sign`; `.visually-hidden`; `td.num` right-aligned tabular; `.icon` 18px, `pointer-events: none`.

- [ ] **Step 1: Failing test** `icons.test.mjs`: imports `ICONS` (icons.js keeps DOM use inside `icon()` so the import works in node) and asserts `Object.keys(ICONS).sort()` equals the list above sorted and every value is a non-empty string.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `icons.js`, `ui.js`, and the CSS layers with the tokens from *Design direction*. Keep the existing token names (`--mist`, `--paper`, `--line`, `--ink`, …); only add new ones.
- [ ] **Step 4: Run** unit + smoke → PASS. Run `screens.mjs`; compare login/register against the Task 1 images: inputs and buttons 44px, select shows a chevron, focus ring visible (tab through the login form once in a headed run or screenshot after `page.focus('#email')`).
- [ ] **Step 5: Commit** `feat(web): design tokens, control system, icons and UI builders`.

### Task 4: App shell — nav icons, role chip, toasts

**Files:** Modify `web/app.html`, `web/js/app.js`, `web/css/app.css` (Staff app section), `web/tests/smoke.mjs`

**Interfaces:**
- Consumes: `icon`, `roleLabel`, `ZONES`.
- Produces: `<span id="role-chip">` in the app bar; nav buttons contain an inline icon then the text; `app.js` nav handler uses `e.target.closest('[data-tab]')`; `app.js` keeps CSS variable `--appbar-h` equal to the app bar's height (`ResizeObserver` on `.app-bar`) — the drawer in Task 6 starts below it, so the tabs stay clickable while it is open.

- [ ] **Step 1: Failing smoke checks** (add after "correct password reaches app"):
```js
await check('app bar shows the account role', async () => { assert.equal(await page.textContent('#role-chip'), 'ผู้ดูแลระบบ'); });
await check('clicking the icon inside a nav button switches tab', async () => {
  await page.click('[data-tab=views] svg'); await page.waitForSelector('#v'); await page.click('[data-tab=data] svg'); await page.waitForSelector('#t'); });
```
and in the patient block: `assert.equal(await page.textContent('#role-chip'), 'ผู้ป่วย')`.
- [ ] **Step 2: Run smoke** → the new checks FAIL.
- [ ] **Step 3: Implement.** Nav icons: data `table`, views `clipboard`, dash `chart`, chat `chat`; logout gets `logout` icon and class `ghost`. Role chip text from `roleLabel(access)`, `user` icon. App bar: deep green kept; active tab = white text + mint 3px underline; mobile: nav scrolls horizontally, role chip hides below 720px.
- [ ] **Step 4: Run** unit + smoke → PASS; screenshots of app bar desktop/mobile look right.
- [ ] **Step 5: Commit** `feat(web): app bar with icons and role chip`.

### Task 5: Tables and reports — badges, numbers, search, report names

**Files:** Modify `web/js/table.js`, `web/js/views.js`, `web/css/app.css`, `web/tests/smoke.mjs`

**Interfaces:**
- Consumes: `badge`, `isStatusColumn`, `matchesQuery`, `skeleton`, `zoneSign`, `zoneFor`, `VIEW_LABELS`.
- Produces: `renderTable(rows, extraHeader?, extraCell?)` unchanged signature; status columns render a badge (cell `textContent` = Thai label), cells matching `/^-?\d+(\.\d+)?$/` get class `num`. New `withToolbar(tableEl, { placeholder = 'ค้นหาในตาราง' }) -> HTMLDivElement` — returns `.toolbar` (search input `.table-search` with `search` icon, `.table-count`) followed by the table; typing hides/shows `<tr>` with `matchesQuery` on that row's cell texts (no rebuild); count text `แสดง {shown} จาก {total} รายการ`; if `tableEl` is the empty-state div, returns it unchanged.
- Views page: `#v` options grouped in `<optgroup label="{zone.label}">` by zone; option text `{VIEW_LABELS[v]} ({v})`; zone sign above the card updates on change; loading shows `skeleton()`.

- [ ] **Step 1: Failing smoke checks**
```js
await check('views: report names in Thai, grouped by zone; status shown as a badge', async () => {
  await page.click('[data-tab=views]'); await page.selectOption('#v', 'v_inventory_stock_status'); await page.waitForSelector('#out table');
  assert.equal(await page.textContent('#v option[value=v_inventory_stock_status]'), 'สถานะสต็อกยา (v_inventory_stock_status)');
  assert.deepEqual(await page.$$eval('#v optgroup', (g) => g.map((x) => x.label)), ['นัดหมาย', 'เวชระเบียน', 'เภสัชกรรม']);
  assert.equal(await page.getAttribute('#out .badge', 'data-tone'), 'danger'); assert.equal(await page.textContent('#out .badge'), 'ต้องสั่งด่วน');
  assert.equal(await page.textContent('.zone-sign strong'), 'เภสัชกรรม'); });
await check('table search hides rows and updates the count', async () => {
  await page.click('[data-tab=dash]'); await page.click('[data-tab=data]'); await page.waitForSelector('#list table');
  await page.fill('#list .table-search', 'ไม่มีใครชื่อนี้');
  assert.equal(await page.locator('#list tbody tr:visible').count(), 0); assert.equal(await page.textContent('#list .table-count'), 'แสดง 0 จาก 1 รายการ');
  await page.fill('#list .table-search', 'hn1'); assert.equal(await page.locator('#list tbody tr:visible').count(), 1); });
```
(Use the mock's existing rows; place these before the admin dashboard check so later checks start on known tabs.)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** table.js, views.js and CSS: header row on `--canvas` 13px 600 muted, rows 44px, hover tint, `td.num` right-aligned, sticky header kept, pinned action column kept (its background follows the hover tint).
- [ ] **Step 4: Run** unit + smoke → PASS (including the existing "ไม่พบข้อมูล for an empty view" check).
- [ ] **Step 5: Commit** `feat(web): status badges, searchable tables, Thai report names`.

### Task 6: Data page — edit drawer, action buttons, toasts

**Files:** Modify `web/js/crud.js`, `web/js/tables.js`, `web/css/app.css`, `web/tests/smoke.mjs`

**Interfaces:**
- Consumes: `button`, `setLabel`, `toast`, `skeleton`, `zoneSign`/`updateZoneSign`, `zoneFor`, `withToolbar`, `icon`.
- Produces / decisions:
  - Page layout: zone sign (`zoneFor(sel.value)`, title = table label) → card with toolbar row `[label ตาราง][#t][#new primary + plus icon]` → `#err` → `#list` (via `withToolbar`).
  - `#form` gets `class="drawer"` and moves into a fixed right panel 440px (100% ≤720px) with `.drawer-backdrop`; both are children of the page host (so switching tab removes them) and start at `top: var(--appbar-h)` with a z-index below the app bar; structure: `.drawer-head` (`<h2>` `เพิ่ม{label}` or `แก้ไข{label}` + close button `aria-label="ปิด"`), `.drawer-body` (fields, one column; required label shows a red `*`), `.drawer-err` `#form-err` (`role="alert"`), `.drawer-foot` (submit primary, ยกเลิก secondary). `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the h2.
  - Open: focus first field (the drawer body scrolls on its own; no page scroll lock). Close (Escape, backdrop, close, ยกเลิก, `#t` change, successful save): `form.hidden = true`, backdrop hidden, focus back to the opener.
  - Submit: button disabled and label `กำลังบันทึก…` until the request returns; errors written to both `#err` and `#form-err`.
  - Toasts: insert `เพิ่มข้อมูลแล้ว`, update `บันทึกการแก้ไขแล้ว`, delete `ลบข้อมูลแล้ว`, cancel booking `ยกเลิกคิวแล้ว`. Errors stay in `#err` (not toasts).
  - Row actions: `button('แก้ไข', { icon: 'edit', size: 'sm' })`, delete `button('ลบ', { icon: 'trash', size: 'sm', variant: 'ghost' })` → armed text `ยืนยันลบ?` via `setLabel`, cancel booking `button('ยกเลิกคิว', { icon: 'x-circle', size: 'sm', variant: 'ghost' })` → `ยืนยันยกเลิก?`.
  - `tables.js`: status selects use `{ value, label }` options from `statusInfo` labels (booking `pending` → `รอยืนยัน`, prescription `Pending` → `รอคัดกรอง`, …); `gender` → `M ชาย`, `F หญิง`, `O อื่น ๆ`; `visit_type` unchanged.
  - Loading: `list` shows `skeleton()`.

- [ ] **Step 1: Failing smoke checks** (staff, after "add patient with missing required field is blocked", which must still pass with `#err`):
```js
await check('drawer: title, error inside it, Escape closes and focus returns to the add button', async () => {
  assert.equal(await page.textContent('#form h2'), 'เพิ่มผู้ป่วย');
  assert.ok((await page.textContent('#form-err')).includes('กรุณากรอก'));
  await page.keyboard.press('Escape'); await page.waitForSelector('#form', { state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'new'); });
await check('status select shows Thai labels with database values', async () => {
  await page.selectOption('#t', 'booking'); await page.click('#new');
  assert.deepEqual(await page.$$eval('#f_status option', (o) => o.slice(1).map((x) => [x.value, x.textContent])),
    [['pending', 'รอยืนยัน'], ['confirmed', 'ยืนยันแล้ว'], ['completed', 'เสร็จสิ้น'], ['cancelled', 'ยกเลิก']]);
  await page.click('#form .drawer-foot button[type=button]'); await page.selectOption('#t', 'patient'); });
```
In the patient block, after the booking insert: `await page.waitForSelector('#toasts .toast'); assert.equal(await page.textContent('#toasts .toast'), 'เพิ่มข้อมูลแล้ว');`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** crud.js / tables.js / CSS (`.drawer` transform-in 220 ms; `@media (prefers-reduced-motion: reduce)` no transition).
- [ ] **Step 4: Run** unit + smoke → PASS (existing "duplicate booking" and "patient books" checks included).
- [ ] **Step 5: Commit** `feat(web): edit drawer, icon actions and toasts on the data page`.

### Task 7: Dashboard — chart theme and zone cards

**Files:** Modify `web/js/dashboard.js`, `web/js/helpers.js`, `web/css/app.css`; Test: `web/tests/helpers.test.mjs`, `web/tests/smoke.mjs`

**Interfaces:**
- Produces: `chartTheme({ ink, muted, line, font }) -> object` (pure, in `helpers.js`) returning exactly
  `{ font: { family: font, size: 13 }, color: muted, borderColor: line, elements: { bar: { borderRadius: 6, borderSkipped: false, maxBarThickness: 44 } }, plugins: { legend: { labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, color: ink } }, tooltip: { padding: 10, cornerRadius: 8 } }, scale: { grid: { color: line }, ticks: { color: muted } } }`.
  `applyChartTheme(Chart, theme)` (in `dashboard.js`) deep-merges into `Chart.defaults` **only if `Chart.defaults` exists** (the smoke stub has none). Values read with `getComputedStyle(document.documentElement)` from `--ink --muted --line --f-body`.   Chart cards: class `card chart-card`, `style="--zone: …"` from `zoneFor(id)`, 4px top border in zone colour; h3 text unchanged; `.empty` shows a muted icon + `ไม่พบข้อมูล`; canvas wrapper height 280px (`maintainAspectRatio: false` passed per chart via a shared `base` options object merged into each config — existing data/labels asserted by smoke stay identical).

- [ ] **Step 1: Failing tests** — unit `chartTheme` deep-equals the object above for `{ ink: '#111', muted: '#555', line: '#ddd', font: 'X' }`; smoke: `assert.deepEqual(await page.$$eval('#panel .chart-card', (c) => c.map((x) => x.style.getPropertyValue('--zone').trim())), ['var(--z-appt)', 'var(--z-rec)', 'var(--z-rx)', 'var(--z-rec)', 'var(--z-rx)'])` in the admin dashboard check.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** unit + smoke → PASS (all chart data assertions unchanged).
- [ ] **Step 5: Commit** `feat(web): themed dashboard charts with zone accents`.

### Task 8: Chat — layout, typing indicator, chips

**Files:** Modify `web/js/chat.js`, `web/css/app.css`, `web/tests/smoke.mjs`

**Interfaces / decisions:**
- Card layout: `#log` is a scroll area (`max-height: calc(100vh - 360px)`, min 320px) with an empty-state hint when there is no history (`ถามเรื่องคิว นัดหมาย ค่ารักษา หรือสต็อกยาได้เลย`, removed once a message exists); composer row (`#chatform`): `#q` (no inline `style`), `#send` = `button('ส่ง', { icon: 'send', variant: 'primary', type: 'submit' })` keeping `id="send"`; `#ex` chips below.
- Bubbles: `.msg.bot` gets a 28px round avatar (brand cross) via a `.avatar` child; pending bubble = `.msg.bot.pending` with three `.dot` spans and text `กำลังประมวลผล…` (dots hidden under reduced motion); errors use the danger tone box; `details` SQL styled as a quiet disclosure; booking card: zone-appt left border, `calendar` icon in the title, buttons `ยืนยันนัด` (primary, `check` icon) / `ยกเลิก` (secondary) keeping their classes.
- Chips: clicking fills `#q` **and** submits? No — keep fill + focus (current behaviour, user may edit).

- [ ] **Step 1: Failing smoke checks**: in the first chat check, while pending: `assert.equal(await page.locator('#log .msg.bot.pending .dot').count(), 3)`; new check `chat: example chip fills the question box` — `await page.click('#ex button >> nth=0'); assert.equal(await page.inputValue('#q'), 'แพทย์คนไหนมีคิวจองมากที่สุด'); await page.fill('#q', '');`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** unit + smoke → PASS (booking propose/confirm/cancel checks included).
- [ ] **Step 5: Commit** `feat(web): chat layout, typing indicator and booking card styling`.

### Task 9: Visual QA pass (light/dark, desktop/mobile) and handoff

**Files:** Modify only what the review finds (`web/css/app.css` mostly); `docs/test-cases.md` (add UI rows U1–U5 matching Review Focus, result `ผ่าน (smoke)` or `ตรวจด้วยตา`).

- [ ] **Step 1: Run** `screens.mjs`; open every PNG (stage to the container and use Read if needed).
- [ ] **Step 2: Check each image** against: zone sign present and correct colour; buttons share heights within a row; select chevrons visible in dark mode; badges legible in dark; drawer full width at 390px and the pinned action column visible in the 11-column patient table; no text clipped in the app bar at 390px; login/register controls match the app's controls. Note each problem, fix it in CSS, re-run screenshots. One "remove one accessory" pass: delete any decoration that does not tell the user something.
- [ ] **Step 3: Keyboard pass** (headed Playwright or real browser): Tab through app bar → table picker → add → drawer fields → save; focus ring visible everywhere, Escape closes drawer.
- [ ] **Step 4: Full verification:** `node --test web/tests/*.test.mjs scripts/*.test.mjs` → `fail 0`; smoke → every line `PASS`, last check `no uncaught page errors` PASS.
- [ ] **Step 5: Commit** `style(web): visual QA fixes; UI test cases`, then push the branch and open a PR to `main` with before/after screenshots (desktop light + mobile dark) in the description.
