import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, getSite, assertSiteAccess } from './common';
import { convertUnits } from './recipes';
import { semiGrams } from './bom';
import { assertSnapshotIntact } from './integrity';
import { DOCS, clauseById, profileOf, regionOk } from '../norms/library';
import { registerNormRefs } from '../readiness/engine';

/**
 * Декларирование соответствия продукции собственного изготовления.
 *
 * Система не регистрирует декларацию и не решает за заявителя. Она:
 *  1) определяет, какие регламенты применяются и нужна ли декларация вообще (ТР ТС 021/2011 ст. 21, 23; ТР ТС 034/2013 п. 4);
 *  2) ограничивает выбор схемы теми, что установлены регламентом (021 — 1д, 2д, 3д; 034 — 3д, 4д, 6д);
 *  3) собирает поля 1–13 единой формы (решение Коллегии ЕЭК N 293) из утверждённых данных и проверяет каждое;
 *  4) собирает комплект доказательственных материалов (ТР ТС 034 п. 138; решение Совета ЕЭК N 44 п. 26) и перечень сведений
 *     для заявления о регистрации (приказ Минэкономразвития N 478, п. 7);
 *  5) хранит принятый текст неизменным, регистрационный номер и дату — после регистрации в ФГИС Росаккредитации;
 *  6) следит за сроком действия; знак ЕАС на этикетке — только при действующей зарегистрированной декларации.
 * Неизвестное не считается выполненным: сырьё без указанного вида (мясо / птица / не мясо) блокирует определение регламента.
 */

export const DECL_REFS = ['trts021:21.3', 'trts021:23.1', 'trts021:23.4', 'trts021:23.10', 'trts034:4', 'trts034:132', 'trts034:135', 'trts034:138', 'trts034:141', 'trts034:109',
  'eec293:4', 'eec293:5', 'eec44:26', 'eec44:28', 'mer478:7', 'mer478:12', 'sanpin4282:7', 'rpn:declaration', 'trts022:1.2'] as const;
registerNormRefs('declarations', [...DECL_REFS]);
type Ref = (typeof DECL_REFS)[number];

export const SCHEMES = {
  '1д': { object: 'serial', accredited: false, sms: false, title: 'серийный выпуск, собственные доказательства, испытания в испытательной лаборатории (в т. ч. собственной) или аккредитованной' },
  '2д': { object: 'batch', accredited: false, sms: false, title: 'партия, собственные доказательства, испытания в испытательной лаборатории или аккредитованной' },
  '3д': { object: 'serial', accredited: true, sms: false, title: 'серийный выпуск, производственный контроль, испытания в аккредитованной испытательной лаборатории' },
  '4д': { object: 'batch', accredited: true, sms: false, title: 'партия, испытания в аккредитованной испытательной лаборатории' },
  '6д': { object: 'serial', accredited: true, sms: true, title: 'серийный выпуск при сертифицированной системе менеджмента, испытания в аккредитованной лаборатории' },
} as const;
type Scheme = keyof typeof SCHEMES;
const SCHEMES_021: Scheme[] = ['1д', '2д', '3д'];
const SCHEMES_034: Scheme[] = ['3д', '4д', '6д'];

export const CHANNELS = {
  services: 'При оказании услуг общественного питания (зал предприятия)',
  offsite: 'Доставка, продажа на вынос, кейтеринг',
  outside: 'Вне услуг общественного питания: магазин, отдел кулинарии, поставка другим организациям, маркетплейс',
} as const;

export const MEAT_KINDS = { slaughter: 'продукты убоя (говядина, свинина, баранина и др.)', poultry: 'мясо птицы и продукты его переработки', none: 'не мясное сырьё' } as const;

const REGS = {
  trts021: 'ТР ТС 021/2011 «О безопасности пищевой продукции»',
  trts022: 'ТР ТС 022/2011 «Пищевая продукция в части ее маркировки»',
  trts034: 'ТР ТС 034/2013 «О безопасности мяса и мясной продукции»',
} as const;

/* ───────────── Ввод ───────────── */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата — в формате ГГГГ-ММ-ДД.');
const Protocol = z.object({
  number: z.string().trim().min(1, 'Номер протокола.').max(100),
  date: isoDate,
  lab: z.string().trim().min(3, 'Наименование испытательной лаборатории.').max(300),
  accreditation: optText(60),
  sampleMadeOn: isoDate.optional().nullable(),
  fileId: z.uuid().optional().nullable(),
});
const DeclInput = z.object({
  channel: z.enum(['services', 'offsite', 'outside']).nullable().optional(),
  specialized: z.boolean().optional(),
  object: z.enum(['serial', 'batch']).optional(),
  batch: z.object({ size: z.coerce.number().positive('Размер партии больше нуля.').max(1e9), unit: z.string().trim().min(1).max(20), lotId: z.uuid().optional().nullable(), shippingDoc: z.string().trim().max(300).optional().nullable() }).nullable().optional(),
  scheme: z.enum(['1д', '2д', '3д', '4д', '6д']).nullable().optional(),
  tnved: z.string().trim().max(20).nullable().optional(),
  productExtra: optText(500),
  protocols: z.array(Protocol).max(20).optional(),
  sms: z.object({ number: z.string().trim().max(100), date: isoDate, body: z.string().trim().max(300), accreditation: z.string().trim().max(60) }).nullable().optional(),
  standards: optText(2000),
  validTo: isoDate.nullable().optional(),
  noTerm: z.boolean().optional(),
  replaces: z.object({ number: z.string().trim().min(1).max(100), date: isoDate }).nullable().optional(),
});
export type DeclDraft = z.infer<typeof DeclInput>;

/* ───────────── Состав сырья по рецептуре ───────────── */

export interface RawShare { product_id: string; name: string; g: number; meat_kind: keyof typeof MEAT_KINDS | null; suggest: keyof typeof MEAT_KINDS | null }

/** Предложение вида сырья по названию — только подсказка; в расчёт идёт то, что подтвердил человек. */
export function suggestMeatKind(name: string): keyof typeof MEAT_KINDS | null {
  const n = name.toLowerCase();
  if (/кур[иы]|куриц|цыпл|бройлер|индей|индюш|утк|утин|гус[ьяи]|гусин|перепел|птиц/.test(n)) return 'poultry';
  if (/говя|говяд|свин|баран|телят|конин|оленин|кроли|шпик|сало\b|грудинк|корейк|окорок|вырезк|бекон|ветчин|субпрод|печень говяж|печень свин|язык|фарш (говяж|свин|мясн)|мясо\b(?! (птиц|краб|кур))/.test(n)) return 'slaughter';
  if (/рыб|кревет|кальмар|мидии|краб|лосос|сёмг|семг|треск|минтай|вода|соль|сахар|мука|рис|круп|масло растит|лук|морков|картоф|томат|перец|зелень|специ|яйц|молок|сливк|сыр|творог|капуст|чеснок|соус/.test(n)) return 'none';
  return null;
}

