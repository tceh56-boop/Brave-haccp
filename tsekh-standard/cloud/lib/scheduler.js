'use strict';
/**
 * Триггеры по времени (вместо триггеров Apps Script) и отправка писем из очереди.
 * Работает в отдельном процессе: раз в 30 секунд смотрит триггеры всех предприятий и запускает наступившие
 * в том же порядке и с тем же событием (e.triggerUid и др.), что Google.
 */
const tenants = require('./tenants');
const { partsIn } = require('./gas/utilities');
const { sendPending } = require('./mailer');

const TICK = Number(process.env.SCHEDULER_TICK_MS || 30000);
const DAYS = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };

/** Наступил ли срок триггера. now, last — миллисекунды; tz — пояс предприятия. */
function due(tr, now, tz) {
  const s = tr.spec || {};
  const last = tr.last_run || 0;
  if (s.at) return !tr.last_run && now >= s.at;
  if (s.every) return now - (last || tr.created) >= s.every;
  if (s.days || s.weeks || s.weekday || s.monthday) {
    const p = partsIn(now, s.tz || tz);
    const hour = s.hour === undefined ? 0 : s.hour;
    if (p.H < hour) return false;
    if (s.minute !== undefined && p.H === hour && p.m < Math.max(0, s.minute - 15)) return false;
    if (s.weekday && DAYS[s.weekday] !== p.wd) return false;
    if (s.monthday && s.monthday !== p.d) return false;
    if (!last) return true;
    const lp = partsIn(last, s.tz || tz);
    const sameDay = lp.y === p.y && lp.M === p.M && lp.d === p.d;
    if (sameDay) return false;
    const intervalDays = (s.weeks ? s.weeks * 7 : 0) || s.days || 1;
    return now - last >= (intervalDays - 1) * 86400000 + 3600000;
  }
  return false;
}

function triggerEvent(tr, now, tz) {
  const p = partsIn(now, tz);
  return { authMode: 'FULL', triggerUid: tr.id, year: p.y, month: p.M, 'day-of-month': p.d, 'day-of-week': p.wd === 0 ? 7 : p.wd, 'week-of-year': 0,
    hour: p.H, minute: p.m, second: p.s, timezone: tz };
}

function tick() {
  const now = Date.now();
  for (const cfg of tenants.list()) {
    if (cfg.disabled) continue;
    const t = tenants.get(cfg.slug);
    if (!t) continue;
    let list = [];
    try { list = t.store.triggers().filter((x) => x.kind === 'clock'); } catch (e) { continue; }
    for (const tr of list) {
      if (!due(tr, now, t.timeZone())) continue;
      let err = null;
      try {
        t.execute(tr.handler, [triggerEvent(tr, now, t.timeZone())], { slowMs: 60000 });
      } catch (e) {
        err = String((e && e.message) || e);
        t.store.log('ERROR', `триггер ${tr.handler}: ${err}${e.where ? '\n' + e.where.split('\n').slice(0, 3).join('\n') : ''}`);
      }
      // триггер мог удалить сам себя (или его удалили) — тогда записи уже нет
      if (tr.spec && tr.spec.at) t.store.deleteTrigger(tr.id); else t.store.triggerRan(tr.id, err);
    }
  }
}

function start() {
  console.log(`планировщик ${process.pid}: триггеры раз в ${TICK / 1000} с`);
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try { tick(); } catch (e) { console.error('планировщик:', e.message); }
    try { await sendPending(); } catch (e) { console.error('почта:', e.message); }
    busy = false;
  };
  setTimeout(loop, 5000);
  setInterval(loop, TICK);
}

module.exports = { start, due, tick };
