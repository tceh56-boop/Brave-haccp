import { z } from 'zod';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';
import { normName } from './recipes';
import { approveNormTx } from './processing';
import { roleHas } from '../access/roles';
import book from '../../../data/reference/sbornik2022.json';

/**
 * Нормы отходов и потерь из Сборника рецептур для обучающихся образовательных организаций (2022) — встроенный справочник
 * (tools/norms/sbornik2022.py). Три вида данных:
 *  - таблица «Расчет расхода сырья и выхода полуфабрикатов» (с. 669–671) — отходы при холодной обработке, прямо из таблицы;
 *  - холодная обработка по рецептурам — (брутто − нетто) / брутто строки рецептуры;
 *  - тепловая обработка по рецептурам — строка «Масса отварной …» против нетто сырья той же рецептуры.
 * Система подбирает к товарам предприятия подходящие строки, но норму вносит и утверждает человек: справочник —
 * основание, а не решение. Основание нормы — издание, страница или номера рецептур.
 */

interface Row { id: string; product: string; method: string; kind: 'cold' | 'thermal'; pct: number; season: [number, number] | null; source: 'table' | 'recipes' | 'pf';
  recipes: number[]; recipes_total?: number; values: { pct: number; recipes: number[] }[]; note: string | null; basis: string }
const B = book as unknown as { source: Record<string, any>; norms: Row[] };
const SRC = `${B.source.short}, ${B.source.edition}, ${B.source.publisher}`;

export interface Candidate {
  key: string;                     // T05 | cold:<name> | thermal:<method>:<name>
  kind: 'table' | 'cold' | 'thermal';
  method: string; name: string; pct: number; season: [number, number] | null;
  group: string | null;            // сезонные строки одного сырья — вносятся вместе
  basis: string; note: string | null; alternatives?: { pct: number; recipes: number[] }[];
}

const words = (s: string) => normName(s).replace(/[^а-яa-z ]/g, ' ').split(' ').filter((w) => w.length > 1);
/** Основа слова: без окончания; беглая «е» (огурец → огурц). Совпадение основ — одно слово в разных формах. */
const stems = (w: string) => { const b = w.replace(/(ами|ями|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ые|ие|ам|ям|ах|ях|[аяыиоеуюьй])$/, ''); return [b, b.replace(/е([^аеиоуыэюя])$/, '$1')]; };
const same = (a: string, b: string) => { const x = stems(a), y = stems(b); return x.some((s) => s.length >= 2 && y.includes(s)); };
/** Слова, по которым одного совпадения мало (соус, смесь…): нужно совпадение ещё хотя бы одного слова. */
const GENERIC = new Set(['соус', 'смесь', 'набор', 'заправка', 'пюре', 'сок', 'напиток', 'тесто', 'фарш', 'масло', 'мука', 'крупа']);
const frozen = (s: string) => /заморож|с\/м|б\/з/i.test(s);
/** Совпадение по первому слову (основе) обязательно; остальные слова и состояние сырья — для порядка. */
function score(product: string, ref: string) {
  const p = words(product), r = words(ref);
  if (!p.length || !r.length || !same(p[0], r[0])) return 0;
  const extra = p.slice(1).filter((w) => r.some((x) => same(w, x))).length;
  if (GENERIC.has(p[0]) && !extra) return 0;
  const state = frozen(product) === frozen(ref) ? 1 : frozen(product) ? -2 : 0;   // замороженное сырьё — к замороженным строкам
  return 10 + extra * 2 + state * 3;
}

const recipesRef = (rs: number[]) => (rs.length > 6 ? `№ ${rs.slice(0, 6).join(', ')} и ещё ${rs.length - 6}` : `№ ${rs.join(', ')}`);
const seasonGroup = (name: string) => name.replace(/,?\s*(с|до) 1 .*$/, '').trim();