/** Масса нетто закладки каждого сырья на одну закладку утверждённой ТТК; п/ф раскладываются по своим ТТК. */
async function rawComposition(tx: Tx, dishId: string, scale = 1, depth = 0, acc = new Map<string, RawShare>(), problems: string[] = []) {
  if (depth > 6) { problems.push('Вложенность полуфабрикатов больше 6 уровней — состав не раскрыт.'); return { acc, problems }; }
  const v = (await tx.query(`select id from ttk_versions where dish_id = $1 and status = 'approved'`, [dishId])).rows[0];
  if (!v) { problems.push(`Нет утверждённой ТТК (блюдо ${dishId.slice(0, 8)}).`); return { acc, problems }; }
  const lines = (await tx.query(`select l.name_raw, l.unit, l.netto, l.product_id, l.sub_dish_id, p.name as product_name, p.meat_kind, d.name as sub_name
    from ttk_lines l left join products p on p.id = l.product_id left join dishes d on d.id = l.sub_dish_id where l.version_id = $1 and l.kind = 'item' order by l.position`, [v.id])).rows;
  for (const l of lines) {
    const net = Number(l.netto);
    if (!(net > 0)) continue;
    if (l.product_id) {
      const g = await convertUnits(tx, l.product_id, net, l.unit, 'г');
      if (g == null) { problems.push(`«${l.product_name}»: не пересчитать ${net} ${l.unit} в граммы — нет коэффициента.`); continue; }
      const cur = acc.get(l.product_id);
      if (cur) cur.g += g * scale;
      else acc.set(l.product_id, { product_id: l.product_id, name: l.product_name, g: g * scale, meat_kind: l.meat_kind, suggest: suggestMeatKind(l.product_name) });
    } else if (l.sub_dish_id) {
      const g = await semiGrams(tx, l.sub_dish_id, net, l.unit);
      if (g == null) { problems.push(`«${l.sub_name}»: не пересчитать ${net} ${l.unit} в граммы.`); continue; }
      const sub = await rawComposition(tx, l.sub_dish_id, 1, depth + 1, new Map(), problems);
      const total = [...sub.acc.values()].reduce((s, x) => s + x.g, 0);
      if (!total) { problems.push(`«${l.sub_name}»: состав полуфабриката не определён.`); continue; }
      for (const x of sub.acc.values()) {
        const k = g * scale * (x.g / total), cur = acc.get(x.product_id);
        if (cur) cur.g += k; else acc.set(x.product_id, { ...x, g: k });
      }
    } else problems.push(`Строка «${l.name_raw}» не связана с товаром — вид сырья не определить.`);
  }
  return { acc, problems };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export async function meatProfile(tx: Tx, dishId: string) {
  const { acc, problems } = await rawComposition(tx, dishId);
  const raw = [...acc.values()].map((x) => ({ ...x, g: Math.round(x.g * 10) / 10 })).sort((a, b) => b.g - a.g);
  const total = raw.reduce((s, x) => s + x.g, 0);
  const sum = (k: string) => raw.filter((x) => x.meat_kind === k).reduce((s, x) => s + x.g, 0);
  const slaughter = sum('slaughter'), poultry = sum('poultry');
  const unknown = raw.filter((x) => !x.meat_kind);
  const meatPct = pct(slaughter + poultry, total);
  // ТР ТС 034 п. 2 (понятия): мясной продукт / полуфабрикат — более 60 %; мясосодержащий — от 5 до 60 % включительно.
  const group = unknown.length || problems.length ? null : meatPct > 60 ? 'мясной' : meatPct >= 5 ? 'мясосодержащий' : null;
  return { raw, total_g: Math.round(total * 10) / 10, slaughter_g: Math.round(slaughter * 10) / 10, poultry_g: Math.round(poultry * 10) / 10,
    meat_pct: meatPct, slaughter_pct: pct(slaughter, total), poultry_pct: pct(poultry, total), unknown, problems, group,
    basis: 'по массе нетто закладки сырья в утверждённой ТТК (полуфабрикаты раскрыты по своим ТТК); ТР ТС 034/2013 п. 4 «е» — «в соответствии с рецептурой»' };
}

/* ───────────── Расчёт декларации ───────────── */

type Err = { field: string; text: string; basis: Ref[] };
const dmy = (s: string | Date | null | undefined) => { if (!s) return ''; const iso = typeof s === 'string' ? s.slice(0, 10) : s.toISOString().slice(0, 10); return iso.split('-').reverse().join('.'); };
const addYears = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10); };
const FORM: Record<string, string> = { 'ООО': 'Общество с ограниченной ответственностью', 'АО': 'Акционерное общество', 'ИП': 'Индивидуальный предприниматель' };

function fullName(org: { name: string; legal_form: string | null }) {
  const f = org.legal_form && FORM[org.legal_form];
  if (!f || org.name.toLowerCase().startsWith(f.toLowerCase())) return org.name;
  const bare = org.name.replace(/^(ООО|АО|ИП)\s+/, '').replace(/^«(.*)»$/, '$1');
  return org.legal_form === 'ИП' ? `${f} ${bare}` : `${f} «${bare}»`;
}

async function loadContext(tx: Tx, orgId: string, declId: string) {
  const d = (await tx.query(`select * from declarations where id = $1 and organization_id = $2`, [declId, orgId])).rows[0];
  if (!d) throw Errors.notFound('Декларация не найдена.');
  const [org, site, dish, ttk, tu, acc, reg, term] = await Promise.all([
    tx.query(`select * from organizations where id = $1`, [orgId]),
    tx.query(`select id, name, address from sites where id = $1`, [d.site_id]),
    tx.query(`select id, name, kind, product_id from dishes where id = $1`, [d.dish_id]),
    tx.query(`select id, version, storage_conditions, shelf_life, approved_at, card_date from ttk_versions where dish_id = $1 and status = 'approved'`, [d.dish_id]),
    tx.query(`select id, version, designation, snapshot->>'title' as title, snapshot->'storage' as storage, approved_at from tech_spec_versions where dish_id = $1 order by version desc limit 1`, [d.dish_id]),
    tx.query(`select a.*, u.full_name as accepted_by_name from declaration_acceptances a join users u on u.id = a.accepted_by where a.declaration_id = $1`, [declId]),
    tx.query(`select r.*, u.full_name as registered_by_name from declaration_registrations r join users u on u.id = r.registered_by where r.declaration_id = $1`, [declId]),
    tx.query(`select * from declaration_terminations where declaration_id = $1`, [declId]),
  ]);
  return { d, org: org.rows[0], site: site.rows[0], dish: dish.rows[0], ttk: ttk.rows[0], tu: tu.rows[0], acceptance: acc.rows[0] || null, registration: reg.rows[0] || null, termination: term.rows[0] || null };
}

