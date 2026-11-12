/**
 * Сопоставление строки документа с номенклатурой — перенос MON CHEF V11 (нормализация OCR, нечёткое сравнение
 * по Левенштейну, словарь подтверждённых соответствий с привязкой к поставщику) и основного сопоставителя R2
 * (Code.gs _matchNomenclature_: виды-исключения, синонимы, слова-уточнения, штраф за разные числа — «сливки 10 %»
 * и «сливки 33 %» разные товары). Порядок и пороги — как в MON CHEF: словарь ≥ 0,88 → R2 ≥ 0,55 → нечёткое от 0,70. Словарь пополняется только тем, что выбрал или подтвердил
 * человек (V11 rememberOcrAlias); догадка системы не запоминается.
 */

export const MIN_FUZZY = 0.70;
export const ALIAS_MIN = 0.88;

const LAT: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н' };

/** V11 _mcV11Norm_: латиница-двойники → кириллица, единицы, пунктуация (числа не трогаем). */
export function norm(s: unknown) {
  let x = String(s || '').toLowerCase().replace(/ё/g, 'е');
  x = x.split('').map((ch) => LAT[ch] || ch).join('');
  x = x.replace(/[«»"'`]/g, ' ').replace(/[.,;:()[\]{}]/g, ' ');
  // \b в JS не видит кириллицу — границы слова по пробелам и краям строки
  const unit = (re: string, to: string) => { x = x.replace(new RegExp(`(^|\\s)(${re})(?=\\s|$)`, 'g'), `$1 ${to} `); };
  unit('шт|штук', 'шт'); unit('килограмм|килограмма|килограммов|кг', 'кг'); unit('грамм|грамма|гр', 'г'); unit('литр|литра|литров|л', 'л'); unit('миллилитр|миллилитра|мл', 'мл');
  return x.replace(/\s+/g, ' ').trim();
}

/** V11 _mcV11Words_: значимые слова (без чисел и единиц). */
export function words(s: unknown) {
  return norm(s).split(' ').filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !/^(кг|г|л|мл|шт)$/.test(w));
}

/** Расстояние Левенштейна (V11 _mcV11Edit_). */
export function edit(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j), cur: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    cur = [i];
    for (let k = 1; k <= b.length; k++) cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Похожесть двух слов (V11 _mcV11TokenSim_). */
export function tokenSim(a0: string, b0: string) {
  const a = norm(a0), b = norm(b0);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.length >= 5 && b.startsWith(a)) || (b.length >= 5 && a.startsWith(b))) return 0.92;
  const max = Math.max(a.length, b.length);
  if (max < 4) return 0;
  return 1 - edit(a, b) / max;
}

/** Похожесть названий (V11 _mcV11FuzzyScore_): покрытие слов запроса + доля почти точных. */
export function fuzzyScore(query: string, candidate: string) {
  const q = words(query), c = words(candidate);
  if (!q.length || !c.length) return 0;
  let matched = 0, exactish = 0;
  for (const w of q) {
    let best = 0;
    for (const v of c) best = Math.max(best, tokenSim(w, v));
    if (best >= MIN_FUZZY) matched += best;
    if (c.some((v) => tokenSim(w, v) >= 0.92)) exactish++;
  }
  return Math.min(1, (matched / q.length) * 0.8 + (exactish / q.length) * 0.2);
}

export interface Product { id: string; name: string; unit: string }

/* ───────────── R2 (MON CHEF Code.gs _matchNomenclature_) ───────────── */

const R2_STOP = new Set(['и', 'с', 'со', 'на', 'из', 'для', 'от', 'по', 'в', 'до', 'за', 'к', 'а', 'или', 'кг', 'г', 'гр', 'мл', 'л', 'шт', 'уп', 'упак', 'банка', 'пачка', 'пакет']);
const R2_MODIFIERS = new Set(['филе', 'охлажденное', 'охлажденная', 'охлажденный', 'охлажд', 'замороженное', 'замороженная', 'свежий', 'свежая', 'свежее', 'очищенный', 'очищенная',
  'зачищенная', 'мытый', 'мытая', 'без', 'кожи', 'кости', 'молочные', 'молочная', 'пищевая', 'столовая']);
const R2_SYNONYMS: Record<string, string[]> = { семга: ['лосось'], лосось: ['семга'], говядина: ['говяжье'], говяжье: ['говядина'], курица: ['куриное', 'курин'], куриное: ['курица'],
  курин: ['курица', 'куриное'], масло: ['подсолнечное'], сахар: ['песок'], сливки: ['молочные'] };
