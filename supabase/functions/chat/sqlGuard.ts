// Defence in depth for Text-to-SQL: the database role (chat_reader) can only read 9 views anyway; this guard rejects
// everything else before it reaches the database and enforces a row limit.
export const ALLOWED_VIEWS = [
  'v_booking_queue_today', 'v_doctor_workload', 'v_feedback_summary', 'v_bed_occupancy', 'v_visit_billing',
  'v_top_diagnosis', 'v_pharmacist_screening_queue', 'v_inventory_stock_status', 'v_drug_cost_summary',
] as const;
export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };
const MAX_ROWS = 100;
const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|set|execute|vacuum|analyze|listen|notify|lock|merge|into|set_config|current_setting|dblink\w*|lo_\w+|pg_\w*|information_schema|table|recursive|lateral)\b/i;
const ALLOWED_FUNCS = new Set(['count','sum','avg','min','max','round','coalesce','nullif','to_char','date_trunc','date_part','extract',
  'now','lower','upper','abs','ceil','floor','cast','substring','trim','length','greatest','least','row_number','rank','dense_rank']);
// words that may legitimately precede "(" without being a function call
const PAREN_WORDS = new Set(['in','as','from','join','on','and','or','not','where','having','by','over','filter','when','then','else','case',
  'select','union','intersect','except','all','any','exists','between','with','partition','order','using','materialized','distinct','end']);
const MAX_JOINS = 5;
const reject = (reason: string): GuardResult => ({ ok: false, reason });

export function validateSql(input: string): GuardResult {
  if (typeof input !== 'string' || input.trim() === '') return reject('ไม่ได้รับคำสั่ง SQL จากระบบ AI');
  let sql = input.trim().replace(/;\s*$/, '').trim();
  if (/--|\/\*|\*\//.test(sql)) return reject('ไม่อนุญาตให้ใช้คอมเมนต์ใน SQL');
  if (sql.includes(';')) return reject('อนุญาตเพียงคำสั่งเดียวเท่านั้น');
  if (/["$\\]/.test(sql)) return reject('SQL มีอักขระที่ไม่อนุญาต');
  if (!/^(select|with)\b/i.test(sql)) return reject('อนุญาตเฉพาะคำสั่ง SELECT เท่านั้น');
  if (FORBIDDEN.test(sql)) return reject('คำสั่งนี้มีคำที่ไม่อนุญาต ระบบอ่านข้อมูลได้อย่างเดียว');

  for (const m of sql.matchAll(/\b([a-z_]\w*)\s*\(/gi)) {
    const w = m[1].toLowerCase();
    if (!ALLOWED_FUNCS.has(w) && !PAREN_WORDS.has(w)) return reject(`ไม่อนุญาตให้ใช้ฟังก์ชัน "${m[1]}"`);
  }
  if ((sql.match(/\bjoin\b/gi) ?? []).length > MAX_JOINS) return reject('ใช้ JOIN มากเกินไป');
  const ctes = new Set([...sql.matchAll(/(?:\bwith|,)\s+([a-z_]\w*)\s+as\s*(?:materialized\s+)?\(/gi)].map((m) => m[1].toLowerCase()));
  // FROM inside EXTRACT(... FROM x) / SUBSTRING / TRIM is not a table reference
  const scan = sql.replace(/\b(extract|substring|trim|overlay|position)\s*\([^()]*?\bfrom\b/gi, '$1(x,');
  if (/\bfrom\s+[\w.]+(?:\s+(?:as\s+)?\w+)?\s*,/i.test(scan)) return reject('ไม่อนุญาตให้ใช้ comma join ให้ใช้ JOIN แทน');
  for (const m of scan.matchAll(/\b(?:from|join)\s+([\w.]+)/gi)) {
    const name = m[1].toLowerCase().replace(/^public\./, '');
    if (!(ALLOWED_VIEWS as readonly string[]).includes(name) && !ctes.has(name)) return reject(`ไม่อนุญาตให้เข้าถึง "${m[1]}" อนุญาตเฉพาะ View ของระบบรายงาน`);
  }
  const tail = /\blimit\s+(\d+)\s*$/i.exec(sql);
  if (/\b(offset|fetch)\b/i.test(sql)) sql = `SELECT * FROM (${sql}) q LIMIT ${MAX_ROWS}`;
  else if (!tail) sql += ` LIMIT ${MAX_ROWS}`;
  else if (Number(tail[1]) > MAX_ROWS) sql = sql.replace(/\blimit\s+\d+\s*$/i, `limit ${MAX_ROWS}`);
  return { ok: true, sql };
}
