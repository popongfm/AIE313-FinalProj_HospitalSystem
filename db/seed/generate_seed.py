#!/usr/bin/env python3
"""Deterministic seed generator.  Usage: python db/seed/generate_seed.py --seed 313 > db/seed/seed.sql
Same seed -> byte-identical output. Dates relative to the load day use CURRENT_DATE expressions."""
import argparse, random, datetime as dt

class Raw(str):
    pass

def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, Raw): return str(v)
    if isinstance(v, bool): return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)): return repr(v)
    if isinstance(v, dt.datetime): return "'%s+07'" % v.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(v, dt.date): return "'%s'" % v.isoformat()
    return "'" + str(v).replace("'", "''") + "'"

OUT, SEQS = [], []
def emit(table, cols, rows):
    body = ',\n'.join('  (' + ', '.join(lit(x) for x in row) + ')' for row in rows)
    OUT.append('INSERT INTO %s (%s) VALUES\n%s;\n' % (table, ', '.join(cols), body))
    SEQS.append((table, cols[0]))

FIRST = ['สมชาย','สมหญิง','วิชัย','สุดา','ประเสริฐ','มาลี','อนันต์','พิมพ์ใจ','ธนากร','กัญญา','ปิยะ','นภา','ชาติชาย','รัตนา','สุรชัย','จินตนา','เอกชัย','วารี','ภูมิ','ลลิตา']
LAST = ['ใจดี','สุขสันต์','แก้วมณี','ศรีสุข','บุญมา','จันทร์เพ็ญ','ทองดี','รุ่งเรือง','พึ่งพา','วงศ์ใหญ่']
DEPTS = [('อายุรกรรม','ตึก A ชั้น 2'),('ศัลยกรรม','ตึก A ชั้น 3'),('กุมารเวชกรรม','ตึก B ชั้น 1'),('สูตินรีเวชกรรม','ตึก B ชั้น 2'),
         ('ออร์โธปิดิกส์','ตึก C ชั้น 1'),('ฉุกเฉิน','ตึก ER'),('เภสัชกรรม','ตึก A ชั้น 1'),('หอผู้ป่วยใน','ตึก D')]
DRUGS = [('Amlodipine','Norvasc','Tablet','5 mg','tab',0),('Atorvastatin','Lipitor','Tablet','20 mg','tab',0),('Metformin','Glucophage','Tablet','500 mg','tab',0),
 ('Losartan','Cozaar','Tablet','50 mg','tab',0),('Omeprazole','Losec','Capsule','20 mg','cap',0),('Paracetamol','Tylenol','Tablet','500 mg','tab',0),
 ('Ibuprofen','Brufen','Tablet','400 mg','tab',0),('Amoxicillin','Amoxil','Capsule','500 mg','cap',0),('Cefalexin','Keflex','Capsule','500 mg','cap',0),
 ('Azithromycin','Zithromax','Tablet','250 mg','tab',0),('Ciprofloxacin','Ciproxin','Tablet','500 mg','tab',0),('Warfarin','Coumadin','Tablet','3 mg','tab',1),
 ('Insulin glargine','Lantus','Injection','100 U/mL','vial',1),('Heparin','Hepalean','Injection','5000 U/mL','vial',1),('Morphine','MST','Tablet','10 mg','tab',1),
 ('Furosemide','Lasix','Tablet','40 mg','tab',0),('Enalapril','Renitec','Tablet','5 mg','tab',0),('Simvastatin','Zocor','Tablet','20 mg','tab',0),
 ('Salbutamol','Ventolin','Inhaler','100 mcg','puff',0),('Prednisolone','Deltasone','Tablet','5 mg','tab',0),('Cetirizine','Zyrtec','Tablet','10 mg','tab',0),
 ('Loratadine','Clarityn','Tablet','10 mg','tab',0),('Aspirin','Aspent','Tablet','81 mg','tab',0),('Clopidogrel','Plavix','Tablet','75 mg','tab',0),
 ('Gliclazide','Diamicron','Tablet','80 mg','tab',0),('Carvedilol','Dilatrend','Tablet','6.25 mg','tab',0),('Bisoprolol','Concor','Tablet','2.5 mg','tab',0),
 ('Levothyroxine','Eltroxin','Tablet','50 mcg','tab',0),('Domperidone','Motilium','Tablet','10 mg','tab',0),('Famotidine','Pepcid','Tablet','20 mg','tab',0),
 ('Diazepam','Valium','Tablet','5 mg','tab',1),('Tramadol','Tramal','Capsule','50 mg','cap',1),('Diclofenac','Voltaren','Tablet','25 mg','tab',0),
 ('Doxycycline','Vibramycin','Capsule','100 mg','cap',0),('Metronidazole','Flagyl','Tablet','400 mg','tab',0),('Ondansetron','Zofran','Tablet','4 mg','tab',0)]