/** Применимость: нужна ли декларация, какие регламенты, какие схемы. */
async function regimeOf(tx: Tx, orgId: string, input: DeclDraft, dishId: string) {
  const meat = await meatProfile(tx, dishId);
  const profile = await profileOf(tx, orgId);
  const errors: Err[] = [], notes: string[] = [];
  let decision: 'required' | 'decided_by_applicant' | 'not_required' | 'state_registration' | 'undetermined' = 'undetermined';
  const basis: Ref[] = [];
  if (input.specialized) {
    decision = 'state_registration';
    errors.push({ field: 'regime', text: 'Специализированная пищевая продукция (детское, диетическое, спортивное питание и др.) декларированию не подлежит — оценка в форме государственной регистрации (ТР ТС 021/2011, ст. 21 ч. 1 п. 2; ст. 23 ч. 1 п. 2).', basis: ['trts021:23.1'] });
  } else if (!input.channel) {
    errors.push({ field: 'regime', text: 'Укажите, как реализуется продукция: от этого зависит, нужна ли декларация (ТР ТС 021/2011, ст. 21 ч. 3; ст. 23 ч. 1).', basis: ['trts021:21.3', 'trts021:23.1'] });
  } else if (input.channel === 'services') {
    decision = 'not_required'; basis.push('trts021:21.3');
    errors.push({ field: 'regime', text: 'Продукция предприятия питания, реализуемая при оказании услуг, — оценка соответствия в форме государственного надзора, не декларирования (ТР ТС 021/2011, ст. 21 ч. 3; для мясной продукции — ТР ТС 034/2013, п. 4 «д»). Декларацию на неё не оформляют.', basis: ['trts021:21.3', 'trts034:4'] });
  } else if (input.channel === 'outside') {
    decision = 'required'; basis.push('sanpin4282:7', 'trts021:23.1');
  } else {
    decision = 'decided_by_applicant'; basis.push('trts021:21.3');
    const rpn = clauseById.get('rpn:declaration')!;
    notes.push(`Доставка, вынос и кейтеринг — продукция, реализуемая при оказании услуг (ТР ТС 021/2011, ст. 21 ч. 3: оценка в форме госнадзора). ${regionOk(rpn, profile) ? `Территориальный орган Роспотребнадзора вашего субъекта даёт иное разъяснение (${DOCS.rpn_tula_2026.code}): «${rpn.text.split('.')[0]}». ` : ''}Решение декларировать принимает заявитель; система его не подменяет.`);
    if (regionOk(rpn, profile)) basis.push('rpn:declaration');
  }
  // какой регламент на продукцию
  const regs: (keyof typeof REGS)[] = ['trts021', 'trts022'];
  let schemes: Scheme[] = SCHEMES_021;
  let reg034: boolean | null = null;
  if (meat.problems.length) errors.push({ field: 'regime', text: `Состав по ТТК определить не удалось: ${meat.problems.join(' ')}`, basis: ['trts034:4'] });
  if (meat.unknown.length) errors.push({ field: 'regime', text: `Не указан вид сырья (продукты убоя / мясо птицы / не мясное) — без этого не определить, распространяется ли ТР ТС 034/2013 (п. 4 «в», «е»): ${meat.unknown.map((x) => `«${x.name}»`).join(', ')}.`, basis: ['trts034:4'] });
  if (!meat.unknown.length && !meat.problems.length) {
    const meatTotal = meat.slaughter_g + meat.poultry_g;
    if (meat.meat_pct < 5) { reg034 = false; notes.push(`Мясных ингредиентов по рецептуре ${meat.meat_pct} % (< 5 %) — ТР ТС 034/2013 не применяется (п. 4 «е»).`); }
    else if (meat.poultry_g > meat.slaughter_g) {
      reg034 = false;
      errors.push({ field: 'regime', text: `Мясо птицы (${meat.poultry_pct} %) по массе превышает продукты убоя (${meat.slaughter_pct} %) — ТР ТС 034/2013 не применяется (п. 4 «в»); такая продукция относится к регламенту о мясе птицы (ТР ЕАЭС 051/2021), текста которого в нормативной базе системы нет. Декларацию не готовим, пока документ не загружен и не проверен.`, basis: ['trts034:4'] });
    } else if (meatTotal > 0) {
      reg034 = true; regs.push('trts034'); schemes = SCHEMES_034; basis.push('trts034:132');
      notes.push(`Мясных ингредиентов по рецептуре ${meat.meat_pct} % — ${meat.group} продукт; применяется ТР ТС 034/2013, схемы только 3д, 4д, 6д (п. 134), испытания — в аккредитованной лаборатории (п. 133).`);
    }
  }
  return { decision, basis, regs, schemes, reg034, meat, errors, notes };
}

