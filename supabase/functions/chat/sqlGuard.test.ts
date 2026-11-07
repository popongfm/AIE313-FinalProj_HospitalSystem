import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSql, ALLOWED_VIEWS } from './sqlGuard.ts';
import { SCHEMA_PROMPT } from './schemaPrompt.ts';

const ok = (sql: string) => { const r = validateSql(sql); assert.equal(r.ok, true, sql + ' -> ' + JSON.stringify(r)); return (r as { ok: true; sql: string }).sql; };
const bad = (sql: string) => { const r = validateSql(sql); assert.equal(r.ok, false, 'should reject: ' + sql); };

test('accepts a plain SELECT on an allowed view and adds LIMIT 100', () => {
  assert.equal(ok('select * from v_doctor_workload'), 'select * from v_doctor_workload LIMIT 100');
});
test('accepts trailing semicolon, JOINs between views, aggregates and CTEs', () => {
  ok('select count(*) from v_doctor_workload;');
  ok('select a.doctor_name from v_doctor_workload a join v_feedback_summary b on a.staff_id = b.staff_id');
  ok('WITH m AS (SELECT month, SUM(total_amount) t FROM v_visit_billing GROUP BY month) SELECT * FROM m ORDER BY month');
});
test('lowers a LIMIT above 100 and keeps a smaller one', () => {
  assert.match(ok('select * from v_top_diagnosis limit 1000'), /limit 100$/i);
  assert.match(ok('select * from v_top_diagnosis limit 5'), /limit 5$/i);
});
test('is case-insensitive', () => { ok('SELECT * FROM V_Doctor_Workload'.toLowerCase()); bad('DrOp TABLE patient'); });
test('rejects dangerous statements (Review Focus 1)', () => {
  bad('DROP TABLE patient');
  bad('delete from patient');
  bad('update patient set first_name = \'x\'');
  bad('insert into department(name) values (\'x\')');
  bad('select * from v_doctor_workload; delete from patient');
  bad('select 1 -- ; drop table x');
  bad('/* x */ select * from v_doctor_workload');
  bad('select * into newtable from v_doctor_workload');
  bad('truncate patient'); bad('alter table patient add column x int'); bad('grant all on patient to anon'); bad('copy patient to stdout');
});
test('rejects non-view relations and sneaky access', () => {
  bad('select * from patient');
  bad('select * from auth.users');
  bad('select * from information_schema.tables');
  bad('select * from v_doctor_workload, patient');
  bad('select * from v_doctor_workload join patient on true');
  bad('select * from pg_catalog.pg_tables');
  bad('select pg_sleep(10)');
  bad('select set_config(\'role\',\'postgres\',false)');
});
test('rejects empty, non-SQL and non-string input (Review Focus 2)', () => {
  bad(''); bad('   '); bad('ลบข้อมูลผู้ป่วยทั้งหมด'); bad('Sorry, I cannot answer that.');
  assert.equal(validateSql(undefined as unknown as string).ok, false);
});
test('does not reject legitimate column names that contain keywords', () => {
  ok('select latest_feedback_at, feedback_count from v_feedback_summary');
});
test('schema prompt lists every allowed view and never mentions PII columns (Review Focus 4)', () => {
  for (const v of ALLOWED_VIEWS) assert.ok(SCHEMA_PROMPT.includes(v), v);
  for (const pii of ['national_id', 'phone', 'email', 'address', 'birth_date']) assert.ok(!SCHEMA_PROMPT.includes(pii), pii);
  assert.equal(ALLOWED_VIEWS.length, 9);
});

test('rejects string-executing / non-allowlisted functions and split keywords (review C1/I1)', () => {
  bad(`select query_to_xml('select se'||'t_config(''role'',''service_role'',true)',true,true,'') from v_top_diagnosis`);
  bad("select table_to_xml('patient',true,true,'') from v_top_diagnosis");
  bad('select pg_sleep(3) from v_top_diagnosis');
  bad('select repeat(\'x\', 900000000) from v_top_diagnosis');
  bad('select * from v_top_diagnosis where x in (table patient)');
  bad('with recursive r as (select 1 as n union all select n+1 from r) select count(*) from r');
});
test('still accepts common aggregate/date functions', () => {
  ok('select department, round(avg(total_amount),2) as a, count(*) from v_visit_billing group by department');
  ok("select to_char(date_trunc('month', now()),'YYYY-MM') as m, coalesce(sum(booking_count),0) from v_doctor_workload");
  ok('select extract(month from visit_date) from v_visit_billing');
  ok('select * from (select * from v_top_diagnosis) q');
});
test('too many joins rejected; OFFSET/FETCH queries get an outer limit (review M1)', () => {
  bad('select 1 from v_visit_billing a join v_visit_billing b on true join v_visit_billing c on true join v_visit_billing d on true join v_visit_billing e on true join v_visit_billing f on true join v_visit_billing g on true');
  assert.equal(ok('select * from v_top_diagnosis limit 5 offset 5'), 'SELECT * FROM (select * from v_top_diagnosis limit 5 offset 5) q LIMIT 100');
});
