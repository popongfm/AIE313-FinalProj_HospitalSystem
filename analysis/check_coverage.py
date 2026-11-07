#!/usr/bin/env python3
"""Coverage check for analysis_queries.sql.  Usage: check_coverage.py FILE [--db DBNAME]
Queries start with a header line:  -- Q<n> [JOIN|AGG|GROUP|STAT|DASH] <Thai business question>
Exit 1 unless every course requirement is covered. With --db, each query is also executed and must return >= 1 row."""
import re, subprocess, sys
path = sys.argv[1]; db = sys.argv[sys.argv.index('--db') + 1] if '--db' in sys.argv else None
text = open(path, encoding='utf-8').read()
parts = re.split(r'^-- (Q\S+) \[(\w+)\] (.*)$', text, flags=re.M)
def body(t):  # drop trailing comment-only lines (group separators) after the statement
    lines = t.strip().splitlines()
    while lines and (not lines[-1].strip() or lines[-1].lstrip().startswith('--')): lines.pop()
    return '\n'.join(lines)
qs = [dict(id=parts[i], tag=parts[i+1], title=parts[i+2], sql=body(parts[i+3])) for i in range(1, len(parts), 4)]
errs = []
for tag in ('JOIN', 'AGG', 'GROUP', 'STAT'):
    n = sum(q['tag'] == tag for q in qs)
    if n < 4: errs.append('%s: %d queries (need >= 4)' % (tag, n))
if len(qs) < 16: errs.append('only %d queries (need >= 16)' % len(qs))
S = lambda q: q['sql'].upper()
if not any(S(q).count('INNER JOIN') >= 2 for q in qs): errs.append('no INNER JOIN over >= 3 tables in one query')
whole = ' '.join(S(q) for q in qs)
for f in ('COUNT(*)', 'COUNT(DISTINCT', 'SUM(', 'AVG(', 'MIN(', 'MAX('):
    if f not in whole: errs.append('aggregate %s never used' % f)
AGG = re.compile(r'\b(COUNT|SUM|AVG|MIN|MAX)\(')
if not any(AGG.search(S(q)) and 'JOIN' in S(q) for q in qs): errs.append('no aggregate combined with JOIN')
if not any(AGG.search(S(q)) and 'CASE WHEN' in S(q) for q in qs): errs.append('no aggregate combined with CASE WHEN')
if not any(re.search(r'GROUP BY\s+(ROLLUP\s*\()?[^;(),]+,', S(q)) for q in qs): errs.append('no GROUP BY over more than one column')
if 'HAVING' not in whole: errs.append('no HAVING')
if not ('ROLLUP' in whole or 'OVER (' in whole or 'OVER(' in whole): errs.append('no ROLLUP / window function')
stats = [s for s in ('STDDEV', 'VARIANCE', 'MODE()', 'PERCENTILE_CONT', 'CORR', 'LAG(') if s in whole]
if len(stats) < 2: errs.append('statistical functions used: %s (need >= 2)' % stats)
if db:
    for q in qs:
        sql = q['sql'].rstrip().rstrip(';')
        r = subprocess.run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', 'SELECT count(*) FROM (%s) _t' % sql], capture_output=True, text=True)
        if r.returncode != 0: errs.append('%s failed: %s' % (q['id'], next((l for l in r.stderr.splitlines() if 'ERROR' in l), r.stderr.strip()[:200])))
        elif int(r.stdout.strip() or 0) < 1: errs.append('%s returned no rows' % q['id'])
if errs:
    print('FAIL:'); [print(' -', e) for e in errs]; sys.exit(1)
print('OK: %d queries, all constructs covered%s' % (len(qs), ', all executed with rows' if db else ''))
