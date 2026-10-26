/**
 * Цепочка обработки строки ТТК (ГОСТ 31988-2012): брутто → холодная обработка → нетто → тепловая → выход.
 * Шаги идут по порядку; нетто — масса перед первым тепловым шагом, выход — масса после всех шагов.
 * Отрицательный процент — привар (крупы, макароны). Считается от любой известной величины: от брутто вперёд,
 * от нетто или выхода — обратно (сколько взять сырья, чтобы получить нужный выход).
 */

export type From = 'brutto' | 'netto' | 'ready';
export interface ChainStep { kind: 'cold' | 'thermal'; loss_pct: number }

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Коэффициенты: нетто/брутто и выход/нетто. */
export function factors(steps: ChainStep[]) {
  const firstThermal = steps.findIndex((s) => s.kind === 'thermal');
  let toNetto = 1, toReady = 1;
  steps.forEach((s, i) => {
    const k = 1 - Number(s.loss_pct) / 100;
    if (firstThermal === -1 || i < firstThermal) toNetto *= k; else toReady *= k;
  });
  return { toNetto, toReady };
}

export function chain(steps: ChainStep[], from: From, value: number) {
  const { toNetto, toReady } = factors(steps);
  const brutto = from === 'brutto' ? value : from === 'netto' ? value / toNetto : value / toReady / toNetto;
  return { brutto: r3(brutto), netto: r3(brutto * toNetto), ready: r3(brutto * toNetto * toReady) };
}

/** Доля сохранённого нутриента после тепловых шагов; null — потери хотя бы на одном тепловом шаге неизвестны. */
export function retention(steps: { kind: string; protein_loss_pct: number | null; fat_loss_pct: number | null; carbs_loss_pct: number | null }[]) {
  const out = { protein: 1, fat: 1, carbs: 1 };
  for (const s of steps) {
    if (s.kind !== 'thermal') continue;
    if (s.protein_loss_pct === null || s.fat_loss_pct === null || s.carbs_loss_pct === null) return null;
    out.protein *= 1 - Number(s.protein_loss_pct) / 100; out.fat *= 1 - Number(s.fat_loss_pct) / 100; out.carbs *= 1 - Number(s.carbs_loss_pct) / 100;
  }
  return out;
}

/** ММДД даты и попадание в сезон (с переходом через Новый год: 901–1231 и 101–831). */
export const mmdd = (d: string) => Number(d.slice(5, 7)) * 100 + Number(d.slice(8, 10));
export function inSeason(md: number, from: number | null, to: number | null) {
  if (from === null || to === null) return true;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
/** Пересекаются ли два сезона (круглый год пересекается со всеми). */
export function seasonsOverlap(a: [number | null, number | null], b: [number | null, number | null]) {
  if (a[0] === null || b[0] === null) return true;
  const days = (f: number, t: number) => { const s = new Set<number>(); for (let m = 1; m <= 12; m++) for (let d = 1; d <= 31; d++) { const x = m * 100 + d; if (inSeason(x, f, t)) s.add(x); } return s; };
  const sa = days(a[0], a[1]!);
  for (const x of days(b[0], b[1]!)) if (sa.has(x)) return true;
  return false;
}
export const seasonLabel = (from: number | null, to: number | null) => {
  if (from === null || to === null) return 'круглый год';
  const f = (x: number) => `${String(x % 100).padStart(2, '0')}.${String(Math.floor(x / 100)).padStart(2, '0')}`;
  return `с ${f(from)} по ${f(to)}`;
};

/** Массы по стадиям от брутто: нетто (до первой тепловой), после последней тепловой, выход (после всех шагов). */
export function stages(steps: ChainStep[], brutto: number) {
  const firstT = steps.findIndex((s) => s.kind === 'thermal');
  let lastT = -1;
  steps.forEach((s, i) => { if (s.kind === 'thermal') lastT = i; });
  let m = brutto, netto = brutto, thermal = brutto;
  steps.forEach((s, i) => {
    if (i === firstT) netto = m;
    m *= 1 - Number(s.loss_pct) / 100;
    if (i === lastT) thermal = m;
  });
  if (firstT === -1) { netto = m; thermal = m; }
  return { brutto, netto, thermal, ready: m };
}

/** Процент отходов (потерь) между массами: (М1 − М2) / М1 × 100 (ГОСТ 31988-2012). */
export const lossPct = (m1: number | null, m2: number | null) => (m1 && m2 !== null && m1 > 0 ? Math.round((m1 - m2) / m1 * 1000) / 10 : null);
