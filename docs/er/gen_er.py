#!/usr/bin/env python3
"""Generate Mermaid ER diagrams from the live catalog.  Usage: python docs/er/gen_er.py <dbname> <outdir>
Env PGHOST/PGPORT/PGUSER must point at a database that already has schema.sql loaded."""
import subprocess, sys, collections
db, out = sys.argv[1], sys.argv[2]
def q(sql):
    r = subprocess.run(['psql','-X','-At','-F','|','-d',db,'-c',sql], capture_output=True, text=True, check=True)
    return [l.split('|') for l in r.stdout.strip().splitlines() if l]
TYPES = {'int4':'int','int2':'smallint','varchar':'varchar','bpchar':'char','timestamptz':'timestamptz','text':'text','date':'date','time':'time','numeric':'numeric','bool':'boolean','uuid':'uuid'}
cols = collections.OrderedDict()
for t, c, u, nn in q("select table_name,column_name,udt_name,is_nullable from information_schema.columns where table_schema='public' and table_name in (select tablename from pg_tables where schemaname='public') order by table_name, ordinal_position"):
    cols.setdefault(t, []).append((c, TYPES.get(u, u), nn == 'NO'))
pks = collections.defaultdict(set)
for t, c in q("select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu using (constraint_name, table_schema) where tc.constraint_type='PRIMARY KEY' and tc.table_schema='public'"):
    pks[t].add(c)
fks = []   # (child, child_col, parent)
for child, ccol, parent in q("select cl.relname, a.attname, pf.relname from pg_constraint c join pg_class cl on cl.oid=c.conrelid join pg_class pf on pf.oid=c.confrelid join pg_namespace n on n.oid=cl.relnamespace join lateral unnest(c.conkey) k(attnum) on true join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum where c.contype='f' and n.nspname='public'"):
    fks.append((child, ccol, parent))
fkcols = collections.defaultdict(set)
for ch, cc, p in fks: fkcols[ch].add(cc)

def diagram(tables, title):
    L = ['---', 'title: %s' % title, '---', 'erDiagram']
    tset = set(tables)
    for t in tables:
        if t == 'auth_users':
            L += ['    auth_users {', '        uuid id PK', '    }']; continue
        L.append('    %s {' % t)
        for c, ty, nn in cols[t]:
            tag = ' PK,FK' if c in pks[t] and c in fkcols[t] else ' PK' if c in pks[t] else ' FK' if c in fkcols[t] else ''
            L.append('        %s %s%s' % (ty, c, tag))
        L.append('    }')
    nullable = {(t, c): not nn for t in cols for c, ty, nn in cols[t]}
    for ch, cc, p in fks:
        if ch in tset and p in tset:
            card = '||--o|' if cc in pks[ch] else ('|o--o{' if nullable[(ch, cc)] else '||--o{')
            L.append('    %s %s %s : "%s"' % (p, card, ch, cc))
    if 'profiles' in tset and 'auth_users' in tset:
        L.append('    auth_users ||--o| profiles : "user_id"')
    return '\n'.join(L) + '\n'

core = ['department','staff','patient','profiles','auth_users']
A = ['booking','feedback']; C = ['room','bed','visit','admission','diagnosis','lab_result','insurance_coverage','daily_charge']
B = ['drug','drug_lot','prescription','prescription_item','dispense_record','inventory','drug_allergy_record']
allt = [t for t in cols]
sets = {
 'er_full': (allt + ['auth_users'], 'ER Diagram - Hospital Information System (merged, %d tables)' % len(allt)),
 'er_member_A_booking': (A + ['patient','staff','department','visit'], 'Member A - Booking (shared tables shown for context)'),
 'er_member_C_records': (C + ['patient','staff','department'], 'Member C - Medical Records (shared tables shown for context)'),
 'er_member_B_pharmacy': (B + ['patient','staff','visit'], 'Member B - Pharmacy and Dispensing (shared tables shown for context)'),
 'er_core_shared': (core, 'Shared core tables linking all three members'),
}
for name, (tabs, title) in sets.items():
    open('%s/%s.mmd' % (out, name), 'w').write(diagram(tabs, title))
print('wrote', len(sets), 'diagrams;', len(allt), 'tables;', len(fks), 'foreign keys')
