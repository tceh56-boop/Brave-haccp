/** Дата и время в часовом поясе предприятия; числа — с запятой. */
export function dt(ts: string | null | undefined, tz?: string, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ru-RU', { ...opts, timeZone: tz });
}
export function d(ts: string | null | undefined, tz?: string) {
  return dt(ts, tz, { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function n(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  return String(Number(v)).replace('.', ',');
}
export function ago(ts: string | null | undefined) {
  if (!ts) return '';
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60e3);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
}
