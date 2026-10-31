import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { withSystem } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { ROLES } from '../access/roles';
import { CLAUSES, DOCS, applies, clauseById, samplesRequired, type NormProfile } from '../norms/library';
import { KIND_LABEL, requiredContractsState, stateOf } from './contracts';
import { OBJECT_TYPES } from './regulatory';
import { inOrg, parse, optText } from './common';
import { validateEnterpriseReadiness, isBad, registerNormRefs } from '../readiness/engine';

/**
 * Программа производственного контроля, собранная системой. Пользователь не выбирает СанПиН: применимость пунктов
 * определяется профилем предприятия (norms/library.ts), содержание — данными системы (план ХАССП, объекты контроля,
 * лабораторная программа, план санитарии, договоры, персонал, оборудование).
 *  - Каждая строка — со ссылками на пункты библиотеки (`basis`); в печатной форме — «документ, пункт» и приложение
 *    с дословным текстом каждого процитированного пункта.
 *  - Нет данных для обязательной строки — «пробел» (`gap`) с тем, что внести и где. Пока есть пробелы, программу
 *    утвердить нельзя: выдать недостоверную ППК система не может.
 *  - Утверждённая версия — снимок с отпечатком данных. Данные изменились (новый план ХАССП, исследование, договор) —
 *    отпечаток не совпадает, и система требует пересмотра (разъяснение Роспотребнадзора, п. 1; ГОСТ — не применяется).
 */

export interface PpkLine { text: string; basis: string[]; gap?: string | null; href?: string | null }
export interface PpkTable { head: string[]; rows: string[][] }
export interface PpkSection { no: number; title: string; lines: PpkLine[]; table?: PpkTable | null }
export interface PpkDoc {
  org: { name: string; legal_form: string | null; inn: string | null; region: string | null };
  sites: { name: string; address: string | null }[];
  profile: NormProfile; profile_text: string;
  params: PpkParams;
  responsible: { name: string; position: string | null } | null;
  sections: PpkSection[];
  docs: { code: string; title: string; issued: string; effective_to: string | null }[];
  basis: { id: string; doc: string; clause: string; text: string }[];
  gaps: { section: string; text: string; href: string | null }[];
  unknown_refs?: string[];
}

const Params = z.object({
  responsibleUserId: z.uuid('Выберите ответственного из сотрудников.').nullable().optional(),
  approverTitle: optText(200),
  city: optText(100),
  orderNo: optText(50),
});
export type PpkParams = { responsibleUserId?: string | null; approverTitle?: string | null; city?: string | null; orderNo?: string | null };

const MGMT_ROLES = ['owner', 'director', 'chef', 'technologist', 'haccp_lead'];
const ddmm = (s: string | null) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '');
const period = (d: number) => (d === 1 ? 'ежедневно' : d === 7 ? 'еженедельно' : d === 30 || d === 31 ? 'ежемесячно' : d === 90 ? 'ежеквартально' : d === 180 ? 'раз в полгода' : d === 365 || d === 366 ? 'раз в год' : `раз в ${d} дн.`);
const roleName = (r: string | null) => (r ? (ROLES as Record<string, { label: string }>)[r]?.label || r : '—');

/** Журналы программы и пункты, которые требуют их вести. Журнал без основания в библиотеке в ППК не попадает. */
const JOURNALS: { code: string; basis: string[]; when?: (p: NormProfile) => boolean }[] = [
  { code: 'J39', basis: ['sanpin4282:5', 'trts021:11.4'] },
  { code: 'J42', basis: ['sanpin4282:35', 'sanpin4282:40'] },
  { code: 'J43', basis: ['sanpin4282:35'] },
  { code: 'J05', basis: ['sanpin4282:6', 'trts021:18'] },
  { code: 'J07', basis: ['sanpin4282:25', 'trts021:11.6'] },
  { code: 'J45', basis: ['sanpin4282:24'] },
  { code: 'J10', basis: ['sanpin4282:21'] },
  { code: 'J15', basis: ['sanpin4282:47'] },
  { code: 'J14', basis: ['sanpin4282:26', 'sanpin4282:45'] },
  { code: 'J38', basis: ['sanpin4282:44'], when: (p) => p.features.includes('fryer') },
  { code: 'J41', basis: ['sanpin4282:44'], when: (p) => p.features.includes('fryer') },
  { code: 'J19', basis: ['trts021:15.2'] },
  { code: 'J34', basis: ['trts021:11.3'] },
];