export async function buildDeclaration(tx: Tx, orgId: string, declId: string) {
  const c = await loadContext(tx, orgId, declId);
  const input = (c.d.input || {}) as DeclDraft;
  const today = (await tx.query(`select (now() at time zone $1)::date::text as d`, [c.org.timezone || 'Europe/Moscow'])).rows[0].d as string;
  const r = await regimeOf(tx, orgId, input, c.d.dish_id);
  const errors: Err[] = [...r.errors], notes = [...r.notes];
  const err = (field: string, text: string, ...basis: Ref[]) => errors.push({ field, text, basis });
  const ip = c.org.legal_form === 'ИП';

  if (!c.ttk) err('5', 'Нет утверждённой ТТК — продукцию не идентифицировать.', 'eec293:5');
  // поле 3 — заявитель
  if (!c.org.legal_form || c.org.legal_form === 'другое') err('3', 'Укажите организационно-правовую форму (ООО, АО, ИП) — полное наименование заявителя.', 'eec293:5');
  if (!c.org.ogrn) err('3', `Не указан ${ip ? 'ОГРНИП' : 'ОГРН'} — регистрационный номер заявителя (поле 3; приказ N 478, п. 7.2).`, 'eec293:5', 'mer478:7');
  if (!c.org.inn) err('3', 'Не указан ИНН (приказ N 478, п. 7.1 «а»).', 'mer478:7');
  if (!c.org.legal_address) err('3', ip ? 'Не указано место жительства индивидуального предпринимателя (поле 3).' : 'Не указано место нахождения (адрес юридического лица) (поле 3).', 'eec293:5');
  if (!c.site?.address) err('3', `Не указан адрес площадки «${c.site?.name}» — адрес места осуществления деятельности по изготовлению.`, 'eec293:5');
  if (!c.org.phone) err('3', 'Не указан номер телефона заявителя (поле 3).', 'eec293:5');
  if (!c.org.email) err('3', 'Не указан адрес электронной почты заявителя (поле 3).', 'eec293:5');
  if (!c.org.activity_notice) err('3', 'Нет сведений об уведомлении о начале предпринимательской деятельности (постановление Правительства РФ N 584) — без него декларация изготовителя не регистрируется (приказ N 478, п. 12).', 'mer478:12');
  // поле 4
  if (!ip && (!c.org.head_position || !c.org.head_name || !c.org.head_basis)) err('4', 'Укажите должность, ФИО руководителя (уполномоченного лица) и документ, на основании которого он принимает декларацию (поле 4).', 'eec293:5');
  // поле 5
  const tnved = (input.tnved || '').replace(/\s/g, '');
  if (!tnved) err('5', 'Не указан код ТН ВЭД ЕАЭС (поле 5). Система код не подбирает — его определяет заявитель по номенклатуре.', 'eec293:5');
  else if (!/^\d{4}(\d{2}){0,3}$/.test(tnved)) err('5', 'Код ТН ВЭД ЕАЭС — 4, 6, 8 или 10 цифр.', 'eec293:5');
  const scheme = input.scheme || null;
  const objectKind = input.object || (scheme ? SCHEMES[scheme].object : 'serial');
  let lot: { id: string; lot_no: string | null; expires_at: string | null; product_id: string } | null = null;
  if (objectKind === 'batch') {
    if (!input.batch) err('5', 'Для партии укажите её размер и единицу измерения (поле 5).', 'eec293:5');
    if (!input.batch?.shippingDoc) err('5', 'Для партии укажите реквизиты товаросопроводительной документации, идентифицирующей партию (поле 5; решение N 44, п. 26 «б»).', 'eec293:5', 'eec44:26');
    if (input.batch?.lotId) {
      lot = (await tx.query(`select id, lot_no, expires_at, product_id from lots where id = $1 and organization_id = $2`, [input.batch.lotId, orgId])).rows[0] || null;
      if (!lot) err('5', 'Партия не найдена.', 'eec293:5');
      else if (lot.product_id !== c.dish.product_id) err('5', 'Выбранная партия — другой продукции.', 'eec293:5');
    }
  }
  // схема
  if (!scheme) err('7', `Выберите схему декларирования: ${r.schemes.join(', ')}.`, r.reg034 ? 'trts034:132' : 'trts021:23.4');
  else {
    if (!r.schemes.includes(scheme)) err('7', `Схема ${scheme} не установлена ${r.reg034 ? 'ТР ТС 034/2013 (п. 134: 3д, 4д, 6д)' : 'ТР ТС 021/2011 (ст. 23 ч. 4: 1д, 2д, 3д)'}.`, r.reg034 ? 'trts034:132' : 'trts021:23.4');
    if (SCHEMES[scheme].object !== objectKind) err('7', `Схема ${scheme} — для ${SCHEMES[scheme].object === 'serial' ? 'серийного выпуска' : 'партии'}; объект декларирования указан иначе.`, 'eec44:28');
  }
  // протоколы
  const protocols = input.protocols || [];
  const files = new Set((await tx.query(`select id from evidence_files where organization_id = $1 and entity_type = 'declaration' and entity_id = $2`, [orgId, declId])).rows.map((x) => x.id));
  if (!protocols.length) err('7', 'Нет протоколов испытаний образцов продукции — доказательственные материалы должны содержать результаты исследований (ТР ТС 021/2011, ст. 23 ч. 7; ТР ТС 034/2013, п. 138 «д»).', 'trts021:23.4', 'trts034:138');
  protocols.forEach((p, i) => {
    const n = `Протокол ${i + 1} (№ ${p.number})`;
    if (p.date > today) err('7', `${n}: дата позже сегодняшней.`, 'eec293:5');
    if (scheme && SCHEMES[scheme].accredited && !p.accreditation) err('7', `${n}: по схеме ${scheme} испытания проводятся в аккредитованной лаборатории — укажите уникальный номер записи об аккредитации (RA.RU.…).`, 'eec293:5', 'mer478:7');
    if (p.accreditation && !/^RA\.RU\.[0-9A-ZА-ЯЁ]{4,}$/i.test(p.accreditation)) err('7', `${n}: номер записи об аккредитации — в виде RA.RU.XXXXXX.`, 'mer478:7');
    if (!p.fileId || !files.has(p.fileId)) err('7', `${n}: прикрепите скан-копию протокола — она передаётся при регистрации (приказ N 478, п. 5, п. 7.4).`, 'mer478:7');
  });
  if (scheme === '6д') {
    const s = input.sms;
    if (!s?.number || !s.date || !s.body || !s.accreditation) err('7', 'Схема 6д: укажите сертификат системы менеджмента — номер, дату, орган по сертификации, номер записи об аккредитации (поле 7; ТР ТС 034, п. 138 «г»).', 'eec293:5', 'trts034:138');
  }
  // поле 8 — хранение, срок годности
  const storage = (c.tu?.storage?.conditions as string) || c.ttk?.storage_conditions || null;
  const shelf = (c.tu?.storage?.shelf_life as string) || c.ttk?.shelf_life || null;
  if (!storage || !shelf) err('8', 'Нет условий хранения или срока годности в утверждённых ТУ / ТТК — сведения поля 8 и обязательные сведения маркировки (ТР ТС 022/2011, ст. 4.1 п. 1).', 'eec293:5', 'trts022:1.2');
  // поле 9 — срок действия
  let validTo = input.validTo || null;
  if (scheme === '4д' && r.reg034) {
    if (lot?.expires_at) {
      const exp = new Date(lot.expires_at).toISOString().slice(0, 10);
      if (validTo && validTo !== exp) err('9', `Схема 4д: срок действия равен сроку годности партии (${dmy(exp)}) — ТР ТС 034/2013, п. 136.`, 'trts034:135');
      validTo = exp;
    } else if (!validTo) err('9', 'Схема 4д: срок действия декларации соответствует сроку годности партии — выберите партию со сроком годности или укажите дату (ТР ТС 034/2013, п. 136).', 'trts034:135');
  }
  if (input.noTerm) {
    if (r.reg034) err('9', 'ТР ТС 034/2013 устанавливает срок действия (п. 135–137) — запись «срок не установлен» недопустима.', 'trts034:135');
    validTo = null;
  } else if (!validTo) err('9', r.reg034 ? 'Укажите дату окончания действия декларации.' : 'Укажите дату окончания действия (срок устанавливает заявитель — ТР ТС 021/2011, ст. 23 ч. 10) или отметьте «срок не установлен».', r.reg034 ? 'trts034:135' : 'trts021:23.10');
  if (validTo && validTo <= today) err('9', 'Дата окончания действия должна быть позже сегодняшней.', 'eec293:5');
  if (validTo && r.reg034 && scheme === '3д' && validTo > addYears(today, 3)) err('9', 'Схема 3д (ТР ТС 034/2013, п. 135): срок действия — не более 3 лет.', 'trts034:135');
  if (validTo && r.reg034 && scheme === '6д' && validTo > addYears(today, 5)) err('9', 'Схема 6д (ТР ТС 034/2013, п. 137): срок действия — не более 5 лет.', 'trts034:135');

  // ── поля формы ──
  const applicant = fullName(c.org);
  const legalAddr = c.org.legal_address || '—';
  const prodAddr = c.site?.address || '—';
  const sameAddr = legalAddr.trim().toLowerCase() === prodAddr.trim().toLowerCase();
  const f3 = `${applicant}. ${ip ? 'Место жительства' : 'Место нахождения (адрес юридического лица)'}: ${legalAddr}${sameAddr ? '' : `. Адрес места осуществления деятельности: ${prodAddr}`}. ${ip ? 'ОГРНИП' : 'ОГРН'}: ${c.org.ogrn || '—'}. Номер телефона: ${c.org.phone || '—'}. Адрес электронной почты: ${c.org.email || '—'}`;
  const f4 = ip ? '' : `${c.org.head_position || '—'} ${c.org.head_name || '—'}, действующего на основании ${c.org.head_basis || '—'}`;
  const meatName = r.reg034 && r.meat.group ? ` (${r.meat.group} ${c.dish.kind === 'semi' || /полуфабрикат/i.test(c.dish.name) ? 'полуфабрикат' : 'продукт'})` : '';
  const doc = c.tu ? `${c.tu.designation} «${c.tu.title || c.dish.name}»` : null;
  if (!c.tu) notes.push('Утверждённых ТУ нет — в поле 5 обозначение документа, по которому изготовлена продукция, не указывается («при наличии»). Для серийного выпуска ТУ — основа технической документации (решение N 44, п. 26 «а»).');
  const objectText = objectKind === 'serial' ? 'Серийный выпуск'
    : `Партия: ${input.batch?.size ?? '—'} ${input.batch?.unit ?? ''}${lot?.lot_no ? `, номер партии ${lot.lot_no}` : ''}. Товаросопроводительная документация: ${input.batch?.shippingDoc || '—'}`;
  const f5 = [`${c.dish.name}${meatName}`, input.productExtra, `Изготовитель: ${applicant}. ${ip ? 'Место жительства' : 'Место нахождения (адрес юридического лица)'}: ${legalAddr}${sameAddr ? '' : `. Адрес места осуществления деятельности по изготовлению продукции: ${prodAddr}`}`,
    doc ? `Продукция изготовлена в соответствии с ${doc}` : null, `Код ТН ВЭД ЕАЭС ${tnved || '—'}`, objectText].filter(Boolean).join('. ') + '.';
  const f6 = r.regs.map((k) => REGS[k]).join(', ');
  const f7 = [...protocols.map((p) => `Протокол испытаний № ${p.number} от ${dmy(p.date)}, выдан ${p.lab}${p.accreditation ? ` (уникальный номер записи об аккредитации ${p.accreditation})` : ''}`),
    scheme === '6д' && input.sms ? `Сертификат соответствия системы менеджмента № ${input.sms.number} от ${dmy(input.sms.date)}, выдан ${input.sms.body} (уникальный номер записи об аккредитации ${input.sms.accreditation})` : null,
    scheme ? `Схема декларирования соответствия: ${scheme}` : null].filter(Boolean).join('; ') + '.';
  const sampleDates = protocols.map((p) => p.sampleMadeOn).filter(Boolean) as string[];
  const f8 = [input.standards ? `Стандарты и иные документы: ${input.standards}` : null,
    storage ? `Условия хранения: ${storage}` : null, shelf ? `Срок годности: ${shelf}` : null,
    objectKind === 'serial' && sampleDates.length ? `Декларация о соответствии распространяется на серийно выпускаемую продукцию, изготовленную с ${dmy(sampleDates.sort()[0])} (дата изготовления образцов, прошедших испытания)` : null,
    input.replaces ? `Декларация о соответствии принята взамен декларации о соответствии ${input.replaces.number} от ${dmy(input.replaces.date)}` : null].filter(Boolean).join('. ') + '.';
  const f9 = input.noTerm ? 'срок не установлен' : validTo ? dmy(validTo) : '—';
  const signer = ip ? (c.org.head_name || c.org.name.replace(/^ИП\s+/, '')) : c.org.head_name || '—';

  // ── комплект (ТР ТС 034 п. 138; решение N 44 п. 26) ──
  const [ppk, haccp] = await Promise.all([
    tx.query(`select version, approved_at from ppk_versions where organization_id = $1 order by version desc limit 1`, [orgId]),
    tx.query(`select version, approved_at from haccp_plans where organization_id = $1 and status = 'approved' order by version desc limit 1`, [orgId]),
  ]);
  const withFile = protocols.filter((p) => p.fileId && files.has(p.fileId)).length;
  const complect = [
    { item: 'Документы о государственной регистрации заявителя (выписка ЕГРЮЛ / ЕГРИП)', status: c.org.ogrn ? 'ok' : 'missing', detail: c.org.ogrn ? `${ip ? 'ОГРНИП' : 'ОГРН'} ${c.org.ogrn}; выписку приложите к комплекту` : 'нет ОГРН', basis: 'ТР ТС 034, п. 138 «а»; решение N 44, п. 26' },
    { item: 'Технические условия или документ, по которому изготовлена продукция', status: c.tu ? 'ok' : 'warning', detail: c.tu ? `${c.tu.designation}, версия ${c.tu.version}, утверждены ${dmy(c.tu.approved_at)}` : 'ТУ не утверждены (при наличии)', basis: 'ТР ТС 034, п. 138 «б»; решение N 44, п. 26 «а»' },
    { item: 'Перечень документов, по которым изготовлена продукция', status: c.ttk ? 'ok' : 'missing', detail: [c.tu ? c.tu.designation : null, c.ttk ? `ТТК «${c.dish.name}», версия ${c.ttk.version}` : null, input.standards].filter(Boolean).join('; ') || '—', basis: 'ТР ТС 034, п. 138 «в»' },
    { item: 'Сертификат системы менеджмента качества и безопасности', status: scheme === '6д' ? (input.sms?.number ? 'ok' : 'missing') : 'n/a', detail: scheme === '6д' ? (input.sms?.number ? `№ ${input.sms.number}` : 'не указан') : 'только для схемы 6д', basis: 'ТР ТС 034, п. 138 «г»' },
    { item: 'Протоколы испытаний продукции', status: protocols.length && withFile === protocols.length ? 'ok' : 'missing', detail: `протоколов: ${protocols.length}, со скан-копией: ${withFile}`, basis: 'ТР ТС 021, ст. 23 ч. 7; ТР ТС 034, п. 138 «д»' },
    { item: 'Протоколы испытаний сырья (продуктов убоя, немясных ингредиентов)', status: 'n/a', detail: 'при наличии — приложите файлами к декларации', basis: 'ТР ТС 034, п. 138 «е»' },
    { item: 'Договор поставки / товаросопроводительные документы на партию', status: objectKind === 'batch' ? (input.batch?.shippingDoc ? 'ok' : 'missing') : 'n/a', detail: objectKind === 'batch' ? input.batch?.shippingDoc || 'не указаны' : 'только для партии', basis: 'ТР ТС 034, п. 138 «ж»; решение N 44, п. 26 «б»' },
    { item: 'Другие документы: ППК, план ХАССП', status: ppk.rows[0] && haccp.rows[0] ? 'ok' : 'warning', detail: [ppk.rows[0] ? `ППК, версия ${ppk.rows[0].version}` : 'ППК не утверждена', haccp.rows[0] ? `план ХАССП, версия ${haccp.rows[0].version}` : 'план ХАССП не утверждён'].join('; '), basis: 'ТР ТС 034, п. 138 «з»' },
  ];
  if (r.reg034) notes.push('Комплект документов хранить не менее 5 лет: для серийного выпуска — со дня прекращения производства, для партии — со дня реализации партии (ТР ТС 034/2013, п. 142).');

  // ── сведения для заявления о регистрации (приказ N 478, п. 7.1) ──
  const application = [
    { label: 'Заявитель (п. 7.1 «а»)', value: `${applicant}; ${ip ? 'место жительства' : 'место нахождения'}: ${legalAddr}; адрес деятельности: ${prodAddr}; ${ip ? '' : `руководитель: ${c.org.head_position || '—'} ${c.org.head_name || '—'}; `}ИНН ${c.org.inn || '—'}; тел. ${c.org.phone || '—'}; e-mail ${c.org.email || '—'}` },
    { label: 'Изготовитель (п. 7.1 «б»)', value: `${applicant}; адрес места изготовления: ${prodAddr}` },
    { label: 'Объект декларирования (п. 7.1 «в»)', value: `${c.dish.name}${meatName}; ${doc ? `документ: ${doc}; ` : ''}${objectText}` },
    { label: 'Код ТН ВЭД ЕАЭС и (или) ОКПД 2 (п. 7.1 «г»)', value: tnved || '—' },
    { label: 'Технические регламенты (п. 7.1 «д»)', value: f6 },
    { label: 'Схема декларирования (п. 7.1 «е»)', value: scheme || '—' },
    { label: 'Дополнительная информация (п. 7.1 «з»)', value: f8 },
    { label: 'Сведения о госрегистрации (п. 7.2)', value: `${ip ? 'ОГРНИП' : 'ОГРН'} ${c.org.ogrn || '—'}` },
    { label: 'Документы, подтверждающие соответствие (п. 7.4) — скан-копии', value: f7 },
  ];

  const fields = {
    f1: 'ЕВРАЗИЙСКИЙ ЭКОНОМИЧЕСКИЙ СОЮЗ\nДЕКЛАРАЦИЯ О СООТВЕТСТВИИ', f2: 'ЕАС', f3, f4, f5, f6, f7, f8, f9, f10: signer,
    f11: c.registration?.reg_number || null, f12: c.registration ? dmy(c.registration.reg_date) : null, f13: 'формируется в национальной части единого реестра (ФГИС Росаккредитации)',
  };
  return { ctx: c, input, today, regime: { decision: r.decision, basis: r.basis, regulations: r.regs.map((k) => REGS[k]), schemes: r.schemes, reg034: r.reg034, meat: r.meat },
    fields, valid_to: validTo, scheme, object: objectKind, errors, notes, complect, application };
}

