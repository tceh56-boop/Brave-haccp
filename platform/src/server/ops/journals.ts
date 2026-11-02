import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ROLES, type Role } from '../access/roles';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, fmtNum } from './common';
import { criterionText } from './control';
import { expiryState, EXPIRY_LABEL, LOT_STATUS_LABEL } from './lots';
import { STATUS_LABEL as INC_STATUS } from './incidents';
import { approvedPlan, PLAN_STATUS } from './haccp';

/**
 * Журналы ХАССП J01–J60 (книга «Журналы_J01-J53.xlsx» + J54–J60 по ТЗ доработки, 7.5). ТЗ v2 §0, §12: запись делается один раз — журнал
 * собирается из событий системы. Пересекающиеся формы (J01 ↔ J25 ↔ J42, J03 ↔ J21 ↔ J39 …) — разные
 * печатные виды одних и тех же данных. Где событий пока нет — ручная запись по столбцам шаблона,
 * одна на семейство форм. Подпись за период хранит хеш содержимого; подписать нельзя при открытых
 * отклонениях периода (механика MON CHEF «подписать журнал нельзя, пока в нём есть проблемы»).
 */

interface FormDef { code: string; name: string; purpose: string; fill: string; overlaps: string[]; columns: string[] }
import formsJson from '../../../data/reference/journal_forms.json';
const FORMS: FormDef[] = (formsJson as { forms: FormDef[] }).forms;
export const FORM_BY_CODE = new Map(FORMS.map((f) => [f.code, f]));

type Source = 'cold' | 'cold_grid' | 'room' | 'room_grid' | 'receipt' | 'lots' | 'incidents' | 'plans' | 'hazards' | 'plan' | 'repairs' | 'cleaning' | 'washing' | 'concentration' | 'health' | 'briefing_sanitary' | 'briefing_safety'
  | 'opening' | 'semi_release' | 'label_prints' | 'relabels' | 'dish_release' | 'samples' | 'lab';
/** Формы, собираемые из событий. Остальные — ручная запись. */
const AUTO: Record<string, Source> = {
  J01: 'cold', J25: 'cold', J42: 'cold_grid', J04: 'room', J43: 'room_grid',
  J03: 'receipt', J21: 'receipt', J39: 'receipt', J05: 'lots', J29: 'lots', J34: 'incidents',
  J30: 'plans', J31: 'hazards', J32: 'plan',   // реестры из плана ХАССП (не зависят от периода)
  J18: 'repairs', J10: 'cleaning', J09: 'washing', J15: 'concentration', J26: 'concentration',   // оборудование и санитария (этап 15)
  J07: 'health', J16: 'briefing_sanitary', J17: 'briefing_safety',   // персонал (этап 16)
  // ТЗ доработки, 7.5: вскрытие, выпуск, маркировка, суточные пробы, лаборатория — из реальных событий
  J54: 'opening', J55: 'semi_release', J56: 'label_prints', J57: 'relabels', J58: 'dish_release', J59: 'samples', J60: 'lab',
};
/**
 * Для ручных семейств — форма, в которой хранятся данные. Пара форм (J02 ↔ J40) — одни данные, печатный вид
 * по столбцам формы-источника. Сводная форма (пересекается с несколькими, например J44 ↔ J07/J08/J27) ведётся
 * своими записями: склеивать разные журналы по цепочке нельзя.
 */
const manualOverlaps = (code: string) => (FORM_BY_CODE.get(code)?.overlaps || []).filter((c) => FORM_BY_CODE.has(c) && !AUTO[c]);
const isHub = (code: string) => manualOverlaps(code).length >= 2;
export function dataFormOf(code: string): string {
  if (AUTO[code] || isHub(code)) return code;
  return [code, ...manualOverlaps(code).filter((c) => !isHub(c))].sort()[0];
}

const INC_BLOCK: Partial<Record<Source, string[]>> = {
  cold: ['temperature_deviation'], cold_grid: ['temperature_deviation'], room: ['temperature_deviation'], room_grid: ['temperature_deviation'],
  receipt: ['receipt_problem'], lots: ['expired_lot'], semi_release: ['release_check'], dish_release: ['release_check'], lab: ['lab_fail'], repairs: ['equipment'], cleaning: ['sanitation'], washing: ['sanitation'], concentration: ['sanitation'], incidents: ['temperature_deviation', 'receipt_problem', 'expired_lot', 'reported', 'release_check', 'lab_fail', 'equipment', 'sanitation'],
};

export function listForms() {
  return FORMS.map((f) => {
    const src = AUTO[f.code];
    const data = dataFormOf(f.code);
    return { code: f.code, name: f.name, purpose: f.purpose, fill: f.fill, overlaps: f.overlaps, mode: src ? 'auto' : 'manual',
      data_form: data, shares_with: data !== f.code ? data : null, columns: f.columns };
  });
}

export interface Period { from: string; to: string }
const PeriodInput = z.object({ siteId: z.uuid(), from: z.iso.date(), to: z.iso.date() }).refine((p) => p.to >= p.from, 'Конец периода раньше начала.')
  .refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / 86400e3 <= 92, 'Период — не больше трёх месяцев.');

interface Ctx { tx: Tx; orgId: string; siteId: string; tz: string; from: string; to: string }

const fmtD = (ts: Date | string | null, tz: string) => (ts ? new Date(ts).toLocaleDateString('ru-RU', { timeZone: tz }) : '');
const fmtT = (ts: Date | string | null, tz: string) => (ts ? new Date(ts).toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '');
const fmtDT = (ts: Date | string | null, tz: string) => (ts ? `${fmtD(ts, tz)} ${fmtT(ts, tz)}` : '');
const yesNo = (v: unknown) => (v === true ? 'да' : v === false ? 'нет' : '—');
const RESULT_RU: Record<string, string> = { ok: 'да', deviation: 'нет', no_criterion: 'критерий не задан' };
const DECISION_RU: Record<string, string> = { accepted: 'принять', quarantine: 'карантин', rejected: 'отклонить' };
const INC_KIND: Record<string, string> = { temperature_deviation: 'Температура вне предела', receipt_problem: 'Приёмка', expired_lot: 'Истёк срок', reported: 'Сообщение сотрудника', release_check: 'Выпуск п/ф (ККТ)', lab_fail: 'Лабораторное исследование', equipment: 'Оборудование', sanitation: 'Санитария' };