async function loadParams(tx: Tx, orgId: string): Promise<PpkParams> {
  return ((await tx.query(`select params from ppk_settings where organization_id = $1`, [orgId])).rows[0]?.params || {}) as PpkParams;
}

/** Сборка программы по текущим данным. Детерминирована: одинаковые данные — одинаковый отпечаток. */
export async function buildPpk(tx: Tx, orgId: string): Promise<PpkDoc> {
  const q = async (sql: string, a: unknown[] = [orgId]) => (await tx.query(sql, a)).rows;
  const org = (await q(`select name, legal_form, inn, region, timezone from organizations where id = $1`))[0];
  await tx.query(`select set_config('timezone', $1, true)`, [org.timezone || 'Europe/Moscow']);   // даты — по часовому поясу предприятия, отпечаток не зависит от сессии
  const sites = await q(`select id, name, address from sites where organization_id = $1 and status = 'active' order by created_at`);
  const siteIds = sites.map((s) => s.id);
  const pr = (await q(`select * from org_regulatory_profiles where organization_id = $1`))[0];
  const profile: NormProfile = { objectTypes: pr?.object_types || [], salesModes: pr?.sales_modes || [], seats: pr?.seats ?? null, features: pr?.features || [] };
  const params = await loadParams(tx, orgId);
  const base = `/app/${orgId}`;
  const on = (id: string) => { const c = clauseById.get(id); return !!c && applies(c, profile); };
  // ссылки на пункты: неизвестный id не отбрасывается молча — техническое несоответствие, утверждение блокируется
  const unknownRefs = new Set<string>();
  const B = (...ids: string[]) => { for (const id of ids) if (!clauseById.has(id)) unknownRefs.add(id); return ids.filter(on); };
  // проверки — единым движком готовности (ППК сам себя не проверяет)
  const ready = await validateEnterpriseReadiness(tx, orgId, null, { siteIds, exclude: ['ppk_update'] });
  const R = new Map(ready.items.map((i) => [i.key, i]));
  const ok = (...keys: string[]) => keys.every((k) => !isBad(R.get(k)!.status));
  const gapOf = (keys: string[], basis: string[] = []): PpkLine => {
    const bad = keys.map((k) => R.get(k)!).filter((i) => isBad(i.status));
    return { text: bad[0].title, basis, gap: bad.map((i) => `${i.detail}${i.items?.length ? ` ${i.items.join('; ')}.` : ''}`).join(' '), href: bad[0].href || null };
  };
  const sections: PpkSection[] = [];
  const sec = (title: string, lines: PpkLine[], table?: PpkTable | null) => sections.push({ no: sections.length + 1, title, lines: lines.filter((l) => l.basis.length || l.gap), table: table || null });

  // 1. Общие положения
  const plan = (await q(`select id, version, approved_at::date::text as d from haccp_plans where organization_id = $1 and status = 'approved' order by version desc limit 1`))[0];
  const SALES: Record<string, string> = { hall: 'обслуживание в зале', takeaway: 'навынос', delivery: 'доставка', catering: 'кейтеринг' };
  const profileText = [
    profile.objectTypes.map((t) => OBJECT_TYPES[t] || t).join(', ') || 'тип предприятия не указан',
    profile.salesModes.length ? `реализация: ${profile.salesModes.map((m) => SALES[m] || m).join(', ')}` : '',
    profile.seats !== null ? `посадочных мест: ${profile.seats}` : '',
  ].filter(Boolean).join('; ');
  sec('Общие положения', [
    { text: 'Программа устанавливает порядок и периодичность производственного контроля предприятия общественного питания, включая организационные мероприятия, лабораторные исследования и испытания.', basis: B('sanpin4282:4') },
    ok('haccp_plan') && plan ? { text: `Производственный контроль основан на принципах ХАССП: опасные факторы, критические контрольные точки, их предельные значения, мониторинг и действия при отклонениях установлены планом ХАССП (версия ${plan.version}, утверждён ${ddmm(plan.d)}).`, basis: B('trts021:10.3', 'sanpin4282:4') }
      : gapOf(['haccp_plan'], B('trts021:10.3')),
    { text: 'Программа включает производственный контроль за условиями труда: перечень должностных лиц, факторы и объекты лабораторного контроля, места отбора проб и периодичность исследований.', basis: B('sp4285:4') },
    profile.objectTypes.length ? { text: `Профиль предприятия: ${profileText}.`, basis: B('sanpin4282:4') }
      : { text: 'Профиль предприятия.', basis: [], gap: 'Не указан тип предприятия — система не может определить применимые требования.', href: `${base}/compliance` },
    ...sites.map((s) => s.address ? { text: `Объект контроля: ${s.name}, ${s.address}.`, basis: B('sanpin4282:4') }
      : { text: `Объект контроля: ${s.name}.`, basis: [], gap: `Не указан адрес площадки «${s.name}».`, href: `${base}/setup` }),
    { text: 'Программа пересматривается при изменении нормативных документов, ассортимента, технологии, плана ХАССП, программы лабораторных исследований или договоров. Система сверяет данные с утверждённой версией и сообщает о необходимости пересмотра.', basis: B('rpn:ppk_update') },
  ]);

  // 2. Должностные лица
  const staff = await q(`select u.id, u.full_name, m.position, m.role from memberships m join users u on u.id = m.user_id where m.organization_id = $1 and m.status = 'active' order by u.full_name`);
  const resp = params.responsibleUserId ? staff.find((s) => s.id === params.responsibleUserId) : null;
  const mgmt = staff.filter((s) => MGMT_ROLES.includes(s.role));
  sec('Должностные лица, ответственные за производственный контроль', [
    resp ? { text: `Ответственный за организацию и проведение производственного контроля: ${resp.full_name}${resp.position ? `, ${resp.position}` : ''}.`, basis: B('sp4285:4') }
      : { text: 'Ответственный за организацию и проведение производственного контроля.', basis: [], gap: 'Не назначен ответственный за производственный контроль.', href: `${base}/compliance/ppk` },
    { text: 'Мероприятия контроля выполняют должностные лица по таблице; ответственность каждого — по разделам программы.', basis: B('sp4285:4') },
  ], { head: ['ФИО', 'Должность', 'Роль в системе'], rows: mgmt.map((s) => [s.full_name, s.position || '—', roleName(s.role)]) });

  // 3. Критические контрольные точки
  const ccp = plan ? await q(`select st.position, st.name as step, h.code, h.description, m.what, m.critical_limit, m.method, m.frequency, m.responsible_role, m.record_form, m.corrective_action
      from haccp_hazards h join haccp_steps st on st.id = h.step_id left join haccp_monitoring m on m.hazard_id = h.id
      where h.plan_id = $1 and h.class in ('ccp', 'oprp') order by st.position, h.code`, [plan.id]) : [];
  sec('Критические контрольные точки и действия при отклонениях', [
    ok('haccp_ccp') ? { text: 'Контроль в критических контрольных точках — по таблице: параметр, предельное значение, способ и периодичность мониторинга, ответственный, форма записи и действия при отклонении.', basis: B('trts021:11.3') }
      : gapOf(['haccp_ccp'], B('trts021:11.3')),
    { text: 'Продукция, не соответствующая требованиям, а также продукция с истёкшим сроком годности изымается из оборота и утилизируется; факт фиксируется в журнале корректирующих действий.', basis: B('trts021:18', 'sanpin4282:6') },
  ], ccp.length ? { head: ['Этап', 'Опасность', 'Предел', 'Мониторинг', 'Ответственный', 'Запись', 'При отклонении'],
    rows: ccp.map((c) => [`${c.position}. ${c.step}`, `${c.code}: ${c.description}`, c.critical_limit || '—', [c.what, c.method, c.frequency].filter(Boolean).join('; ') || '—', roleName(c.responsible_role), c.record_form || '—', c.corrective_action || '—']) } : null);

  // 4. Контроль сырья и продукции
  const ttk = Number((await q(`select count(distinct d.id) from dishes d join ttk_versions v on v.dish_id = d.id and v.status = 'approved' where d.organization_id = $1 and d.status = 'active'`))[0].count);
  const samples = samplesRequired(profile);
  sec('Контроль сырья, полуфабрикатов и готовой продукции', [
    { text: 'Приёмка сырья и пищевой продукции — только при наличии маркировки и документов, подтверждающих безопасность и качество; входной контроль регистрируется при каждой приёмке.', basis: B('sanpin4282:5') },
    { text: 'Документы, подтверждающие безопасность сырья животного происхождения, хранятся не менее 3 лет.', basis: B('trts021:11.4') },
    { text: 'Ежедневный контроль сроков годности и условий хранения; продукция с истёкшим сроком годности утилизируется.', basis: B('sanpin4282:6', 'trts021:17.7') },
    ok('tech_docs') ? { text: `Продукция изготавливается по утверждённым технологическим документам: ${ttk} ТТК.`, basis: B('sanpin4282:11', 'gost31987:4') }
      : gapOf(['tech_docs'], B('sanpin4282:11')),
    { text: 'Готовые блюда находятся на раздаче не более 3 часов; не реализуются на следующий день и не замораживаются.', basis: B('sanpin4282:32') },
    { text: 'Потребитель информируется о наличии аллергенов в продукции.', basis: B('sanpin4282:43') },
    ...(on('sanpin4282:44') ? [{ text: 'Фритюрные жиры контролируются ежедневно перед началом и в процессе жарки; замена и утилизация — с записью в журнал, учёт хранится 3 месяца.', basis: B('sanpin4282:44') }] : []),
    ...(on('sanpin4282:7') ? [{ text: 'Продукция, реализуемая вне предприятия, сопровождается декларацией о соответствии или свидетельством о государственной регистрации; упакованная продукция маркируется.', basis: B('sanpin4282:7', 'rpn:declaration', 'trts022:1.2') }] : []),
    ...(on('sanpin4282:52') ? [{ text: 'Кейтеринг: комплектование не ранее чем за 3 часа до доставки, изотермические ёмкости с ярлыком, горячие блюда реализуются не более 3 часов; обеспечивается прослеживаемость.', basis: B('sanpin4282:52', 'sanpin4282:54', 'sanpin4282:55') }] : []),
    ...(samples ? [ok('daily_samples') ? { text: 'Суточная проба отбирается от каждой партии готовых блюд и хранится по утверждённым параметрам.', basis: B('sanpin4282:56.4', 'sanpin4282:59.10') }
      : gapOf(['daily_samples'], B('sanpin4282:56.4', 'sanpin4282:59.10'))] : []),
  ]);

  // 5. Условия хранения
  const objs = await q(`select o.name, o.kind, s.name as site, (select count(*) from control_rules r where r.control_object_id = o.id and r.status = 'approved')::int as rules
    from control_objects o join sites s on s.id = o.site_id where o.organization_id = $1 and o.status = 'active' order by s.name, o.name`);
  const KIND: Record<string, string> = { fridge: 'холодильник', freezer: 'морозильник', room: 'склад / помещение', storage: 'склад', hot: 'тепловое оборудование' };
  sec('Контроль условий хранения', [
    ok('storage_objects') ? { text: 'Ежедневная регистрация температуры в холодильном оборудовании и складских помещениях, влажности — в складских помещениях; объекты — по таблице.', basis: B('sanpin4282:35') }
      : gapOf(['storage_objects'], B('sanpin4282:35')),
    { text: 'Холодильное оборудование оснащается термометрами, складские помещения — гигрометрами; ртутные термометры не используются.', basis: B('sanpin4282:40', 'sanpin4282:48') },
  ], objs.length ? { head: ['Площадка', 'Объект', 'Вид', 'Периодичность'], rows: objs.map((o) => [o.site, o.name, KIND[o.kind] || o.kind, 'ежедневно']) } : null);

  // Договоры: в тексте — только контрагент (состояние «истекает» не меняет программу)
  const all = await q(`select c.kind, c.counterparty, c.number, c.signed_on::text as signed_on, c.valid_to::text as valid_to, c.status, c.valid_from::text as valid_from,
      (select count(*)::int from evidence_files f where f.organization_id = c.organization_id and f.entity_type = 'contract' and f.entity_id = c.id) as files
    from contracts c where c.organization_id = $1 and c.status = 'active' order by c.kind, c.signed_on`);
  const today = (await q(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`))[0].d;
  const contracts = await requiredContractsState(tx, orgId, siteIds);
  const ctr = (k: string) => contracts.find((c) => c.kind === k)!;
  const okCtr = (k: string) => all.find((c) => c.kind === k && c.files > 0 && ['ok', 'expiring'].includes(stateOf(c, today).state));

  // 6. Лабораторный контроль
  const lab = await q(`select l.test_type, l.target, l.period_days, l.basis, l.responsible_role, s.name as site from lab_programs l join sites s on s.id = l.site_id
    where l.organization_id = $1 and l.status = 'active' order by s.name, l.test_type, l.target`);
  sec('Лабораторные исследования и измерения', [
    ok('lab_program') ? { text: 'Лабораторные исследования проводятся по таблице: показатель, объект (место отбора проб), периодичность.', basis: B('sp4285:4', 'sp4284:3', 'sanpin4282:4') }
      : gapOf(['lab_program'], B('sanpin4282:4')),
    ok('water_lab') ? { text: 'Качество питьевой воды (в том числе горячей) подтверждается лабораторными исследованиями по гигиеническим нормативам.', basis: B('sanpin4282:13', 'trts021:12', 'sanpin3685:t3.5') }
      : gapOf(['water_lab'], B('sanpin4282:13')),
    ok('microclimate_lab') ? { text: 'Параметры микроклимата рабочих мест контролируются не реже 1 раза в год по допустимым величинам для категории работ.', basis: B('sp4285:15', 'sanpin3685:t5.2') }
      : gapOf(['microclimate_lab'], B('sp4285:15')),
    ok('contract_lab') ? { text: `Исследования выполняет аккредитованная лаборатория по договору: ${okCtr('lab')?.counterparty || ctr('lab').detail}.`, basis: B('sp4284:3', 'sanpin4282:4') }
      : gapOf(['contract_lab'], B('sanpin4282:4')),
  ], lab.length ? { head: ['Площадка', 'Исследование', 'Объект / место отбора', 'Периодичность', 'Ответственный'], rows: lab.map((l) => [l.site, l.test_type, l.target, period(l.period_days), roleName(l.responsible_role)]) } : null);

  // 7. Санитарно-противоэпидемические мероприятия
  const san = await q(`select p.area, p.work, p.period_days, p.check_concentration, p.responsible_role, d.name as dis from sanitation_plans p left join disinfectants d on d.id = p.disinfectant_id
    where p.organization_id = $1 and p.status = 'active' order by p.period_days, p.area, p.work`);
  const dis = await q(`select name, purpose, concentration_min, concentration_max, exposure from disinfectants where organization_id = $1 and status = 'approved' order by name`);
  sec('Санитарно-противоэпидемические мероприятия', [
    ok('daily_cleaning') ? { text: 'Ежедневная влажная уборка производственных помещений с применением моющих и дезинфицирующих средств; уборки и дезинфекция — по графику (таблица).', basis: B('sanpin4282:21') }
      : gapOf(['daily_cleaning'], B('sanpin4282:21')),
    { text: 'Уборочный инвентарь — отдельный для каждого помещения, промаркирован; посуда и инвентарь в конце дня моются с дезинфекцией.', basis: B('sanpin4282:22', 'sanpin4282:37', 'sanpin4282:29') },
    ok('disinfectants') ? { text: `Моющие и дезинфицирующие средства применяются по инструкции изготовителя: ${dis.map((d) => d.name).join(', ')}.`, basis: B('sanpin4282:46') }
      : gapOf(['disinfectants'], B('sanpin4282:46')),
    ok('concentration') ? { text: 'Ёмкости с рабочими растворами маркируются; содержание действующих веществ контролируется по плану санитарии с записью в журнал.', basis: B('sanpin4282:47') }
      : gapOf(['concentration'], B('sanpin4282:47')),
    ok('contract_pest') ? { text: `Дезинсекция и дератизация — по договору с ${okCtr('pest_control')?.counterparty || ctr('pest_control').detail}, в отсутствие продукции, работников и потребителей.`, basis: B('sanpin4282:26', 'sanpin4282:45', 'sp4284:14') }
      : gapOf(['contract_pest'], B('sanpin4282:26')),
    ok('contract_waste') ? { text: `Отходы удаляются регулярно, раздельно, в маркированные закрываемые ёмкости; вывоз — по договору с ${okCtr('waste')?.counterparty || ctr('waste').detail}.`, basis: B('sanpin4282:20', 'trts021:16.3', 'sp4284:11') }
      : gapOf(['contract_waste'], B('sanpin4282:20')),
  ], san.length ? { head: ['Помещение', 'Работа', 'Периодичность', 'Средство', 'Ответственный'], rows: san.map((p) => [p.area, p.work + (p.check_concentration ? ' (контроль концентрации)' : ''), period(p.period_days), p.dis || '—', roleName(p.responsible_role)]) } : null);

  // 8. Персонал
  sec('Работники: медицинские осмотры, гигиеническая подготовка, допуск', [
    !ok('staff_medical', 'staff_hygiene') ? gapOf(['staff_medical', 'staff_hygiene'], B('sanpin4282:24'))
      : { text: 'Работники проходят предварительные и периодические медицинские осмотры, профессиональную гигиеническую подготовку и аттестацию; сроки контролируются системой.', basis: B('sanpin4282:24', 'trts021:11.6') },
    { text: 'Перед началом смены — осмотр работников с записью в гигиенический журнал; лица с признаками заболеваний и повреждениями кожи к работе не допускаются.', basis: B('sanpin4282:25', 'trts021:11.6') },
    { text: 'Приём пищи в производственных помещениях не допускается; рабочая и личная одежда хранятся раздельно.', basis: B('trts021:11.5', 'sp4285:88') },
  ]);

  // 9. Оборудование и средства измерений
  const eq = await q(`select e.name, e.calibration_due::text as due from equipment e where e.organization_id = $1 and e.status = 'active' and e.measuring order by e.name`);
  sec('Технологическое оборудование и средства измерений', [
    { text: 'Технологическое оборудование оснащено контрольными приборами; неисправности и ремонт фиксируются.', basis: B('trts021:15.2') },
    ...(eq.length ? [!ok('instruments') ? gapOf(['instruments'], B('trts021:15.2'))
      : { text: `Средства измерений (${eq.length}) поверяются или калибруются в установленные сроки.`, basis: B('trts021:15.2') }] : []),
    { text: 'Над источниками тепла, влаги и газов — местные вытяжные системы.', basis: B('sanpin4282:16', 'trts021:14.2') },
  ]);

  // 10. Журналы
  const { FORM_BY_CODE } = await import('./journals');
  const jr = JOURNALS.filter((j) => (!j.when || j.when(profile)) && FORM_BY_CODE.has(j.code)).map((j) => ({ ...j, basis: B(...j.basis) })).filter((j) => j.basis.length);
  const ref = (ids: string[]) => ids.map((id) => { const c = clauseById.get(id)!; return `${DOCS[c.doc].code}, ${c.clause}`; }).join('; ');
  sec('Перечень форм учёта и отчётности', [
    { text: 'Результаты производственного контроля регистрируются в журналах по перечню; журналы ведутся в системе в электронном виде и выводятся на печать.', basis: B('sanpin4282:35') },
  ], { head: ['Код', 'Журнал', 'Основание'], rows: jr.map((j) => [j.code, FORM_BY_CODE.get(j.code)!.name, ref(j.basis)]) });

  // 11. Договоры
  sec('Договоры, обеспечивающие производственный контроль', [
    { text: 'Договоры, на которых основаны мероприятия программы, — по таблице. Договор учитывается, если в систему загружен его файл; отсутствующие обязательные договоры указаны в разделах 6 и 7.', basis: B('sanpin4282:26', 'sanpin4282:20', 'sp4284:3') },
  ], { head: ['Вид', 'Контрагент', 'Номер, дата', 'Действует до'],
    rows: all.filter((c) => c.files > 0).map((c) => [KIND_LABEL[c.kind] || c.kind, c.counterparty, `${c.number || 'б/н'} от ${ddmm(c.signed_on)}`, c.valid_to ? ddmm(c.valid_to) : 'бессрочно']) });

  // Основания: только процитированные пункты, в порядке библиотеки
  const cited = new Set(sections.flatMap((s) => s.lines.flatMap((l) => l.basis)).concat(jr.flatMap((j) => j.basis)));
  const basis = CLAUSES.filter((c) => cited.has(c.id)).map((c) => ({ id: c.id, doc: DOCS[c.doc].code, clause: c.clause, text: c.text }));
  const docKeys = new Set(CLAUSES.filter((c) => cited.has(c.id)).map((c) => c.doc));
  // нормативная основа: истёкшие документы и неизвестные ссылки — техническое несоответствие (fail-closed)
  registerNormRefs('ppk', [...unknownRefs, ...sections.flatMap((x) => x.lines.flatMap((l) => l.basis))]);
  const normGaps: PpkLine[] = [];
  for (const k of ['norm_refs', 'doc_expiry']) if (!ok(k)) normGaps.push(gapOf([k]));
  if (unknownRefs.size) normGaps.push({ text: 'Ссылки на нормативную базу', basis: [], gap: `Программа ссылается на пункты, которых нет в нормативной базе (модуль ППК): ${[...unknownRefs].join(', ')}.`, href: null });
  if (normGaps.length) sections[0].lines.push(...normGaps);
  const gaps = sections.flatMap((s) => s.lines.filter((l) => l.gap).map((l) => ({ section: `${s.no}. ${s.title}`, text: l.gap!, href: l.href || null })));
  return {
    org: { name: org.name, legal_form: org.legal_form, inn: org.inn, region: org.region },
    sites: sites.map((s) => ({ name: s.name, address: s.address })), profile, profile_text: profileText, params,
    responsible: resp ? { name: resp.full_name, position: resp.position } : null,
    sections, docs: Object.entries(DOCS).filter(([k]) => docKeys.has(k)).map(([, d]) => ({ code: d.code, title: d.title, issued: d.issued, effective_to: d.effectiveTo })),
    basis, gaps, unknown_refs: [...unknownRefs],
  };
}

export const ppkHash = (d: PpkDoc) => createHash('sha256').update(JSON.stringify({ ...d, gaps: undefined, unknown_refs: undefined })).digest('hex');

async function versions(tx: Tx, orgId: string) {
  return (await tx.query(`select v.version, v.change_note, v.approved_at, v.data_hash, u.full_name as approved_by_name from ppk_versions v join users u on u.id = v.approved_by
    where v.organization_id = $1 order by v.version`, [orgId])).rows;
}

/** Состояние ППК для проверки готовности: нет утверждённой; утверждена, но данные изменились; актуальна. */
export async function ppkState(tx: Tx, orgId: string): Promise<{ state: 'none' | 'outdated' | 'ok'; version?: number; approved_at?: string }> {
  const last = (await tx.query(`select version, data_hash, approved_at::date::text as d from ppk_versions where organization_id = $1 order by version desc limit 1`, [orgId])).rows[0];
  if (!last) return { state: 'none' };
  const now = ppkHash(await buildPpk(tx, orgId));
  return { state: now === last.data_hash ? 'ok' : 'outdated', version: last.version, approved_at: last.d };
}

export async function getPpk(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'haccp.read', async (tx) => {
    const doc = await buildPpk(tx, orgId);
    const vers = await versions(tx, orgId);
    const last = vers[vers.length - 1];
    const hash = ppkHash(doc);
    const staff = (await tx.query(`select u.id, u.full_name, m.position from memberships m join users u on u.id = m.user_id where m.organization_id = $1 and m.status = 'active' order by u.full_name`, [orgId])).rows;
    return { doc, versions: vers.map(({ data_hash, ...v }) => v), current: !!last && last.data_hash === hash, staff };
  });
}

export async function savePpkParams(userId: string, orgId: string, input: unknown) {
  const d = parse(Params, input);
  const raw = (input || {}) as Record<string, unknown>;
  return inOrg(userId, orgId, 'haccp.manage', async (tx) => {
    const before = await loadParams(tx, orgId);
    const after: PpkParams = { ...before };
    for (const k of Object.keys(d) as (keyof PpkParams)[]) if (k in raw) (after as Record<string, unknown>)[k] = d[k] ?? null;
    if (after.responsibleUserId) {
      const ok = (await tx.query(`select 1 from memberships where organization_id = $1 and user_id = $2 and status = 'active'`, [orgId, after.responsibleUserId])).rowCount;
      if (!ok) throw Errors.validation('Ответственный должен быть действующим сотрудником предприятия.');
    }
    await tx.query(`insert into ppk_settings (organization_id, params, updated_by) values ($1, $2, $3)
      on conflict (organization_id) do update set params = excluded.params, updated_by = excluded.updated_by, updated_at = now()`, [orgId, JSON.stringify(after), userId]);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ppk.params', entityType: 'ppk', entityId: orgId, before, after });
    return after;
  });
}

/** Утверждение руководителем. С пробелами — отказ с их перечнем. */
export async function approvePpk(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ changeNote: z.string('Что введено или изменено.').trim().min(3, 'Укажите, что введено или изменено.').max(500) }), input);
  return inOrg(userId, orgId, 'haccp.approve', async (tx) => {
    await tx.query(`select 1 from organizations where id = $1 for update`, [orgId]);
    const doc = await buildPpk(tx, orgId);
    // запись о техническом несоответствии сохраняется отдельно: отказ в утверждении откатывает транзакцию
    if (doc.unknown_refs?.length) await withSystem((t) => audit.record(t, { organizationId: orgId, actorUserId: userId, action: 'ppk.norm_ref_unknown', entityType: 'ppk', entityId: orgId, after: { module: 'ppk', ids: doc.unknown_refs } }));
    if (doc.gaps.length) throw Errors.conflict(`Программу утвердить нельзя — не хватает данных (${doc.gaps.length}): ${doc.gaps.map((g) => g.text).join(' ')}`);
    const hash = ppkHash(doc);
    const last = (await tx.query(`select data_hash from ppk_versions where organization_id = $1 order by version desc limit 1`, [orgId])).rows[0];
    if (last && last.data_hash === hash) throw Errors.conflict('Данные не изменились с утверждённой версии — новая версия не нужна.');
    const n = Number((await tx.query(`select coalesce(max(version), 0) + 1 as n from ppk_versions where organization_id = $1`, [orgId])).rows[0].n);
    const row = (await tx.query(`insert into ppk_versions (organization_id, version, snapshot, data_hash, change_note, approved_by) values ($1, $2, $3, $4, $5, $6) returning version, approved_at`,
      [orgId, n, JSON.stringify(doc), hash, d.changeNote, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'ppk.approve', entityType: 'ppk', entityId: orgId, after: { version: n, data_hash: hash } });
    return row;
  });
}

export async function getPpkVersion(userId: string, orgId: string, version: number) {
  return inOrg(userId, orgId, 'haccp.read', async (tx) => {
    const v = (await tx.query(`select v.version, v.snapshot, v.change_note, v.approved_at, u.full_name as approved_by_name from ppk_versions v join users u on u.id = v.approved_by
      where v.organization_id = $1 and v.version = $2`, [orgId, version])).rows[0];
    if (!v) throw Errors.notFound('Версия программы не найдена.');
    const all = (await versions(tx, orgId)).filter((x) => x.version <= version).map(({ data_hash, ...x }) => x);
    return { ...v, versions: all };
  });
}