/* ───────────── Статус ───────────── */

export function declStatus(c: { acceptance: unknown; registration: { reg_date: string; valid_to: string | null } | null; termination: unknown }, today: string) {
  if (c.termination) return 'terminated';
  if (c.registration) {
    const vt = c.registration.valid_to ? new Date(c.registration.valid_to).toISOString().slice(0, 10) : null;
    return vt && vt < today ? 'expired' : 'registered';
  }
  return c.acceptance ? 'accepted' : 'draft';
}
export const DECL_STATUS: Record<string, string> = { draft: 'проект', accepted: 'принята заявителем, не зарегистрирована', registered: 'зарегистрирована, действует', expired: 'срок действия истёк', terminated: 'действие прекращено' };

/** Действующая зарегистрированная декларация на продукцию (для знака ЕАС на этикетке). Партия по схеме 2д/4д — только на свою партию. */
export async function activeDeclarationFor(tx: Tx, orgId: string, dishId: string, lotId?: string | null) {
  const rows = (await tx.query(`select d.id, d.input, r.reg_number, r.reg_date::text, r.valid_to::text, a.snapshot->>'object' as object
    from declarations d join declaration_registrations r on r.declaration_id = d.id join declaration_acceptances a on a.declaration_id = d.id
    where d.organization_id = $1 and d.dish_id = $2 and r.reg_date <= current_date and (r.valid_to is null or r.valid_to >= current_date)
      and not exists (select 1 from declaration_terminations t where t.declaration_id = d.id and t.terminated_on <= current_date)
    order by r.reg_date desc`, [orgId, dishId])).rows;
  return rows.find((x) => x.object !== 'batch' || (lotId && x.input?.batch?.lotId === lotId)) || null;
}

