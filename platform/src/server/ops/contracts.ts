import { z } from 'zod';
import type { Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import type { Membership } from '../access/guard';
import { inOrg, parse, optText, openTask, closeTasksFor, assertSiteAccess, getSite } from './common';

/**
 * Договоры предприятия (ППК: паспорт объекта, дезинсекция и дератизация, лабораторный контроль, вывоз отходов).
 *  - Реквизиты: вид, контрагент и ИНН, номер, даты, срок действия, предмет. Правка — с записью в аудит.
 *  - Файл договора (скан PDF, фото, DOCX) — доказательство: добавляется, но не удаляется и не заменяется.
 *  - Срок действия: за 30 дней до окончания — задача «продлить договор». Бессрочный — без задачи.
 *  - Расторжение — статус с датой и причиной; расторгнутый договор не меняется.
 * Договор без файла считается «не подтверждён»: в ППК и готовности он не засчитывается.
 */

export const KIND_LABEL: Record<string, string> = {
  pest_control: 'Дезинсекция и дератизация', lab: 'Лабораторные исследования', waste: 'Вывоз отходов (ТКО, пищевые)', lease: 'Аренда помещения',
  water: 'Водоснабжение и водоотведение', laundry: 'Стирка спецодежды', ventilation: 'Обслуживание вентиляции', equipment_service: 'Обслуживание оборудования',
  medical: 'Медосмотры работников', disinfection: 'Дезинфекция', grease_trap: 'Чистка жироуловителя', other: 'Прочее',
};
/** Договоры, без которых раздел ППК не закрыть. */
export const REQUIRED_KINDS = ['pest_control', 'lab', 'waste'] as const;
const KINDS = Object.keys(KIND_LABEL) as [string, ...string[]];
const WARN_DAYS = 30;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД.');
const ddmm = (s: string) => s.slice(0, 10).split('-').reverse().join('.');
const addDays = (s: string, n: number) => { const t = new Date(`${s}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

const COLS = `c.*, c.signed_on::text as signed_on, c.valid_from::text as valid_from, c.valid_to::text as valid_to, c.terminated_on::text as terminated_on,
  s.name as site_name, (select count(*)::int from evidence_files f where f.organization_id = c.organization_id and f.entity_type = 'contract' and f.entity_id = c.id) as files`;

async function todayOf(tx: Tx, orgId: string) {
  return (await tx.query(`select (now() at time zone timezone)::date::text as d from organizations where id = $1`, [orgId])).rows[0].d as string;
}

export type ContractState = 'ok' | 'expiring' | 'expired' | 'no_file' | 'terminated' | 'not_started';
export function stateOf(c: { status: string; valid_from: string | null; valid_to: string | null; files: number }, today: string): { state: ContractState; label: string } {
  if (c.status === 'terminated') return { state: 'terminated', label: 'расторгнут' };
  if (c.valid_to && c.valid_to < today) return { state: 'expired', label: `истёк ${ddmm(c.valid_to)}` };
  if (!c.files) return { state: 'no_file', label: 'нет файла договора' };
  if (c.valid_from && c.valid_from > today) return { state: 'not_started', label: `действует с ${ddmm(c.valid_from)}` };
  if (c.valid_to && addDays(today, WARN_DAYS) >= c.valid_to) return { state: 'expiring', label: `истекает ${ddmm(c.valid_to)}` };
  return { state: 'ok', label: c.valid_to ? `до ${ddmm(c.valid_to)}` : 'бессрочный' };
}

const Input = z.object({
  siteId: z.uuid().optional().nullable(),
  kind: z.enum(KINDS, { message: 'Выберите вид договора.' }),
  title: optText(200),
  counterparty: z.string().trim().min(2, 'Укажите контрагента.').max(300),
  counterpartyInn: z.string().trim().regex(/^(\d{10}|\d{12})$/, 'ИНН — 10 или 12 цифр.').optional().nullable().or(z.literal('').transform(() => null)),
  number: optText(100), signedOn: day.optional().nullable().or(z.literal('').transform(() => null)),
  validFrom: day.optional().nullable().or(z.literal('').transform(() => null)), validTo: day.optional().nullable().or(z.literal('').transform(() => null)),
  autoRenew: z.boolean().optional(), subject: optText(2000),
});

function checkDates(d: { validFrom?: string | null; validTo?: string | null }) {
  if (d.validFrom && d.validTo && d.validTo < d.validFrom) throw Errors.validation('Дата окончания раньше даты начала.');
}

/** Задача продления: за 30 дней до окончания; бессрочный, с автопролонгацией или расторгнутый — без задачи. */
async function armExpiry(tx: Tx, orgId: string, c: { id: string; site_id: string | null; kind: string; counterparty: string; number: string | null; valid_to: string | null; auto_renew: boolean; status: string }, userId: string) {
  await closeTasksFor(tx, orgId, 'contract_renew', c.id, userId, 'срок договора изменён');
  if (c.status !== 'active' || !c.valid_to || c.auto_renew) return;
  await openTask(tx, { orgId, siteId: c.site_id, kind: 'contract_renew', entityType: 'contract', entityId: c.id, assigneeRole: 'director',
    title: `Продлить договор «${KIND_LABEL[c.kind]}» — ${c.counterparty}${c.number ? `, № ${c.number}` : ''}`,
    details: `Договор действует до ${ddmm(c.valid_to)}. Без действующего договора раздел ППК не закрывается.`,
    dueAt: new Date(`${addDays(c.valid_to, -WARN_DAYS)}T09:00:00Z`) });
}

async function getRow(tx: Tx, orgId: string, m: Membership, id: string) {
  const c = (await tx.query<ContractRow>(`select ${COLS} from contracts c left join sites s on s.id = c.site_id where c.id = $1 and c.organization_id = $2`, [id, orgId])).rows[0];
  if (!c) throw Errors.notFound('Договор не найден.');
  if (c.site_id) assertSiteAccess(m, c.site_id);
  return c;
}

export interface ContractRow {
  id: string; organization_id: string; site_id: string | null; site_name: string | null; kind: string; title: string; counterparty: string; counterparty_inn: string | null; number: string | null;
  signed_on: string | null; valid_from: string | null; valid_to: string | null; auto_renew: boolean; subject: string | null; status: string; terminated_on: string | null; terminate_reason: string | null; files: number;
}
const view = (c: ContractRow, today: string) => ({ ...c, kind_label: KIND_LABEL[c.kind], ...stateOf(c, today) });

export async function listContracts(userId: string, orgId: string, siteIdInput?: unknown) {
  const siteId = siteIdInput ? parse(z.uuid(), siteIdInput) : null;
  return inOrg(userId, orgId, 'contract.read', async (tx, m) => {
    if (siteId) { await getSite(tx, orgId, siteId); assertSiteAccess(m, siteId); }
    const today = await todayOf(tx, orgId);
    const rows = (await tx.query<ContractRow>(`select ${COLS} from contracts c left join sites s on s.id = c.site_id
      where c.organization_id = $1 and ($2::uuid is null or c.site_id is null or c.site_id = $2) order by c.status, c.kind, c.valid_to nulls last`, [orgId, siteId])).rows
      .filter((c) => !c.site_id || m.site_ids.length === 0 || m.site_ids.includes(c.site_id));
    const list = rows.map((c) => view(c, today));
    const valid = (k: string) => list.some((c) => c.kind === k && ['ok', 'expiring'].includes(c.state));
    return { contracts: list, required: REQUIRED_KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k], covered: valid(k) })) };
  });
}

export async function getContract(userId: string, orgId: string, id: unknown) {
  const cid = parse(z.uuid(), id);
  return inOrg(userId, orgId, 'contract.read', async (tx, m) => view(await getRow(tx, orgId, m, cid), await todayOf(tx, orgId)));
}

export async function createContract(userId: string, orgId: string, input: unknown) {
  const d = parse(Input, input);
  checkDates(d);
  return inOrg(userId, orgId, 'contract.manage', async (tx, m) => {
    if (d.siteId) { await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId); }
    const c = (await tx.query(`insert into contracts (organization_id, site_id, kind, title, counterparty, counterparty_inn, number, signed_on, valid_from, valid_to, auto_renew, subject, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id, site_id, kind, counterparty, number, valid_to::text as valid_to, auto_renew, status`,
      [orgId, d.siteId || null, d.kind, d.title || KIND_LABEL[d.kind], d.counterparty, d.counterpartyInn || null, d.number, d.signedOn || null, d.validFrom || null, d.validTo || null, !!d.autoRenew, d.subject, userId])).rows[0];
    await armExpiry(tx, orgId, c, userId);
    await audit.record(tx, { organizationId: orgId, siteId: c.site_id, actorUserId: userId, action: 'contract.create', entityType: 'contract', entityId: c.id,
      after: { kind: d.kind, counterparty: d.counterparty, number: d.number, valid_to: d.validTo || null } });
    return { id: c.id };
  });
}

/** Правка реквизитов: передаются только изменяемые поля; продление — новая дата окончания. */
export async function updateContract(userId: string, orgId: string, id: unknown, input: unknown) {
  const cid = parse(z.uuid(), id);
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = parse(Input.partial(), input);
  return inOrg(userId, orgId, 'contract.manage', async (tx, m) => {
    const old = await getRow(tx, orgId, m, cid);
    if (old.status === 'terminated') throw Errors.conflict('Расторгнутый договор не изменяется — внесите новый.');
    if (d.siteId) { await getSite(tx, orgId, d.siteId); assertSiteAccess(m, d.siteId); }
    const map: [string, string, unknown][] = [['siteId', 'site_id', d.siteId || null], ['kind', 'kind', d.kind], ['title', 'title', d.title], ['counterparty', 'counterparty', d.counterparty],
      ['counterpartyInn', 'counterparty_inn', d.counterpartyInn || null], ['number', 'number', d.number], ['signedOn', 'signed_on', d.signedOn || null],
      ['validFrom', 'valid_from', d.validFrom || null], ['validTo', 'valid_to', d.validTo || null], ['autoRenew', 'auto_renew', !!d.autoRenew], ['subject', 'subject', d.subject]];
    const set = map.filter(([k]) => k in raw);
    if (!set.length) return { id: cid };
    if (set.some(([k]) => k === 'title') && !d.title) throw Errors.validation('Укажите наименование договора.');
    const next = { ...old, ...Object.fromEntries(set.map(([, col, v]) => [col, v])) };
    checkDates({ validFrom: next.valid_from, validTo: next.valid_to });
    await tx.query(`update contracts set ${set.map(([, col], i) => `${col} = $${i + 3}`).join(', ')} where id = $1 and organization_id = $2`, [cid, orgId, ...set.map(([, , v]) => v)]);
    if (set.some(([k]) => ['validTo', 'autoRenew', 'kind', 'counterparty', 'number', 'siteId'].includes(k))) await armExpiry(tx, orgId, { ...next, id: cid }, userId);
    await audit.record(tx, { organizationId: orgId, siteId: next.site_id, actorUserId: userId, action: 'contract.update', entityType: 'contract', entityId: cid,
      before: Object.fromEntries(set.map(([, col]) => [col, (old as unknown as Record<string, unknown>)[col]])), after: Object.fromEntries(set.map(([, col, v]) => [col, v])) });
    return { id: cid };
  });
}

const TerminateInput = z.object({ terminatedOn: day, reason: z.string().trim().min(3, 'Укажите причину расторжения.').max(500) });

export async function terminateContract(userId: string, orgId: string, id: unknown, input: unknown) {
  const cid = parse(z.uuid(), id);
  const d = parse(TerminateInput, input);
  return inOrg(userId, orgId, 'contract.manage', async (tx, m) => {
    const c = await getRow(tx, orgId, m, cid);
    if (c.status === 'terminated') throw Errors.conflict('Договор уже расторгнут.');
    await tx.query(`update contracts set status = 'terminated', terminated_on = $3, terminate_reason = $4 where id = $1 and organization_id = $2`, [cid, orgId, d.terminatedOn, d.reason]);
    await closeTasksFor(tx, orgId, 'contract_renew', cid, userId, `договор расторгнут: ${d.reason}`);
    await audit.record(tx, { organizationId: orgId, siteId: c.site_id, actorUserId: userId, action: 'contract.terminate', entityType: 'contract', entityId: cid,
      after: { terminated_on: d.terminatedOn, reason: d.reason } });
    return { id: cid };
  });
}

/** Для готовности и ППК: обязательные договоры площадки — действует и подтверждён файлом. */
export async function requiredContractsState(tx: Tx, orgId: string, siteIds: string[]) {
  const today = await todayOf(tx, orgId);
  const rows = (await tx.query(`select ${COLS} from contracts c left join sites s on s.id = c.site_id
    where c.organization_id = $1 and c.kind = any($2::text[]) and (c.site_id is null or c.site_id = any($3::uuid[]))`, [orgId, [...REQUIRED_KINDS], siteIds])).rows;
  return REQUIRED_KINDS.map((k) => {
    const mine = rows.filter((c) => c.kind === k).map((c) => ({ ...c, ...stateOf(c, today) }));
    const good = mine.find((c) => c.state === 'ok') || mine.find((c) => c.state === 'expiring');
    const any = mine.find((c) => c.state !== 'terminated');
    return { kind: k, label: KIND_LABEL[k], state: good ? good.state : any ? any.state : 'missing', detail: good ? `${good.counterparty}, ${good.label}` : any ? `${any.counterparty}: ${any.label}` : 'договор не внесён' };
  });
}
