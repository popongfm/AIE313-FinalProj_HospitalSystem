#!/usr/bin/env python3
"""Build docs/report/analysis.md (question | SQL | result | interpretation) from analysis_queries.sql. Usage: gen_analysis_md.py DB"""
import re, subprocess, sys, csv, io
db = sys.argv[1]
text = open('analysis/analysis_queries.sql', encoding='utf-8').read()
parts = re.split(r'^-- (Q\S+) \[(\w+)\] (.*)$', text, flags=re.M)
out = ['# ผลการวิเคราะห์ด้วย SQL', '', 'ผลลัพธ์สร้างจากฐานข้อมูลข้อมูลจำลอง (seed 313) ด้วย `docs/report/gen_analysis_md.py` ช่อง "การแปลความหมาย" ให้สมาชิกผู้เขียนคำสั่งนั้นเติมเอง', '']
for i in range(1, len(parts), 4):
    qid, tag, title, body = parts[i], parts[i+1], parts[i+2], parts[i+3]
    lines = body.strip().splitlines()
    while lines and (not lines[-1].strip() or lines[-1].lstrip().startswith('--')): lines.pop()
    sql = '\n'.join(lines)
    r = subprocess.run(['psql', '-X', '--csv', '-d', db, '-c', sql.rstrip().rstrip(';')], capture_output=True, text=True, check=True)
    rows = list(csv.reader(io.StringIO(r.stdout)))
    out += ['## %s [%s] %s' % (qid, tag, title), '', '```sql', sql, '```', '', '**ผลลัพธ์** (%d แถว%s)' % (len(rows) - 1, ', แสดง 10 แถวแรก' if len(rows) > 11 else ''), '']
    head, data = rows[0], rows[1:11]
    out.append('| ' + ' | '.join(head) + ' |'); out.append('|' + '---|' * len(head))
    out += ['| ' + ' | '.join(c.replace('|', '\\|') for c in row) + ' |' for row in data]
    out += ['', '**การแปลความหมาย:** _(ผู้เขียนคำสั่งเติม)_', '']
open('docs/report/analysis.md', 'w', encoding='utf-8').write('\n'.join(out))
print('wrote docs/report/analysis.md,', (len(parts) - 1) // 4, 'queries')