/* ───────────── API ───────────── */

export async function listDeclarations(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'decl.read', async (tx, m) => {
    const rows = (await tx.query(`select d.id, d.number, d.site_id, d.dish_id, x.name as dish, d.input->>'scheme' as scheme, d.created_at, d.updated_at,
        (select row_to_json(a) from (select accepted_at from declaration_acceptances where declaration_id = d.id) a) as acceptance,
        (select row_to_json(r) from (select reg_number, reg_date::text, valid_to::text from declaration_registrations where declaration_id = d.id) r) as registration,
        (select row_to_json(t) from (select terminated_on::text, reason from declaration_terminations where declaration_id = d.id) t) as termination,
        (now() at time zone o.timezone)::date::text as today
      from declarations d join dishes x on x.id = d.dish_id join organizations o on o.id = d.organization_id where d.organization_id = $1 order by d.number desc`, [orgId])).rows
      .filter((r) => !m.site_ids.length || m.site_ids.includes(r.site_id));
    return rows.map((r) => ({ ...r, status: declStatus(r, r.today), status_label: DECL_STATUS[declStatus(r, r.today)] }));
  });
}

export async function createDeclaration(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ dishId: z.uuid(), siteId: z.uuid() }), input);
  return inOrg(userId, orgId, 'decl.manage', async (tx, m) => {
    await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId);
    const dish = (await tx.query(`select id, name from dishes where id = $1 and organization_id = $2`, [d.dishId, orgId])).rows[0];
    if (!dish) throw Errors.notFound('Продукция не найдена.');
    if (!(await tx.query(`select 1 from ttk_versions where dish_id = $1 and status = 'approved'`, [d.dishId])).rowCount) throw Errors.conflict(`У «${dish.name}» нет утверждённой ТТК — декларировать нечего.`);
    await tx.query(`select pg_advisory_xact_lock(hashtext('decl:' || $1))`, [orgId]);
    const n = Number((await tx.query(`select coalesce(max(number), 0) + 1 as n from declarations where organization_id = $1`, [orgId])).rows[0].n);
    const row = (await tx.query(`insert into declarations (organization_id, site_id, number, dish_id, input, created_by) values ($1, $2, $3, $4, $5, $6) returning id, number`,
      [orgId, d.siteId, n, d.dishId, JSON.stringify({ object: 'serial' }), userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'decl.create', entityType: 'declaration', entityId: row.id, after: { dish: dish.name, number: n } });
    return row as { id: string; number: number };
  });
}