const R2_GROUPS = [
  ['куриц', 'курин', 'индейк', 'утк', 'гус', 'перепел'],
  ['говядин', 'говяж', 'свинин', 'свин', 'баранин', 'телятин', 'ягнен'],
  ['семг', 'лосос', 'форел', 'тунец', 'тунц', 'сельд', 'селедк', 'треск', 'судак', 'дорад', 'сибас', 'палтус', 'осетр', 'камбал'],
  ['сливочн', 'растительн', 'подсолнечн', 'оливков', 'кукурузн', 'сливки', 'сливок', 'сметан', 'молок', 'молоч', 'кефир', 'йогурт'],
];
const r2Normalize = (s: unknown) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/["'«»]/g, '').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
const r2Tokens = (s: unknown) => r2Normalize(s).split(' ').filter((w) => w.length >= 2 && !R2_STOP.has(w) && !/^\d+$/.test(w));
const r2Numbers = (s: unknown) => (String(s || '').match(/\d+[.,]?\d*/g) || []).map((n) => parseFloat(n.replace(',', '.'))).filter((n) => !Number.isNaN(n));
const r2Expand = (t: string[]) => t.concat(...t.map((x) => R2_SYNONYMS[x] || []));
function r2TokenMatch(a: string, b: string) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const minLen = Math.min(a.length, b.length);
  let cp = 0;
  while (cp < minLen && a[cp] === b[cp]) cp++;
  return cp >= Math.max(4, minLen - 2);
}
function r2Conflict(q: string[], c: string[]) {
  for (const grp of R2_GROUPS) {
    const inGroup = (tokens: string[]) => {
      const hits: string[] = [];
      for (const t of tokens) {
        let best: string | null = null;
        for (const g of grp) if (t.startsWith(g) && (!best || g.length > best.length)) best = g;
        if (best && !hits.includes(best)) hits.push(best);
      }
      return hits;
    };
    const iq = inGroup(q), ic = inGroup(c);
    if (iq.length && ic.length && !iq.some((x) => ic.includes(x))) return true;
  }
  return false;
}
function r2Score(q: string[], c: string[]) {
  if (!q.length || !c.length || r2Conflict(q, c)) return 0;
  const wt = (t: string) => (R2_MODIFIERS.has(t) ? 0.3 : 1);
  let qt = 0, qm = 0, ct = 0, cm = 0;
  for (const w of q) { qt += wt(w); if (c.some((x) => r2TokenMatch(w, x))) qm += wt(w); }
  for (const w of c) { ct += wt(w); if (q.some((x) => r2TokenMatch(w, x))) cm += wt(w); }
  return Math.min(1, (qt ? qm / qt : 0) * 0.75 + (ct ? cm / ct : 0) * 0.25);
}
function r2NumberPenalty(a: string, b: string) {
  const qn = r2Numbers(a), cn = r2Numbers(b);
  if (!qn.length || !cn.length) return 1;
  return qn.some((x) => cn.some((y) => Math.abs(x - y) < 0.01)) ? 1 : 0.35;
}
/** R2: лучший кандидат от 0,35 и альтернативы от 0,30. */
export function matchNomenclature(raw: string, products: Product[], topN = 5) {
  const qt = r2Expand(r2Tokens(raw)), nq = r2Normalize(raw);
  const top = products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, confidence: Math.round((r2Normalize(p.name) === nq ? 1 : r2Score(qt, r2Tokens(p.name)) * r2NumberPenalty(raw, p.name)) * 100) / 100 }))
    .filter((x) => x.confidence >= 0.3).sort((a, b) => b.confidence - a.confidence).slice(0, topN);
  const matched = top.length && top[0].confidence >= 0.35 ? top[0] : null;
  return { matched, alternatives: matched ? top.slice(1) : top };
}

export interface Alias { raw_norm: string; product_id: string; supplier_key: string | null }
export interface Match { id: string; name: string; unit: string; confidence: number; source: 'ALIAS' | 'R2' | 'FUZZY' }

/** Ключ поставщика (V12 _mcV12SupplierKey_). */
export const supplierKey = (s: unknown) => norm(s).replace(/[^а-яa-z0-9]+/g, ' ').trim();

/**
 * Кандидаты для строки (V11 _mcV11ResolveProduct_): словарь подтверждённых соответствий (сначала этого поставщика) →
 * R2 (уверенно от 0,55) → нечёткое сравнение, если оно лучше; иначе — что нашёл R2 (от 0,35) или ничего.
 */
export function resolver(products: Product[], aliases: Alias[], supplier: string | null) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const sk = supplier ? supplierKey(supplier) : null;
  const own = aliases.filter((a) => !a.supplier_key || !sk || a.supplier_key === sk)
    .sort((a, b) => Number(!!b.supplier_key) - Number(!!a.supplier_key));
  return (raw: string): { matched: Match | null; alternatives: Match[] } => {
    const q = norm(raw);
    if (!q) return { matched: null, alternatives: [] };
    let best: Alias | null = null, bestScore = 0;
    for (const a of own) {
      const s = a.raw_norm === q ? 1 : fuzzyScore(q, a.raw_norm);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    if (best && bestScore >= ALIAS_MIN && byId.has(best.product_id)) {
      const p = byId.get(best.product_id)!;
      return { matched: { id: p.id, name: p.name, unit: p.unit, confidence: 1, source: 'ALIAS' }, alternatives: [] };
    }
    const r2 = matchNomenclature(raw, products, 5);
    if (r2.matched && r2.matched.confidence >= 0.55) return { matched: { ...r2.matched, source: 'R2' }, alternatives: r2.alternatives.map((a) => ({ ...a, source: 'R2' as const })) };
    const f = products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, confidence: Math.round(fuzzyScore(raw, p.name) * 100) / 100, source: 'FUZZY' as const }))
      .filter((x) => x.confidence >= MIN_FUZZY).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    if (f.length && (!r2.matched || f[0].confidence > r2.matched.confidence)) return { matched: f[0], alternatives: f.slice(1) };
    if (r2.matched) return { matched: { ...r2.matched, source: 'R2' }, alternatives: r2.alternatives.map((a) => ({ ...a, source: 'R2' as const })) };
    return { matched: null, alternatives: r2.alternatives.map((a) => ({ ...a, source: 'R2' as const })) };
  };
}
