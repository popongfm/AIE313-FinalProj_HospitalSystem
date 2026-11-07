// Maps Postgres/PostgREST error codes to Thai messages. Never returns the raw database message.
const MESSAGES = {
  '23505': 'ข้อมูลซ้ำ มีรายการนี้อยู่แล้ว',
  '23503': 'ลบ/แก้ไขไม่ได้ เพราะมีข้อมูลอื่นอ้างอิงอยู่',
  '23514': 'ข้อมูลไม่ถูกต้องตามเงื่อนไขของระบบ',
  '23502': 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ',
  '42501': 'ไม่มีสิทธิ์ใช้งาน',
};
export const DEFAULT_ERROR = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
export function friendlyError(err) {
  if (!err) return DEFAULT_ERROR;
  return MESSAGES[err.code] ?? DEFAULT_ERROR;
}