function view(b: Awaited<ReturnType<typeof buildDeclaration>>) {
  const c = b.ctx;
  const status = declStatus(c, b.today);
  return { id: c.d.id, number: c.d.number, site_id: c.d.site_id, dish: { id: c.dish.id, name: c.dish.name }, status, status_label: DECL_STATUS[status],
    input: b.input, regime: b.regime, fields: b.fields, valid_to: b.valid_to, scheme: b.scheme, object: b.object, errors: b.errors, notes: b.notes, complect: b.complect, application: b.application,
    acceptance: c.acceptance ? { accepted_at: c.acceptance.accepted_at, accepted_by: c.acceptance.accepted_by_name, content_hash: c.acceptance.content_hash } : null,
    registration: c.registration ? { reg_number: c.registration.reg_number, reg_date: c.registration.reg_date, valid_to: c.registration.valid_to, registered_by: c.registration.registered_by_name } : null,
    termination: c.termination ? { terminated_on: c.termination.terminated_on, reason: c.termination.reason } : null,
    schemes: SCHEMES, channels: CHANNELS, meat_kinds: MEAT_KINDS, today: b.today };
}

export async function getDeclaration(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'decl.read', async (tx, m) => {
    const b = await buildDeclaration(tx, orgId, parse(z.uuid(), id));
    assertSiteAccess(m, b.ctx.d.site_id);
    const v = view(b);
    if (b.ctx.acceptance) {
      // принятая декларация показывается по снимку (а не пересчитывается), с проверкой целостности
      const integrity = await assertSnapshotIntact(tx, 'declaration_acceptances', b.ctx.acceptance.id, { orgId, userId });
      const s = b.ctx.acceptance.snapshot;
      return { ...v, fields: { ...s.fields, f11: v.fields.f11, f12: v.fields.f12 }, regime: s.regime, complect: s.complect, application: s.application, valid_to: s.valid_to, scheme: s.scheme, object: s.object, errors: [], notes: s.notes, integrity };
    }
    return { ...v, integrity: null as null | { content_hash: string; generator_version: string } };
  });
}