/** Границы периода в часовом поясе предприятия. */
function periodSql(fromIdx: number, toIdx: number, tzIdx: number) {
  return `(($${fromIdx}::date)::timestamp at time zone $${tzIdx}) and ((($${toIdx}::date) + 1)::timestamp at time zone $${tzIdx})`;
}

async function measurementsRows(c: Ctx, kinds: string[], parameter: string | null) {
  return (await c.tx.query(`select m.*, o.name as object, o.kind, r.min_value, r.max_value, r.unit as r_unit, coalesce(u.full_name, 'датчик ' || m.sensor_id) as author,
      (select i.title || ' — ' || i.status from incidents i where i.entity_type = 'control_object' and i.entity_id = m.control_object_id and i.kind = 'temperature_deviation'
         and i.created_at between m.measured_at - interval '1 minute' and m.measured_at + interval '6 hours' order by i.created_at limit 1) as incident
    from measurements m join control_objects o on o.id = m.control_object_id left join control_rules r on r.id = m.rule_id left join users u on u.id = m.author_user_id
    where m.organization_id = $1 and m.site_id = $2 and o.kind = any($3::text[]) and ($4::text is null or m.parameter = $4)
      and m.measured_at between ${periodSql(5, 6, 7)}
      and not exists (select 1 from measurements x where x.corrects_id = m.id)
    order by m.measured_at, o.name`, [c.orgId, c.siteId, kinds, parameter, c.from, c.to, c.tz])).rows;
}

function mNote(m: { is_late: boolean; corrects_id: string | null; correction_reason: string | null; incident: string | null; comment: string | null }, tz: string, entered: string) {
  return [m.incident ? m.incident.replace(/ — (new|in_progress|pending_review|closed)$/, (_, s) => ` (${INC_STATUS[s]})`) : '', m.is_late ? `внесено позже: ${fmtDT(entered, tz)}` : '',
    m.corrects_id ? `исправление: ${m.correction_reason}` : '', m.comment || ''].filter(Boolean).join('; ');
}