function candidates(product: string): Candidate[] {
  const out: (Candidate & { s: number })[] = [];
  for (const r of B.norms) {
    const s = score(product, r.product); if (!s) continue;
    const kind = r.source === 'table' ? 'table' : r.kind;
    out.push({ s: s + (r.source === 'table' ? 5 : 0), key: r.id, kind, method: r.method, name: r.product, pct: r.pct, season: r.season,
      group: r.source === 'table' && r.season ? seasonGroup(r.product) : null, basis: r.basis, note: r.note, alternatives: r.values.length > 1 ? r.values.slice(0, 8) : undefined });
  }
  return out.sort((a, b) => b.s - a.s || (a.kind === 'table' ? -1 : 1)).slice(0, 20).map(({ s, ...c }) => c);
}

/** Товары предприятия и подходящие нормы справочника; отмечено, какие способы уже имеют утверждённую норму. */
export async function sbornikMatches(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'menu.read', async (tx) => {
    const products = (await tx.query(`select id, name, unit from products where organization_id = $1 and status = 'active' order by name`, [orgId])).rows;
    const have = (await tx.query(`select product_id, method_code from processing_norms where organization_id = $1 and status = 'approved'`, [orgId])).rows;
    const items = products.map((p) => ({ product_id: p.id, product_name: p.name, unit: p.unit,
      approved_methods: have.filter((h) => h.product_id === p.id).map((h) => h.method_code), candidates: candidates(p.name) })).filter((x) => x.candidates.length);
    return { source: B.source, items, products: products.length };
  });
}

const Adopt = z.object({
  items: z.array(z.object({ productId: z.uuid(), key: z.string().min(2).max(300), pct: z.coerce.number().optional() })).min(1, 'Выберите хотя бы одну норму.').max(300),
  approve: z.boolean().default(false),
});

/**
 * Внести выбранные нормы. Сезонная строка таблицы вносится со всеми сезонами того же сырья. Процент из рецептур можно
 * выбрать из встречающихся значений (другое значение — только через акт контрольной проработки). С approve — сразу
 * утверждаются (право ttk.approve): утверждает человек, нажавший кнопку.
 */
export async function adoptSbornik(userId: string, orgId: string, input: unknown) {
  const d = parse(Adopt, input);
  return inOrg(userId, orgId, 'ttk.manage', async (tx, m) => {
    if (d.approve && !roleHas(m.role, 'ttk.approve')) throw Errors.forbidden('Утверждать нормы может шеф, технолог или руководитель.');
    let created = 0, replaced = 0;
    const done = new Set<string>();
    for (const it of d.items) {
      const p = (await tx.query(`select id, name from products where id = $1 and organization_id = $2`, [it.productId, orgId])).rows[0];
      if (!p) throw Errors.validation('Товар не найден.');
      const c = candidates(p.name).find((x) => x.key === it.key);
      if (!c) throw Errors.validation(`Для «${p.name}» нет такой нормы в справочнике.`);
      const rows = c.group ? candidates(p.name).filter((x) => x.group === c.group && x.kind === 'table') : [c];
      for (const r of rows) {
        const k = `${p.id}|${r.key}`; if (done.has(k)) continue; done.add(k);
        let pct = r.pct, basis = r.basis;
        if (it.pct !== undefined && r.key === c.key && it.pct !== r.pct) {
          const alt = (r.alternatives || []).find((a) => a.pct === it.pct);
          if (!alt) throw Errors.validation(`«${p.name}»: ${it.pct} % в справочнике не встречается. Другое значение — по акту контрольной проработки.`);
          pct = alt.pct; basis = `${SRC}, рецептуры ${recipesRef(alt.recipes)}: ${r.name}`;
        }
        const n = (await tx.query(`insert into processing_norms (organization_id, product_id, method_code, loss_pct, season_from, season_to, basis, note, created_by)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [orgId, p.id, r.method, pct, r.season?.[0] ?? null, r.season?.[1] ?? null, basis.slice(0, 500), r.note, userId])).rows[0];
        await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'processing_norm.create', entityType: 'processing_norm', entityId: n.id, after: { source: 'sbornik2022', key: r.key, pct } });
        created++;
        if (d.approve) replaced += (await approveNormTx(tx, orgId, userId, n)).replaced;
      }
    }
    return { created, approved: d.approve ? created : 0, replaced };
  });
}
