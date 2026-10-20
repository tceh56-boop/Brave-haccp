import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, optText, assertSiteAccess, getSite, fmtNum } from './common';
import { criterionText } from './control';
import { expiryState, EXPIRY_LABEL, LOT_STATUS_LABEL } from './lots';
import { STATUS_LABEL as INC_STATUS } from './incidents';
import { approvedPlan, PLAN_STATUS } from './haccp';

/**
 * Журналы ХАССП J01–J53 (книга «Журналы_J01-J53.xlsx»). ТЗ v2 §0, §12: запись делается один раз — журнал
 * собирается из событий системы. Пересекающиеся формы (J01 ↔ J25 ↔ J42, J03 ↔ J21 ↔ J39 …) — разные
 * печатные виды одних и тех же данных. Где событий пока нет — ручная запись по столбцам шаблона,
 * одна на семейство форм. Подпись за период хранит хеш содержимого; подписать нельзя при открытых
 * отклонениях периода (механика MON CHEF «подписать журнал нельзя, пока в нём есть проблемы»).
 */

interface FormDef { code: string; name: string; purpose: string; fill: string; overlaps: string[]; columns: string[] }
import formsJson from '../../../data/reference/journal_forms.json';
const FORMS: FormDef[] = (formsJson as { forms: FormDef[] }).forms;
export const FORM_BY_CODE = new Map(FORMS.map((f) => [f.code, f]));

type Source = 'cold' | 'cold_grid' | 'room' | 'room_grid' | 'receipt' | 'lots' | 'incidents' | 'plans' | 'hazards' | 'plan';
/** Формы, собираемые из событий. Остальные — ручная запись. */
const AUTO: Record<string, Source> = {
  J01: 'cold', J25: 'cold', J42: 'cold_grid', J04: 'room', J43: 'room_grid',
  J03: 'receipt', J21: 'receipt', J39: 'receipt', J05: 'lots', J29: 'lots', J34: 'incidents',
  J30: 'plans', J31: 'hazards', J32: 'plan',   // реестры из плана ХАССП (не зависят от периода)
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
  receipt: ['receipt_problem'], lots: ['expired_lot'], incidents: ['temperature_deviation', 'receipt_problem', 'expired_lot', 'reported'],
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
const INC_KIND: Record<string, string> = { temperature_deviation: 'Температура вне предела', receipt_problem: 'Приёмка', expired_lot: 'Истёк срок', reported: 'Сообщение сотрудника' };

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