async function buildRows(c: Ctx, code: string, src: Source | null): Promise<{ columns: string[]; rows: string[][]; grid?: boolean }> {
  const f = FORM_BY_CODE.get(code)!;
  const tz = c.tz;
  if (src === 'cold' || src === 'room') {
    const ms = await measurementsRows(c, src === 'cold' ? ['fridge', 'freezer'] : ['room'], null);
    const rows = ms.map((m) => {
      const norm = m.rule_id ? criterionText({ min_value: m.min_value, max_value: m.max_value, unit: m.r_unit }) : 'не утверждена';
      const val = `${fmtNum(m.value)} ${m.unit}`;
      const note = mNote(m, tz, m.entered_at);
      if (code === 'J01') return [fmtD(m.measured_at, tz), fmtT(m.measured_at, tz), m.object, norm, val, RESULT_RU[m.result], m.author, note];
      if (code === 'J25') return [fmtD(m.measured_at, tz), fmtT(m.measured_at, tz), m.object, norm, val, m.sensor_id ? `датчик ${m.sensor_id}` : `сотрудник${m.is_late ? ' (поздний ввод)' : ''}`,
        m.result === 'deviation' ? 'вне предела' : m.result === 'ok' ? 'в пределе' : 'без оценки', m.result === 'deviation' ? 'да' : '—', [m.author, note].filter(Boolean).join('; ')];
      // J04: температура и влажность помещения — в своих столбцах.
      const t = m.parameter === 'temperature', h = m.parameter === 'humidity';
      return [fmtD(m.measured_at, tz), fmtT(m.measured_at, tz), m.object, t ? norm : '', t ? val : '', h ? norm : '', h ? val : '', RESULT_RU[m.result], m.author];
    });
    return { columns: f.columns, rows };
  }
  if (src === 'cold_grid' || src === 'room_grid') {
    // Месячная сетка (J42/J43): объект × дни месяца начала периода; значения дня через «/», выход за предел — «!».
    const start = new Date(`${c.from}T00:00:00Z`);
    const days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    const monthFrom = `${c.from.slice(0, 8)}01`, monthTo = `${c.from.slice(0, 8)}${String(days).padStart(2, '0')}`;
    const ms = await measurementsRows({ ...c, from: monthFrom, to: monthTo }, src === 'cold_grid' ? ['fridge', 'freezer'] : ['room'], null);
    const objects = [...new Set(ms.map((m) => `${m.object}${src === 'room_grid' ? (m.parameter === 'humidity' ? ' — ВВ, %' : ' — Т, °C') : ''}`))];
    const cols = [src === 'cold_grid' ? 'Наименование или номер ХК' : 'Помещение / показатель', ...Array.from({ length: days }, (_, i) => String(i + 1))];
    const rows = objects.map((name) => [name, ...Array.from({ length: days }, (_, i) => ms.filter((m) => `${m.object}${src === 'room_grid' ? (m.parameter === 'humidity' ? ' — ВВ, %' : ' — Т, °C') : ''}` === name
      && new Date(m.measured_at).toLocaleDateString('ru-RU', { timeZone: tz, day: 'numeric' }) === String(i + 1))
      .map((m) => `${fmtNum(m.value)}${m.result === 'deviation' ? '!' : ''}`).join('/'))]);
    return { columns: cols, rows, grid: true };
  }
  if (src === 'receipt') {
    const ls = (await c.tx.query(`select l.*, p.name as product, r.document_no, r.document_date, r.completed_at, s.name as supplier, u.full_name as accepted_by
      from receipt_lines l join receipts r on r.id = l.receipt_id join products p on p.id = l.product_id left join suppliers s on s.id = r.supplier_id left join users u on u.id = r.completed_by
      where r.organization_id = $1 and r.site_id = $2 and r.status <> 'draft' and r.completed_at between ${periodSql(3, 4, 5)} order by r.completed_at, l.created_at`,
      [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    const rows = ls.map((l) => {
      const ch = l.checks || {};
      const temp = l.temperature !== null ? fmtNum(l.temperature) : '—';
      const doc = [l.document_no, l.document_date ? `от ${fmtD(l.document_date, tz)}` : ''].filter(Boolean).join(' ') || '—';
      const exp = l.expires_at ? `${fmtD(l.expires_at, tz)} (${l.expiry_basis})` : 'не подтверждён';
      if (code === 'J03') return [fmtD(l.completed_at, tz), l.product, l.supplier || '—', doc, exp, temp, `упаковка: ${yesNo(ch.packaging)}, маркировка: ${yesNo(ch.labeling)}`, DECISION_RU[l.decision], l.accepted_by];
      if (code === 'J21') return [fmtDT(l.completed_at, tz), l.product, l.supplier || '—', [l.lot_no, doc].filter((x) => x && x !== '—').join(' / ') || '—', temp, yesNo(ch.quality), yesNo(ch.documents),
        DECISION_RU[l.decision], l.decision_reason || '', l.accepted_by];
      return [fmtD(l.completed_at, tz), l.product, exp, l.supplier || '—', doc, `${fmtNum(l.quantity)} ${l.unit}${l.lot_no ? `, партия ${l.lot_no}` : ''}`, temp, yesNo(ch.documents),
        `упаковка: ${yesNo(ch.packaging)}, маркировка: ${yesNo(ch.labeling)}`, l.decision === 'accepted' ? 'П' : 'О', l.decision === 'accepted' ? '' : `${DECISION_RU[l.decision]}: ${l.decision_reason}`, l.accepted_by];
    });
    return { columns: f.columns, rows };
  }
  if (src === 'repairs') {
    const bs = (await c.tx.query(`select b.*, e.name as equipment, u.full_name as reporter,
        (select json_build_object('description', r.description, 'performer', r.performer, 'happened_on', r.happened_on, 'admitted', r.admitted) from equipment_events r
          where r.breakdown_id = b.id and r.kind = 'repair' order by r.recorded_at desc limit 1) as repair
      from equipment_events b join equipment e on e.id = b.equipment_id join users u on u.id = b.recorded_by
      where b.organization_id = $1 and b.site_id = $2 and b.kind = 'breakdown' and b.recorded_at between ${periodSql(3, 4, 5)} order by b.recorded_at`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    const rows = bs.map((b) => [fmtDT(b.recorded_at, tz), b.equipment, b.description, b.safety_impact || 'не указано', b.reporter, b.repair?.performer || '', b.repair?.description || '',
      b.repair ? fmtD(b.repair.happened_on, tz) : '', b.repair ? (b.repair.admitted ? 'допущено' : 'не допущено') : 'ремонт не завершён']);
    return { columns: f.columns, rows };
  }
  if (src === 'cleaning' || src === 'washing' || src === 'concentration') {
    const rs = (await c.tx.query(`select r.*, p.area, p.work, p.kind, p.period_days, x.name as disinfectant, x.concentration_min, x.concentration_max, u.full_name as author,
        v.ok as verified_ok, v.note as verify_note, vu.full_name as verifier, i.recommended_action
      from sanitation_records r join sanitation_plans p on p.id = r.plan_id join users u on u.id = r.done_by left join disinfectants x on x.id = r.disinfectant_id
      left join sanitation_verifications v on v.record_id = r.id left join users vu on vu.id = v.verified_by left join incidents i on i.id = r.incident_id
      where r.organization_id = $1 and r.site_id = $2 and r.done_at between ${periodSql(3, 4, 5)}
        and ${src === 'cleaning' ? `p.kind in ('current', 'general', 'disinfection')` : src === 'washing' ? `p.kind = 'inventory'` : `r.concentration is not null`}
      order by r.done_at`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    const KIND: Record<string, string> = { current: 'текущая', general: 'генеральная', disinfection: 'дезинфекция', inventory: 'мойка инвентаря' };
    const norm = (r: { concentration_min: string | null; concentration_max: string | null }) => [r.concentration_min !== null ? `от ${fmtNum(r.concentration_min)} %` : '', r.concentration_max !== null ? `до ${fmtNum(r.concentration_max)} %` : ''].filter(Boolean).join(' ') || '—';
    const check = (r: { verified_ok: boolean | null; verify_note: string | null }) => (r.verified_ok === null ? 'не проверено' : r.verified_ok ? 'принято' : `не принято: ${r.verify_note}`);
    const conc = (r: { concentration: string | null }) => (r.concentration !== null ? `${fmtNum(r.concentration)} %` : '');
    const rows = rs.map((r) => {
      if (src === 'cleaning') return [fmtD(r.done_at, tz), r.area, `${KIND[r.kind]}: ${r.work}`, `раз в ${r.period_days} дн.`, fmtT(r.done_at, tz), [r.disinfectant, conc(r)].filter(Boolean).join(', ') || '—',
        r.result === 'done' ? 'да' : 'нет — концентрация вне режима', r.author, r.verifier ? `${r.verifier} (${check(r)})` : 'не проверено'];
      if (src === 'washing') return [fmtD(r.done_at, tz), fmtT(r.done_at, tz), r.area, r.work, [r.disinfectant, conc(r)].filter(Boolean).join(', ') || '—', r.result === 'done' ? 'выполнено' : 'отклонение',
        check(r), r.author, r.verifier || ''];
      return [fmtD(r.done_at, tz), fmtT(r.done_at, tz), r.disinfectant || '—', norm(r), conc(r), 'по инструкции средства', r.concentration_ok ? 'да' : 'нет',
        r.concentration_ok ? '' : r.recommended_action || 'раствор приготовлен заново', r.author];
    });
    return { columns: f.columns, rows };
  }
  if (src === 'health') {
    const hs = (await c.tx.query(`select h.*, u.full_name as employee, m.position, m.role, cu.full_name as checker from health_checks h join users u on u.id = h.user_id
        join users cu on cu.id = h.checked_by left join memberships m on m.organization_id = h.organization_id and m.user_id = h.user_id
      where h.organization_id = $1 and h.site_id = $2 and h.checked_on between $3::date and $4::date order by h.checked_on, u.full_name`, [c.orgId, c.siteId, c.from, c.to])).rows;
    const rows = hs.map((h) => [fmtD(h.checked_on, tz), h.employee, h.position || ROLES[h.role as Role]?.label || '', h.admitted ? 'признаков заболеваний нет' : 'выявлены признаки',
      h.signs || 'нет', h.admitted ? 'допущен' : `не допущен; ${h.action}`, h.checker, fmtT(h.checked_at, tz)]);
    return { columns: f.columns, rows };
  }
  if (src === 'briefing_sanitary' || src === 'briefing_safety') {
    const bs = (await c.tx.query(`select b.*, t.title, t.material, u.full_name as employee, m.position, m.role, iu.full_name as instructor, a.acknowledged_at
      from briefings b join briefing_topics t on t.id = b.topic_id join users u on u.id = b.user_id join users iu on iu.id = b.instructor_id
        left join memberships m on m.organization_id = b.organization_id and m.user_id = b.user_id left join briefing_acks a on a.briefing_id = b.id
      where b.organization_id = $1 and t.category = any($2::text[]) and b.held_on between $3::date and $4::date order by b.held_on, u.full_name`,
    [c.orgId, src === 'briefing_sanitary' ? ['sanitary'] : ['safety', 'haccp'], c.from, c.to])).rows;
    const TYPE: Record<string, string> = { intro: 'вводный', primary: 'первичный', repeat: 'повторный', unscheduled: 'внеплановый', target: 'целевой', training: 'обучение' };
    const res = (b: { result: string; note: string | null }) => (b.result === 'passed' ? 'сдал' : `не сдал: ${b.note}`);
    const sign = (b: { acknowledged_at: string | null }) => (b.acknowledged_at ? `подтверждено ${fmtDT(b.acknowledged_at, tz)}` : 'не подтверждено');
    const rows = bs.map((b) => src === 'briefing_sanitary'
      ? [fmtD(b.held_on, tz), b.employee, b.position || ROLES[b.role as Role]?.label || '', `${b.title} (${TYPE[b.briefing_type]})`, b.material, res(b), sign(b), b.instructor]
      : [fmtD(b.held_on, tz), b.employee, b.position || ROLES[b.role as Role]?.label || '', b.title, TYPE[b.briefing_type], res(b), sign(b), b.instructor]);
    return { columns: f.columns, rows };
  }
  if (src === 'lots') {
    const ls = (await c.tx.query(`select l.*, p.name as product,
        exists (select 1 from stock_movements m where m.lot_id = l.id and m.fefo_override and m.created_at between ${periodSql(3, 4, 5)}) as override,
        (select string_agg(distinct coalesce(m.reason, ''), '; ') from stock_movements m where m.lot_id = l.id and m.kind = 'write_off' and m.created_at between ${periodSql(3, 4, 5)}) as written_off
      from lots l join products p on p.id = l.product_id
      where l.organization_id = $1 and l.site_id = $2 and l.received_at < ((($4::date) + 1)::timestamp at time zone $5)
        and (l.status in ('available', 'quarantine', 'blocked') or exists (select 1 from stock_movements m where m.lot_id = l.id and m.created_at between ${periodSql(3, 4, 5)}))
      order by l.expires_at nulls first, p.name`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    const checkDate = fmtD(new Date(), tz);
    const rows = ls.map((l) => {
      const st = l.status === 'available' ? EXPIRY_LABEL[expiryState(l)] : LOT_STATUS_LABEL[l.status];
      const fifo = l.override ? 'нет — выбор с причиной (см. движения)' : 'да';
      const action = [l.status_reason, l.written_off ? `списание: ${l.written_off}` : ''].filter(Boolean).join('; ');
      const qty = `${fmtNum(l.quantity)} ${l.unit}`;
      const exp = l.expires_at ? fmtD(l.expires_at, tz) : 'не подтверждён';
      if (code === 'J05') return [checkDate, l.product, l.lot_no || '—', fmtD(l.received_at, tz), exp, qty, st, fifo, action];
      return [checkDate, l.product, l.lot_no || '—', exp, qty, st, fifo, action, ''];
    });
    return { columns: f.columns, rows };
  }
  if (src === 'incidents') {
    const is = (await c.tx.query(`select i.*, ru.full_name as responsible, cu.full_name as confirmer, au.full_name as actor,
        k.root_cause as capa_cause, k.corrective_action as capa_action, k.preventive_action as capa_prevent, k.status as capa_status from incidents i
      left join users ru on ru.id = i.responsible_user_id left join users cu on cu.id = i.confirmed_by left join users au on au.id = i.action_by
      left join capas k on k.incident_id = i.id
      where i.organization_id = $1 and (i.site_id = $2 or i.site_id is null) and i.created_at between ${periodSql(3, 4, 5)} order by i.created_at`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    const rows = is.map((i) => [i.id.slice(0, 8), fmtDT(i.created_at, tz), INC_KIND[i.kind] || i.kind, i.what, i.recommended_action || '',
      i.capa_cause ? `CAPA: ${i.capa_cause}` : i.capa_status ? 'CAPA: причина устанавливается' : '',
      [i.action_note, i.capa_action ? `CAPA — корректирующее: ${i.capa_action}` : '', i.capa_prevent ? `предупреждающее: ${i.capa_prevent}` : ''].filter(Boolean).join('; '),
      i.responsible || i.actor || i.responsible_role || '', fmtDT(i.due_at, tz), i.closed_at ? `${fmtDT(i.closed_at, tz)}${i.confirmer ? ` / ${i.confirmer}` : ''}` : INC_STATUS[i.status]]);
    return { columns: f.columns, rows };
  }
  if (src === 'plans') {
    const ps = (await c.tx.query(`select p.*, a.full_name as approver, cr.full_name as creator from haccp_plans p left join users a on a.id = p.approved_by
      join users cr on cr.id = p.created_by where p.organization_id = $1 order by p.version`, [c.orgId])).rows;
    const rows = ps.map((p) => [`ПХ-${p.version}`, p.scope, `версия ${p.version}`, fmtD(p.created_at, tz), p.approved_at ? fmtD(p.approved_at, tz) : '',
      p.change_reason || 'первичная разработка', p.approver || p.creator, PLAN_STATUS[p.status], 'план ХАССП в системе ЦЕХ']);
    return { columns: f.columns, rows };
  }
  if (src === 'hazards' || src === 'plan') {
    const plan = await approvedPlan(c.tx, c.orgId);
    if (!plan) return { columns: f.columns, rows: [] };
    const ver = `версия ${plan.plan.version} от ${fmtD(plan.plan.approved_at, tz)}`;
    const lvl = (n: number | null) => (n ? String(n) : 'не оценено');
    if (src === 'hazards') {
      return { columns: f.columns, rows: plan.hazards.map((h) => [h.code, h.step_name || '', h.type_label, h.description, lvl(h.likelihood), lvl(h.severity),
        h.control_measures || '', h.class_label || '—', h.monitoring?.responsible_label || '', ver]) };
    }
    return { columns: f.columns, rows: plan.hazards.filter((h) => h.monitoring).map((h) => {
      const m = h.monitoring!;
      const limit = m.critical_limit || (m.control_rule_id ? `по правилу: ${criterionText(m)}` : '—');
      return [h.code, h.step_name || '', h.class_label || '', h.description, limit, [m.method, m.device ? `прибор: ${m.device}` : '', m.record_form ? `запись: ${m.record_form}` : ''].filter(Boolean).join('; '),
        m.frequency, m.responsible_label, m.corrective_action, ver];
    }) };
  }
  if (src === 'opening') {
    // J54: вскрытие тары — дочерняя партия (lot_links.kind = 'opened'), сотрудник — из движения склада
    const r = (await c.tx.query(`select cl.opened_at, p.name as product, pl.lot_no, k.quantity, k.unit, cl.expires_at, cl.expiry_basis, o.name as storage,
        (select u.full_name from stock_movements sm join users u on u.id = sm.created_by where sm.lot_id = cl.id and sm.kind = 'open_in' order by sm.created_at limit 1) as who,
        (select lb.code from labels lb where lb.lot_id = cl.id order by lb.created_at limit 1) as label
      from lot_links k join lots cl on cl.id = k.child_lot_id join lots pl on pl.id = k.parent_lot_id join products p on p.id = cl.product_id
      left join control_objects o on o.id = cl.storage_object_id
      where k.organization_id = $1 and k.kind = 'opened' and cl.site_id = $2 and cl.opened_at between ${periodSql(3, 4, 5)} order by cl.opened_at`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    return { columns: f.columns, rows: r.map((x) => {
      const h = /после вскрытия ([\d,.]+) ч/.exec(x.expiry_basis || '')?.[1] || /([\d,.]+) ч после вскрытия/.exec(x.expiry_basis || '')?.[1];
      return [fmtDT(x.opened_at, tz), x.product, x.lot_no || 'без номера', `${fmtNum(x.quantity)} ${x.unit}`, x.who || '—', h ? `${h} ч` : '—', x.expiry_basis || '—',
        fmtDT(x.expires_at, tz), x.label || 'не выдана', x.storage || '—', x.who ? `электронно: ${x.who}` : 'нет'];
    }) };
  }
  if (src === 'semi_release' || src === 'dish_release') {
    const r = (await c.tx.query(`select o.id, o.completed_at, o.actual_g, o.organoleptic, o.release_decision, (select full_name from users where id = o.assessed_by) as assessor, d.name as dish, v.version as ttk_version, v.card_date, l.lot_no, l.expires_at, l.status as lot_status, u.full_name as who,
        (select string_agg(p.name || ' ' || coalesce(pl.lot_no, 'б/н'), '; ' order by p.name) from lot_links k join lots pl on pl.id = k.parent_lot_id join products p on p.id = pl.product_id
           where k.child_lot_id = o.output_lot_id and k.kind = 'production') as raw,
        (select lb.code from labels lb where lb.lot_id = o.output_lot_id order by lb.created_at limit 1) as label,
        (select count(*)::int from production_checks pc where pc.order_id = o.id) as checks,
        (select count(*)::int from production_checks pc where pc.order_id = o.id and not pc.ok) as bad
      from production_orders o join dishes d on d.id = o.dish_id join ttk_versions v on v.id = o.ttk_version_id left join lots l on l.id = o.output_lot_id left join users u on u.id = o.completed_by
      where o.organization_id = $1 and o.site_id = $2 and o.status = 'done' and d.kind = $3 and o.completed_at between ${periodSql(4, 5, 6)} order by o.completed_at`,
      [c.orgId, c.siteId, src === 'semi_release' ? 'semi' : 'dish', c.from, c.to, c.tz])).rows;
    const ctl = (x: { checks: number; bad: number }) => (!x.checks ? 'контроль не предусмотрен (нет проверок выпуска)' : x.bad ? `отклонение: ${x.bad} из ${x.checks}` : `в норме: ${x.checks} из ${x.checks}`);
    if (src === 'semi_release') return { columns: f.columns, rows: r.map((x) => [x.dish, `версия ${x.ttk_version}`, fmtDT(x.completed_at, tz), `${fmtNum(Number(x.actual_g) / 1000)} кг`,
      x.raw || 'нет связей с сырьём', fmtDT(x.expires_at, tz), x.label || 'не выдана', x.who || '—', ctl(x)]) };
    return { columns: f.columns, rows: r.map((x) => [x.dish, x.lot_no || 'без номера', `версия ${x.ttk_version}`, fmtDT(x.completed_at, tz),
      x.release_decision ? `${x.release_decision === 'allowed' ? 'допущено' : 'не допущено'} (${x.assessor}); ${ctl(x)}` : `нет записи бракеража; ${ctl(x)}`, x.organoleptic || 'нет записи в системе',
      x.release_decision === 'allowed' && x.lot_status === 'available' && !x.bad ? 'разрешено' : `не разрешено (${x.release_decision === 'rejected' ? 'бракераж' : LOT_STATUS_LABEL[x.lot_status] || x.lot_status || 'нет партии'})`,
      fmtDT(x.expires_at, tz), x.who || '—']) };
  }
  if (src === 'label_prints') {
    const SRC: Record<string, string> = { lot: 'этикетка партии', opened: 'вскрытие тары', consumer: 'потребительская этикетка' };
    const r = (await c.tx.query(`select pr.printed_at, pr.copies, pr.reason, lb.code, lb.kind, lb.payload->>'lot_no' as lot_no, lb.payload->>'product' as product, u.full_name as who
      from label_prints pr join labels lb on lb.id = pr.label_id join users u on u.id = pr.printed_by
      where pr.organization_id = $1 and pr.site_id = $2 and pr.printed_at between ${periodSql(3, 4, 5)} order by pr.printed_at`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    return { columns: f.columns, rows: r.map((x) => [x.lot_no || 'без номера', x.product, x.code, fmtDT(x.printed_at, tz), String(x.copies), x.who, SRC[x.kind] || x.kind, x.reason || '—']) };
  }
  if (src === 'relabels') {
    // перепечать той же этикетки (с причиной) и замена этикетки партии новой (изменились данные партии)
    const re = (await c.tx.query(`select pr.printed_at as at, lb.code, pr.reason, u.full_name as who, cu.full_name as confirmer, cf.confirmed_at
      from label_prints pr join labels lb on lb.id = pr.label_id join users u on u.id = pr.printed_by
      left join label_print_confirmations cf on cf.print_id = pr.id left join users cu on cu.id = cf.confirmed_by
      where pr.organization_id = $1 and pr.site_id = $2 and pr.reason is not null and pr.printed_at between ${periodSql(3, 4, 5)}`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    const rp = (await c.tx.query(`select lb.created_at as at, lb.code, lb.payload as p, u.full_name as who,
        (select row_to_json(x) from (select o.code, o.payload as p from labels o where o.lot_id = lb.lot_id and o.kind = lb.kind and o.created_at < lb.created_at order by o.created_at desc limit 1) x) as old
      from labels lb left join users u on u.id = lb.created_by
      where lb.organization_id = $1 and lb.site_id = $2 and lb.created_at between ${periodSql(3, 4, 5)}`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows.filter((x) => x.old);
    const FIELD: Record<string, string> = { expires_at: 'срок годности', expiry_basis: 'основание срока', warning: 'пометка', storage: 'место хранения', lot_no: 'номер партии', opened_at: 'вскрытие', product: 'продукт' };
    const val = (k: string, v: unknown) => (v == null || v === '' ? '—' : k === 'expires_at' || k === 'opened_at' ? fmtDT(String(v), tz) : String(v));
    const diff = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(FIELD).filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
      .map((k) => `${FIELD[k]}: ${val(k, a[k])} → ${val(k, b[k])}`).join('; ');
    const rows = [
      ...re.map((x) => ({ at: x.at, row: [x.code, `${x.code} (та же, повторная печать)`, x.reason, 'без изменений', x.who, x.confirmer ? `${x.confirmer}, ${fmtDT(x.confirmed_at, tz)}` : 'не подтверждено'] })),
      ...rp.map((x) => ({ at: x.at, row: [x.old.code, x.code, 'изменились данные партии', diff(x.old.p, x.p) || 'изменились прочие данные', x.who || '—', 'выдана системой по изменению данных партии'] })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return { columns: f.columns, rows: rows.map((x) => x.row) };
  }
  if (src === 'samples') {
    const r = (await c.tx.query(`select s.*, d.name as dish, l.lot_no, o.name as storage, u.full_name as who, x.destroyed_at, du.full_name as destroyer
      from daily_samples s left join dishes d on d.id = s.dish_id left join lots l on l.id = s.lot_id left join control_objects o on o.id = s.storage_object_id
      join users u on u.id = s.taken_by left join daily_sample_destructions x on x.sample_id = s.id left join users du on du.id = x.destroyed_by
      where s.organization_id = $1 and s.site_id = $2 and s.taken_at between ${periodSql(3, 4, 5)} order by s.taken_at`, [c.orgId, c.siteId, c.from, c.to, c.tz])).rows;
    return { columns: f.columns, rows: r.map((x) => [x.dish || x.title, x.lot_no || '—', fmtDT(x.taken_at, tz), x.whole_portion ? `порция целиком (${fmtNum(x.weight_g)} г)` : `${fmtNum(x.weight_g)} г`,
      x.container || '—', x.temperature == null ? '—' : `${fmtNum(x.temperature)} °C`, x.storage || x.storage_place || '—', `до ${fmtDT(x.keep_until, tz)}`,
      x.destroyed_at ? `${fmtDT(x.destroyed_at, tz)}, ${x.destroyer}` : new Date(x.keep_until) < new Date() ? 'не уничтожена — срок прошёл' : 'хранится', x.who]) };
  }
  if (src === 'lab') {
    const r = (await c.tx.query(`select r.*, i.title as inc_title, i.status as inc_status from lab_results r left join incidents i on i.id = r.incident_id
      where r.organization_id = $1 and r.site_id = $2 and r.sampled_on between $3::date and $4::date order by r.sampled_on, r.recorded_at`, [c.orgId, c.siteId, c.from, c.to])).rows;
    const rows: string[][] = [];
    for (const x of r) {
      const act = x.inc_title ? `${x.inc_title} (${INC_STATUS[x.inc_status] || x.inc_status})` : x.result === 'fail' ? 'нет записи о действии' : '—';
      const ps = (x.params || []) as { name: string; fact: string; norm: string; unit: string | null; pass: boolean }[];
      if (!ps.length) rows.push([x.target, x.test_type, fmtD(x.sampled_on, tz), x.lab_name, x.protocol_no, x.conclusion || '—', '—', x.result === 'pass' ? 'соответствует' : 'не соответствует', act]);
      for (const q of ps) rows.push([x.target, `${x.test_type}: ${q.name}`, fmtD(x.sampled_on, tz), x.lab_name, x.protocol_no, `${q.fact}${q.unit ? ` ${q.unit}` : ''}`, q.norm, q.pass ? 'соответствует' : 'не соответствует', q.pass ? '—' : act]);
    }
    return { columns: f.columns, rows };
  }
  // Ручная форма: записи хранятся в форме-источнике семейства; показываются её столбцы.
  const data = dataFormOf(code);
  const df = FORM_BY_CODE.get(data)!;
  const es = (await c.tx.query(`select e.*, u.full_name as author from journal_entries e join users u on u.id = e.author_user_id
    where e.organization_id = $1 and e.site_id = $2 and e.form_code = $3 and e.occurred_at between ${periodSql(4, 5, 6)}
      and not exists (select 1 from journal_entries x where x.corrects_id = e.id) order by e.occurred_at`, [c.orgId, c.siteId, data, c.from, c.to, c.tz])).rows;
  const rows = es.map((e) => df.columns.map((col, i) => {
    const v = e.values?.[String(i)] ?? '';
    return i === df.columns.length - 1 && (e.corrects_id || e.is_late) ? [v, e.corrects_id ? `исправлено: ${e.correction_reason}` : '', e.is_late ? `внесено ${fmtDT(e.entered_at, tz)}` : ''].filter(Boolean).join('; ') : String(v);
  }));
  return { columns: df.columns, rows };
}

function contentHash(columns: string[], rows: string[][]) {
  return createHash('sha256').update(JSON.stringify({ columns, rows })).digest('hex');
}

export async function getJournal(userId: string, orgId: string, code: string, input: unknown) {
  const f = FORM_BY_CODE.get(code);
  if (!f) throw Errors.notFound('Форма журнала не найдена.');
  const p = parse(PeriodInput, input);
  return inOrg(userId, orgId, 'journal.read', async (tx) => {
    const site = await getSite(tx, orgId, p.siteId);
    const org = (await tx.query(`select name, legal_form, timezone from organizations where id = $1`, [orgId])).rows[0];
    const src = AUTO[code] || null;
    const built = await buildRows({ tx, orgId, siteId: p.siteId, tz: org.timezone, from: p.from, to: p.to }, code, src);
    const hash = contentHash(built.columns, built.rows);
    const signoffs = (await tx.query(`select s.*, u.full_name as signer from journal_signoffs s join users u on u.id = s.signed_by
      where s.organization_id = $1 and s.site_id = $2 and s.form_code = $3 and s.period_from = $4 and s.period_to = $5 order by s.signed_at desc`, [orgId, p.siteId, code, p.from, p.to])).rows
      .map((s) => ({ ...s, valid: s.content_hash === hash }));
    const blockers = await signBlockers(tx, orgId, p.siteId, src, p, org.timezone);
    return {
      form: { ...listForms().find((x) => x.code === code)! }, organization: org, site,
      period: p, columns: built.columns, rows: built.rows, grid: !!built.grid, content_hash: hash, signoffs, blockers,
    };
  }, p.siteId);
}

async function signBlockers(tx: Tx, orgId: string, siteId: string, src: Source | null, p: Period, tz: string): Promise<string[]> {
  const kinds = src ? INC_BLOCK[src] : null;
  if (!kinds) return [];
  const open = (await tx.query(`select title from incidents where organization_id = $1 and site_id = $2 and status <> 'closed' and kind = any($3::text[])
    and created_at between ${periodSql(4, 5, 6)} order by created_at`, [orgId, siteId, kinds, p.from, p.to, tz])).rows;
  return open.map((o) => `Открыто отклонение: ${o.title}`);
}

export async function signJournal(userId: string, orgId: string, code: string, input: unknown) {
  const d = parse(z.object({ siteId: z.uuid(), from: z.iso.date(), to: z.iso.date(), contentHash: z.string().length(64), note: optText(500) }), input);
  const j = await getJournal(userId, orgId, code, d);
  return inOrg(userId, orgId, 'journal.sign', async (tx) => {
    if (j.blockers.length) throw Errors.conflict(`Подписать нельзя, пока в журнале есть проблемы: ${j.blockers.join('; ')}.`);
    if (j.content_hash !== d.contentHash) throw Errors.conflict('Журнал изменился, пока вы его просматривали. Обновите и проверьте ещё раз.');
    const s = (await tx.query(`insert into journal_signoffs (organization_id, site_id, form_code, period_from, period_to, rows_count, content_hash, note, signed_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [orgId, d.siteId, code, d.from, d.to, j.rows.length, j.content_hash, d.note, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'journal.sign', entityType: 'journal', entityId: s.id,
      after: { form: code, from: d.from, to: d.to, rows: j.rows.length, hash: j.content_hash } });
    return s;
  }, d.siteId);
}

const EntryInput = z.object({
  siteId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  values: z.record(z.string().regex(/^\d+$/), z.string().trim().max(500)),
});

/** Ручная запись. Время выполнения — отдельно от времени внесения; позже 15 минут — «поздняя»; старше суток — нельзя. */
export async function addEntry(userId: string, orgId: string, code: string, input: unknown) {
  const f = FORM_BY_CODE.get(code);
  if (!f) throw Errors.notFound('Форма журнала не найдена.');
  if (AUTO[code]) throw Errors.conflict(`Журнал ${code} заполняется автоматически из событий — внесите само событие (замер, приёмку), а не строку журнала.`);
  const d = parse(EntryInput, input);
  const data = dataFormOf(code);
  const cols = FORM_BY_CODE.get(data)!.columns;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.values)) if (Number(k) < cols.length && v) values[k] = v;
  if (Object.keys(values).length < 2) throw Errors.validation('Заполните хотя бы два столбца записи.');
  return inOrg(userId, orgId, 'journal.record', async (tx) => {
    await getSite(tx, orgId, d.siteId);
    const now = Date.now();
    const at = d.occurredAt ? new Date(d.occurredAt) : new Date(now);
    if (at.getTime() > now + 2 * 60e3) throw Errors.validation('Время выполнения не может быть в будущем.');
    if (now - at.getTime() > 24 * 3600e3) throw Errors.validation('Запись старше суток внести нельзя — пропущенные записи задним числом не создаются.');
    const late = now - at.getTime() > 15 * 60e3;
    const e = (await tx.query(`insert into journal_entries (organization_id, site_id, form_code, occurred_at, is_late, values, author_user_id) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [orgId, d.siteId, data, at, late, JSON.stringify(values), userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: 'journal.entry', entityType: 'journal_entry', entityId: e.id, after: { form: data, values } });
    return e;
  }, d.siteId);
}

export async function correctEntry(userId: string, orgId: string, entryId: string, input: unknown) {
  const d = parse(z.object({ values: z.record(z.string().regex(/^\d+$/), z.string().trim().max(500)), reason: z.string().trim().min(5, 'Укажите причину исправления.').max(300) }), input);
  return inOrg(userId, orgId, 'journal.record', async (tx, m) => {
    const e = (await tx.query(`select * from journal_entries where id = $1 and organization_id = $2`, [entryId, orgId])).rows[0];
    if (!e) throw Errors.notFound('Запись не найдена.');
    assertSiteAccess(m, e.site_id);
    if ((await tx.query(`select 1 from journal_entries where corrects_id = $1`, [entryId])).rowCount) throw Errors.conflict('Запись уже исправлена — исправляйте последнюю версию.');
    const values = { ...e.values, ...d.values };
    const n = (await tx.query(`insert into journal_entries (organization_id, site_id, form_code, occurred_at, is_late, values, author_user_id, corrects_id, correction_reason)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [orgId, e.site_id, e.form_code, e.occurred_at, e.is_late, JSON.stringify(values), userId, e.id, d.reason])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: e.site_id, actorUserId: userId, action: 'journal.entry_correct', entityType: 'journal_entry', entityId: n.id, before: e.values, after: values, reason: d.reason });
    return n;
  });
}

export async function listEntries(userId: string, orgId: string, code: string, siteIdInput: unknown) {
  if (!FORM_BY_CODE.get(code)) throw Errors.notFound('Форма журнала не найдена.');
  const siteId = parse(z.uuid('Укажите точку.'), siteIdInput);
  const data = dataFormOf(code);
  return inOrg(userId, orgId, 'journal.read', async (tx) => (await tx.query(`select e.id, e.occurred_at, e.entered_at, e.is_late, e.values, e.corrects_id, e.correction_reason, u.full_name as author
    from journal_entries e join users u on u.id = e.author_user_id where e.organization_id = $1 and e.site_id = $2 and e.form_code = $3
      and not exists (select 1 from journal_entries x where x.corrects_id = e.id) order by e.occurred_at desc limit 50`, [orgId, siteId, data])).rows, siteId);
}

/** Выгрузка: CSV (для Excel — «;» и BOM) или печатная HTML-форма по образцу шаблона. */
export function toCsv(j: { columns: string[]; rows: string[][] }) {
  const q = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [j.columns, ...j.rows].map((r) => r.map(q).join(';')).join('\r\n');
}

export function toHtml(j: Awaited<ReturnType<typeof getJournal>>) {
  const e = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const sign = j.signoffs.find((s) => s.valid);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${e(j.form.code)} ${e(j.form.name)}</title>
<style>@page{size:A4 ${j.grid || j.columns.length > 9 ? 'landscape' : 'portrait'};margin:12mm}body{font:10pt/1.35 Arial,sans-serif;color:#111}
.hdr{display:flex;justify-content:space-between;font-size:9pt;border-bottom:1px solid #444;padding-bottom:4px}h1{font-size:13pt;text-align:center;margin:10px 0 2px}
.sub{text-align:center;font-size:9pt;color:#444;margin-bottom:8px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #555;padding:3px 4px;font-size:${j.grid ? '7.5' : '8.5'}pt;vertical-align:top}
th{background:#eee}.foot{margin-top:14px;font-size:8.5pt;display:flex;justify-content:space-between;gap:20px}.hash{font-size:7pt;color:#666;word-break:break-all}</style></head><body>
<div class="hdr"><span>${e(j.organization.legal_form || '')} «${e(j.organization.name)}» · ${e(j.site.name)}</span><span>СИСТЕМА ХАССП</span><span>Начат: ${e(j.period.from.split('-').reverse().join('.'))} · Окончен: ${e(j.period.to.split('-').reverse().join('.'))}</span></div>
<h1>${e(j.form.name.toUpperCase())}</h1><div class="sub">${e(j.form.code)} · ${e(j.form.purpose)}${j.form.shares_with ? ` · данные журнала ${e(j.form.shares_with)}` : ''}</div>
<table><thead><tr>${j.columns.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>
${j.rows.length ? j.rows.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('\n') : `<tr><td colspan="${j.columns.length}" style="text-align:center">Записей за период нет</td></tr>`}
</tbody></table>
<div class="foot"><span>${sign ? `Подписано: ${e(sign.signer)}, ${e(new Date(sign.signed_at).toLocaleString('ru-RU', { timeZone: j.organization.timezone }))}` : 'Ответственный: ____________________ / ____________________'}</span><span>Записей: ${j.rows.length}</span></div>
<div class="hash">Контрольная сумма содержимого (SHA-256): ${e(j.content_hash)}</div></body></html>`;
}