export async function updateDeclaration(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(DeclInput, input);
  return inOrg(userId, orgId, 'decl.manage', async (tx, m) => {
    const row = (await tx.query(`select site_id, input from declarations where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), id), orgId])).rows[0];
    if (!row) throw Errors.notFound('Декларация не найдена.');
    assertSiteAccess(m, row.site_id);
    if ((await tx.query(`select 1 from declaration_acceptances where declaration_id = $1`, [id])).rowCount) throw Errors.conflict('Декларация принята заявителем — текст не изменяется (решение ЕЭК N 293, разд. II п. 7). Оформите новую декларацию.');
    const next = { ...row.input };
    for (const [k, v] of Object.entries(d)) if (v !== undefined) next[k] = v;
    await tx.query(`update declarations set input = $2, updated_by = $3, updated_at = now() where id = $1`, [id, JSON.stringify(next), userId]);
    await audit.record(tx, { organizationId: orgId, siteId: row.site_id, actorUserId: userId, action: 'decl.update', entityType: 'declaration', entityId: id, before: row.input, after: next });
    return view(await buildDeclaration(tx, orgId, id));
  });
}

/** Вид сырья (ТР ТС 034 п. 4): подтверждает человек; запись в журнале аудита. */
export async function setMeatKind(userId: string, orgId: string, productId: string, input: unknown) {
  const d = parse(z.object({ meatKind: z.enum(['slaughter', 'poultry', 'none']) }), input);
  return inOrg(userId, orgId, 'decl.manage', async (tx) => {
    const p = (await tx.query(`select id, name, meat_kind from products where id = $1 and organization_id = $2 for update`, [parse(z.uuid(), productId), orgId])).rows[0];
    if (!p) throw Errors.notFound('Товар не найден.');
    await tx.query(`update products set meat_kind = $2 where id = $1`, [p.id, d.meatKind]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'product.meat_kind', entityType: 'product', entityId: p.id, before: { meat_kind: p.meat_kind }, after: { meat_kind: d.meatKind } });
    return { id: p.id, meat_kind: d.meatKind };
  });
}

/** Принятие декларации заявителем (поле 10). Только без замечаний; текст фиксируется снимком. */
export async function acceptDeclaration(userId: string, orgId: string, id: string) {
  return inOrg(userId, orgId, 'decl.accept', async (tx, m) => {
    const b = await buildDeclaration(tx, orgId, parse(z.uuid(), id));
    assertSiteAccess(m, b.ctx.d.site_id);
    if (b.ctx.acceptance) throw Errors.conflict('Декларация уже принята.');
    if (b.errors.length) throw Errors.conflict(`Принять нельзя — ${b.errors.length} замечаний: ${b.errors.map((e) => `[поле ${e.field}] ${e.text}`).join(' ')}`);
    const snapshot = { fields: b.fields, regime: b.regime, complect: b.complect, application: b.application, valid_to: b.valid_to, scheme: b.scheme, object: b.object, notes: b.notes, input: b.input, accepted_on: b.today };
    const a = (await tx.query(`insert into declaration_acceptances (organization_id, declaration_id, snapshot, accepted_by) values ($1, $2, $3, $4) returning id, accepted_at, content_hash`,
      [orgId, id, JSON.stringify(snapshot), userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: b.ctx.d.site_id, actorUserId: userId, action: 'decl.accept', entityType: 'declaration', entityId: id, after: { content_hash: a.content_hash, scheme: b.scheme, valid_to: b.valid_to } });
    return a as { id: string; accepted_at: string; content_hash: string };
  });
}

/** Сведения о регистрации из ФГИС Росаккредитации (поля 11–12). Вносятся один раз. */
export async function registerDeclaration(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ regNumber: z.string().trim().min(1, 'Укажите регистрационный номер.').max(80), regDate: isoDate }), input);
  return inOrg(userId, orgId, 'decl.accept', async (tx, m) => {
    const c = await loadContext(tx, orgId, parse(z.uuid(), id));
    assertSiteAccess(m, c.d.site_id);
    if (!c.acceptance) throw Errors.conflict('Сначала декларацию принимает заявитель — затем она регистрируется.');
    if (c.registration) throw Errors.conflict('Сведения о регистрации уже внесены и не изменяются.');
    await assertSnapshotIntact(tx, 'declaration_acceptances', c.acceptance.id, { orgId, userId });
    const num = d.regNumber.replace(/\s+/g, ' ').replace(/№/g, 'N');
    // решение N 293, разд. II п. 5 «л»: номер с аббревиатурой «ЕАЭС» и двухбуквенным кодом государства
    if (!/^ЕАЭС N [A-Z]{2} Д-[A-ZА-Я]{2}\.\S+$/.test(num)) throw Errors.validation('Регистрационный номер — как в реестре: «ЕАЭС N RU Д-RU.…» (решение ЕЭК N 293, разд. II п. 5 «л»).');
    const today = (await tx.query(`select (now() at time zone $1)::date::text as d`, [c.org.timezone || 'Europe/Moscow'])).rows[0].d as string;
    const accDay = new Date(c.acceptance.accepted_at).toISOString().slice(0, 10);
    if (d.regDate > today) throw Errors.validation('Дата регистрации не может быть позже сегодняшней.');
    if (d.regDate < accDay) throw Errors.validation('Дата регистрации раньше даты принятия декларации.');
    const s = c.acceptance.snapshot;
    const vt: string | null = s.valid_to || null;
    if (vt && vt <= d.regDate) throw Errors.validation('Срок действия декларации истекает до даты регистрации.');
    if (vt && s.regime?.reg034 && s.scheme === '3д' && vt > addYears(d.regDate, 3)) throw Errors.conflict('Схема 3д: срок действия больше 3 лет от даты регистрации (ТР ТС 034/2013, п. 135).');
    if (vt && s.regime?.reg034 && s.scheme === '6д' && vt > addYears(d.regDate, 5)) throw Errors.conflict('Схема 6д: срок действия больше 5 лет от даты регистрации (ТР ТС 034/2013, п. 137).');
    const r = (await tx.query(`insert into declaration_registrations (organization_id, declaration_id, reg_number, reg_date, valid_to, registered_by) values ($1, $2, $3, $4, $5, $6)
      on conflict (organization_id, reg_number) do nothing returning id`, [orgId, id, num, d.regDate, vt, userId])).rows[0];
    if (!r) throw Errors.conflict('Такой регистрационный номер уже внесён по другой декларации.');
    await audit.record(tx, { organizationId: orgId, siteId: c.d.site_id, actorUserId: userId, action: 'decl.register', entityType: 'declaration', entityId: id, after: { reg_number: num, reg_date: d.regDate, valid_to: vt } });
    return { id: r.id, reg_number: num, reg_date: d.regDate, valid_to: vt };
  });
}

export async function terminateDeclaration(userId: string, orgId: string, id: string, input: unknown) {
  const d = parse(z.object({ on: isoDate, reason: z.string().trim().min(5, 'Укажите причину прекращения.').max(500) }), input);
  return inOrg(userId, orgId, 'decl.accept', async (tx, m) => {
    const c = await loadContext(tx, orgId, parse(z.uuid(), id));
    assertSiteAccess(m, c.d.site_id);
    if (!c.acceptance) throw Errors.conflict('Проект не принят — его можно просто не использовать.');
    if (c.termination) throw Errors.conflict('Действие уже прекращено.');
    await tx.query(`insert into declaration_terminations (organization_id, declaration_id, terminated_on, reason, terminated_by) values ($1, $2, $3, $4, $5)`, [orgId, id, d.on, d.reason, userId]);
    await audit.record(tx, { organizationId: orgId, siteId: c.d.site_id, actorUserId: userId, action: 'decl.terminate', entityType: 'declaration', entityId: id, after: d });
    return { ok: true };
  });
}

/** Продукция для новой декларации: блюда с утверждённой ТТК. */
export async function declarableProducts(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'decl.read', async (tx) => (await tx.query(`select d.id, d.name from dishes d where d.organization_id = $1 and d.status = 'active'
    and exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved') order by d.name`, [orgId])).rows);
}
