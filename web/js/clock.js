// Shows which time zone the whole app uses, with the current Thai time: every date and time in this system is
// Thailand time, Asia/Bangkok (GMT+7). Updated every 15 seconds.
import { HOSPITAL_TZ } from './helpers.js';

const fmt = new Intl.DateTimeFormat('th-TH', { timeZone: HOSPITAL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = new Intl.DateTimeFormat('th-TH', { timeZone: HOSPITAL_TZ, dateStyle: 'long' });
export function mountClock(el) {
  if (!el) return;
  el.classList.add('tz-badge');
  el.dataset.hint = 'วันและเวลาทั้งหมดในระบบนี้เป็นเวลาประเทศไทย (Asia/Bangkok, GMT+7)';
  const time = document.createElement('b'), zone = document.createElement('small');
  zone.textContent = 'เวลาประเทศไทย (Asia/Bangkok, GMT+7)';
  el.replaceChildren(time, zone);
  const tick = () => { const now = new Date(); time.textContent = `${fmt.format(now)} น.`; el.title = `${day.format(now)} · ${el.dataset.hint}`; };
  tick(); setInterval(tick, 15000);
}