ICD = [('I10','ความดันโลหิตสูง'),('E11.9','เบาหวานชนิดที่ 2'),('J06.9','ติดเชื้อทางเดินหายใจส่วนบน'),('K29.7','กระเพาะอาหารอักเสบ'),
       ('M54.5','ปวดหลังส่วนล่าง'),('J45.9','หอบหืด'),('N39.0','ติดเชื้อทางเดินปัสสาวะ'),('A09','ท้องร่วง'),('S52.5','กระดูกแขนหัก'),
       ('E78.5','ไขมันในเลือดสูง'),('R50.9','ไข้ไม่ทราบสาเหตุ'),('O80','คลอดปกติ')]
LABS = [('CBC - WBC','7.2 x10^3/uL'),('Fasting glucose','126 mg/dL'),('HbA1c','7.1 %'),('Creatinine','0.9 mg/dL'),('LDL','130 mg/dL'),('Hemoglobin','13.5 g/dL')]
SYMPTOMS = ['ไข้ ไอ เจ็บคอ','ปวดหัว เวียนหัว','ปวดท้อง','ตรวจสุขภาพประจำปี','ติดตามอาการเบาหวาน','ปวดหลัง','หอบเหนื่อย','ผื่นคัน']
FEEDBACK = ['บริการดีมาก','รอคิวนานไปหน่อย','หมอให้คำแนะนำละเอียด','เจ้าหน้าที่สุภาพ','ระบบจองคิวใช้งานง่าย','อยากให้มีที่จอดรถเพิ่ม']
BLOOD = ['A','B','O','AB','A+','O+']

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--seed', type=int, default=313); a = ap.parse_args()
    r = random.Random(a.seed)
    D = dt.timedelta
    emit('department', ['department_id','name','location'], [(i+1, n, l) for i, (n, l) in enumerate(DEPTS)])

    staff = []
    for i in range(1, 21):
        role = 'doctor' if i <= 8 else 'pharmacist' if i <= 14 else 'nurse' if i <= 18 else 'technician'
        dept = (i % 6) + 1 if role == 'doctor' else 7 if role in ('pharmacist','technician') else 8
        staff.append((i, FIRST[(i+3) % 20], LAST[(i*7) % 10], role, dept, '%s-%03d' % (role[:3].upper(), i),
                      '09%08d' % r.randint(10000000, 99999999), 'staff%d@hospital.example' % i))
    # demo admin: sign up on the website with this e-mail and the account becomes admin (sign-up trigger, 01_core.sql)
    staff.append((21, 'ผู้ดูแล', 'ระบบ', 'admin', None, None, None, 'admin@hospital.example'))
    emit('staff', ['staff_id','first_name','last_name','role','department_id','license_no','phone','email'], staff)

    pats = []
    for i in range(1, 41):
        pats.append((i, 'HN%04d' % i, '1%012d' % i, FIRST[(i-1) % 20], LAST[(i*3) % 10],
                     dt.date(1950, 1, 1) + D(days=r.randint(0, 25000)), 'M' if i % 2 else 'F', '08%08d' % r.randint(10000000, 99999999),
                     'patient%d@example.com' % i if i <= 20 else None, 'กรุงเทพฯ เขต %d' % (i % 50 + 1), r.choice(BLOOD),
                     'แพ้เพนิซิลลิน' if i % 7 == 0 else None))
    emit('patient', ['patient_id','hn','national_id','first_name','last_name','birth_date','gender','phone','email','address','blood_type','allergy_note'], pats)

    emit('room', ['room_id','room_no','room_type','department_id','capacity'],
         [(i, 'A%d%02d' % (1 + i // 5, i), 'ห้องรวม' if i % 3 else 'ห้องเดี่ยว', 8 if i <= 6 else 2, 3) for i in range(1, 11)])

    base = dt.datetime(2026, 7, 1, 8, 0)
    visits, adm = [], []
    for i in range(1, 61):
        vt = 'ER' if i % 10 == 0 else 'IPD' if i % 10 in (1, 4, 7) else 'OPD'
        admit = base + D(days=r.randint(0, 125), hours=r.randint(0, 9), minutes=r.choice([0, 15, 30, 45]))
        if vt == 'IPD':
            dis = admit + D(days=r.randint(2, 7)) if admit < dt.datetime(2026, 10, 25) else None
        else:
            dis = admit + D(hours=r.randint(1, 3))
        visits.append((i, (i - 1) % 40 + 1, (i % 8) + 1, vt, admit, dis, 'Admitted' if dis is None else 'Discharged'))
    for n, v in enumerate([v for v in visits if v[3] == 'IPD'], start=1):
        adm.append((n, v[0], n, v[4], v[5]))
    occupied = {a[2] for a in adm if a[4] is None}
    emit('bed', ['bed_id','room_id','bed_no','status'],
         [(i, (i - 1) // 3 + 1, 'B%d' % ((i - 1) % 3 + 1), 'Occupied' if i in occupied else 'Maintenance' if i == 30 else 'Available') for i in range(1, 31)])
    emit('visit', ['visit_id','patient_id','staff_id','visit_type','admit_date','discharge_date','status'], visits)
    emit('admission', ['admission_id','visit_id','bed_id','assigned_date','released_date'], adm)
    emit('diagnosis', ['diagnosis_id','visit_id','icd_code','description','diagnosed_date'],
         [(i, i, ICD[(i * 5) % 12 if i % 3 else 0][0], ICD[(i * 5) % 12 if i % 3 else 0][1], visits[i-1][4] + D(minutes=40)) for i in range(1, 61)])
    emit('lab_result', ['lab_id','visit_id','test_name','result_value','test_date'],
         [(i, i, LABS[i % 6][0], LABS[i % 6][1], visits[i-1][4] + D(hours=2)) for i in range(1, 41)])
    emit('insurance_coverage', ['insurance_id','patient_id','provider_name','policy_no','coverage_type'],
         [(i, i, ['สปสช.','ประกันสังคม','AIA','เมืองไทยประกันภัย'][i % 4], 'POL%06d' % (1000 + i), ['ผู้ป่วยนอก','ผู้ป่วยใน','ครบวงจร'][i % 3]) for i in range(1, 31)])
    charges, cid = [], 0
    for v in visits:
        for k in range(2):
            cid += 1
            charges.append((cid, v[0], (v[4] + D(days=k)).date(), ['ค่าห้อง','ค่ายา','ค่าตรวจ','ค่าบริการพยาบาล'][(cid + k) % 4],
                            round(r.uniform(800, 6000) if v[3] == 'IPD' else r.uniform(150, 1500), 2)))
    emit('daily_charge', ['charge_id','visit_id','charge_date','item_description','amount'], charges)

    # bookings: 12 dated today (unique doctor/slot), 38 spread across -30..+14 days
    book, used = [], set()
    for k in range(12): used.add((k % 8, 0, k // 8))
    keys = [(k % 8, 0, k // 8) for k in range(12)]
    offs = list(range(-30, 0)) + list(range(1, 15))
    while len(keys) < 50:
        key = (r.randrange(8), r.choice(offs), r.randrange(7))
        if key not in used: used.add(key); keys.append(key)
    for i, (doc, off, slot) in enumerate(keys, start=1):
        status = ['confirmed', 'pending'][i % 2] if off == 0 else r.choice(['completed','completed','completed','cancelled']) if off < 0 else r.choice(['pending','confirmed'])
        book.append((i, (i * 3) % 40 + 1, doc + 1, Raw('CURRENT_DATE + (%d)' % off), '%02d:00' % (9 + slot), slot + 1, SYMPTOMS[i % 8], status))
    emit('booking', ['booking_id','patient_id','staff_id','booking_date','booking_time','queue_no','symptom','status'], book)
    emit('feedback', ['feedback_id','patient_id','booking_id','message'], [(i, book[i-1][1], i, FEEDBACK[i % 6]) for i in range(1, 31)])

    emit('drug', ['drug_id','generic_name','trade_name','dosage_form','strength','unit','is_high_alert'],
         [(i + 1, g, t, f, s, u, bool(h)) for i, (g, t, f, s, u, h) in enumerate(DRUGS)])
    cost = {d: round(r.uniform(0.5, 80), 2) for d in range(1, 36)}
    lots = []
    for d in range(1, 36):
        lots.append((d, d, 'LOT-%03d-A' % d, dt.date(2025, 6, 1) + D(days=d * 9), dt.date(2028, 1, 1) + D(days=d * 5), cost[d], 1000))
    for k in range(1, 11):
        if k <= 3:
            man, exp = Raw('CURRENT_DATE - 700'), Raw('CURRENT_DATE + %d' % (30 + 25 * (k - 1)))
        else:
            man, exp = dt.date(2026, 3, 1) + D(days=k), dt.date(2028, 6, 1) + D(days=k * 3)
        lots.append((35 + k, k, 'LOT-%03d-B' % k, man, exp, cost[k], 800))
    emit('drug_lot', ['lot_id','drug_id','lot_number','manufacture_date','expiry_date','cost_per_unit','initial_quantity'], lots)

    presc, items, disp = [], [], []
    iid = did = 0
    for i in range(1, 46):
        status = 'Cancelled' if i % 9 == 0 else ['Pending', 'Screened', 'Dispensed', 'Dispensed', 'Dispensed'][i % 5]
        v = visits[i - 1]; pdate = v[4] + D(minutes=30); total = 0.0; mine = []
        for dr in r.sample(range(1, 36), 2):
            iid += 1; qty = r.randint(10, 60)
            mine.append((iid, i, dr, '1 tab', 'PO', r.choice(['OD', 'BID', 'TID']), qty, r.randint(5, 30), 'หลังอาหาร'))
            total += qty * cost[dr]
        items += mine
        presc.append((i, i, v[2], pdate, status, round(total, 2)))
        if status == 'Dispensed':
            for it in mine:
                did += 1; disp.append((did, it[0], 9 + did % 6, it[2], pdate + D(hours=1), it[6], 'DP'))
    extra = 60 - len(disp)
    for it in [d for d in disp][:max(extra, 0)]:
        did += 1; disp.append((did, it[1], it[2], it[3], it[4] + D(hours=1), 5, 'VF'))
    emit('prescription', ['prescription_id','visit_id','staff_id','prescription_date','status','total_price'], presc)
    emit('prescription_item', ['item_id','prescription_id','drug_id','dosage','route','frequency','quantity','duration_days','instruction'], items)
    emit('dispense_record', ['dispense_id','item_id','staff_id','lot_id','dispense_date','dispensed_quantity','status_code'], disp)
    emit('inventory', ['inventory_id','drug_id','lot_id','location','quantity_on_hand','reorder_point'],
         [(l[0], l[1], l[0], 'คลัง %s-%02d' % (chr(65 + l[0] % 4), l[0] % 9 + 1), r.randint(10, 60) if l[0] % 5 == 0 else r.randint(150, 800), 100) for l in lots])
    emit('drug_allergy_record', ['allergy_id','patient_id','drug_id','reaction_details','severity'],
         [(i, (i * 5) % 40 + 1, (i * 3) % 35 + 1, ['ผื่นคัน','หายใจลำบาก','คลื่นไส้','บวมที่ใบหน้า'][i % 4], ['Mild','Moderate','Severe','Fatal'][i % 3]) for i in range(1, 31)])

    print('-- Generated by db/seed/generate_seed.py (seed=%d). Do not edit by hand.' % a.seed)
    print(''.join(OUT))
    for t, c in SEQS:
        print("SELECT setval(pg_get_serial_sequence('%s','%s'), (SELECT max(%s) FROM %s));" % (t, c, c, t))

main()
