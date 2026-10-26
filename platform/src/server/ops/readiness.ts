import { z } from 'zod';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, getSite } from './common';
import { measurementDue } from './control';
import { securityChecks } from './security';
import { lastVerifiedBackup } from './backup';
import { mailHealth } from '../mail/sender';
import { requiredContractsState } from './contracts';

/**
 * Готовность к пилоту и решение Go/No-Go (этап 8 ТЗ v2, раздел 16 «Definition of Done»).
 * Проверки из данных системы + ручные подтверждения того, что система проверить не может (блокеры Б-4…Б-7
 * аудита этапа 0). «Запускаем» нельзя при любой проверке со статусом «не готово»: критический провал
 * безопасности или целостности блокирует запуск (AT-16). Решение хранит снимок проверок и не меняется.
 */

export type Status = 'pass' | 'warn' | 'fail';
export interface ReadinessCheck { key: string; group: string; title: string; status: Status; detail: string; href?: string; manual?: boolean; confirmation?: { by: string; at: string; evidence: string } | null }

export const CONFIRMATIONS: { key: string; title: string; required: boolean; hint: string }[] = [
  { key: 'norms_verified', required: true, title: 'Тексты нормативов и пункты реестра сверены специалистом с официальными публикациями (Б-4)', hint: 'Кто сверял, с какими публикациями (номера, даты).' },
  { key: 'pd_officer', required: true, title: 'Назначен ответственный за персональные данные, утверждена политика обработки, сотрудники ознакомлены (Б-6, 152-ФЗ, AT-15)', hint: 'Приказ о назначении, политика, листы ознакомления.' },
  { key: 'training', required: true, title: 'Сотрудники пилота прошли инструктаж по памяткам своих ролей', hint: 'Дата инструктажа, кто проводил, список сотрудников.' },
  { key: 'paper_fallback', required: true, title: 'Есть порядок работы при недоступности системы: бумажные журналы и перенос записей с пометкой «внесено позже»', hint: 'Где лежат бланки, кто отвечает за перенос.' },
  { key: 'primary_docs', required: false, title: 'Бухгалтер и юрист проверили документы, используемые как первичные (402-ФЗ), — или такие документы в пилоте не используются (Б-7, AT-14)', hint: 'Заключение бухгалтера/юриста или решение не использовать.' },
  { key: 'kkt', required: false, title: 'Касса пилота пробивает чеки на ККТ предприятия (54-ФЗ); система ККТ не заменяет', hint: 'Модель ККТ, порядок пробития чека и возврата.' },
  { key: 'kbju', required: false, title: 'КБЖУ из справочника не используется для маркировки до проверки специалистом (Б-5)', hint: 'Кто отвечает за маркировку и по каким данным.' },
];

const DAY = 86400e3;

export async function getReadiness(userId: string, orgId: string, siteIdInput?: unknown) {
  const siteId = siteIdInput ? parse(z.uuid(), siteIdInput) : null;
  const security = await securityChecks();
  const backup = await lastVerifiedBackup();
  const mail = await mailHealth();
  return inOrg(userId, orgId, 'pilot.read', async (tx) => {
    const checks: ReadinessCheck[] = [];
    const add = (c: ReadinessCheck) => checks.push(c);
    const base = `/app/${orgId}`;
    if (siteId) await getSite(tx, orgId, siteId);
    const sites = (await tx.query(`select id, name from sites where organization_id = $1 and status = 'active' and ($2::uuid is null or id = $2)`, [orgId, siteId])).rows;
    const siteIds = sites.map((s) => s.id);

    // Организация и команда
    const org = (await tx.query(`select legal_form, inn from organizations where id = $1`, [orgId])).rows[0];
    add({ key: 'requisites', group: 'Организация и команда', title: 'Реквизиты организации', status: org.legal_form && org.inn ? 'pass' : 'warn',
      detail: org.legal_form && org.inn ? `${org.legal_form}, ИНН ${org.inn}` : 'Не указаны форма или ИНН — нужны для печатных форм и пакета проверки.', href: base });
    const contracts = await requiredContractsState(tx, orgId, siteIds);
    const badC = contracts.filter((c) => !['ok', 'expiring'].includes(c.state));
    add({ key: 'contracts', group: 'Организация и команда', title: 'Договоры для ППК: дезинсекция и дератизация, лаборатория, вывоз отходов — действуют и загружены файлом',
      status: badC.length ? 'warn' : contracts.some((c) => c.state === 'expiring') ? 'warn' : 'pass',
      detail: contracts.map((c) => `${c.label}: ${c.detail}`).join('; '), href: `${base}/contracts` });
    const roles = (await tx.query(`select role, count(*)::int as n from memberships where organization_id = $1 and status = 'active' group by role`, [orgId])).rows;
    const n = (rs: string[]) => roles.filter((r) => rs.includes(r.role)).reduce((s, r) => s + r.n, 0);
    const confirmers = n(['owner', 'enterprise_admin', 'director', 'chef', 'haccp_lead']);
    add({ key: 'team', group: 'Организация и команда', title: 'Ответственные: двое могут работать с отклонениями и подтверждать закрытие', status: confirmers >= 2 ? 'pass' : 'fail',
      detail: `руководителей и ответственных: ${confirmers}; сотрудников смены: ${n(['line_staff', 'storekeeper', 'cashier'])}. Закрытие отклонения подтверждает другой человек.`, href: base });

    // Контроль
    const objects = (await tx.query(`select o.id, o.name, r.id as rule_id, r.frequency_hours, r.grace_minutes,
        (select json_build_object('measured_at', m.measured_at) from measurements m where m.control_object_id = o.id order by m.measured_at desc limit 1) as last
      from control_objects o left join control_rules r on r.control_object_id = o.id and r.status = 'approved'
      where o.organization_id = $1 and o.status = 'active' and o.site_id = any($2::uuid[])`, [orgId, siteIds])).rows;
    const noRule = objects.filter((o) => !o.rule_id).map((o) => o.name);
    add({ key: 'objects', group: 'Контроль и ХАССП', title: 'Объекты контроля с утверждёнными правилами', status: !objects.length ? 'fail' : noRule.length ? 'warn' : 'pass',
      detail: !objects.length ? 'Нет объектов контроля.' : noRule.length ? `без утверждённого правила: ${noRule.join(', ')}` : `объектов: ${objects.length}`, href: `${base}/setup` });
    const missed = objects.filter((o) => o.rule_id && measurementDue(o).state === 'missed').map((o) => o.name);
    add({ key: 'measurements', group: 'Контроль и ХАССП', title: 'Замеры идут по графику', status: missed.length ? 'warn' : 'pass',
      detail: missed.length ? `пропущены: ${missed.join(', ')}` : 'пропусков нет', href: `${base}/problems` });
    const plan = (await tx.query(`select version, approved_at from haccp_plans where organization_id = $1 and status = 'approved'`, [orgId])).rows[0];
    add({ key: 'haccp', group: 'Контроль и ХАССП', title: 'План ХАССП утверждён', status: plan ? 'pass' : 'fail',
      detail: plan ? `версия ${plan.version}` : 'Нет утверждённого плана ХАССП.', href: `${base}/haccp` });
    const reg = (await tx.query(`select count(*) filter (where workflow_status = 'approved')::int as approved, count(*) filter (where workflow_status = 'approved' and next_check_at < current_date)::int as overdue,
        count(*) filter (where workflow_status in ('draft', 'needs_review', 'checked'))::int as pending from reg_source_versions where organization_id = $1`, [orgId])).rows[0];
    add({ key: 'regulatory', group: 'Контроль и ХАССП', title: 'Нормативный реестр: утверждённые редакции, проверки актуальности в срок',
      status: !reg.approved ? 'warn' : reg.overdue ? 'warn' : 'pass',
      detail: `утверждено: ${reg.approved}; просрочена проверка: ${reg.overdue}; ждут проверки: ${reg.pending}`, href: `${base}/regulatory` });
    const crit = (await tx.query(`select count(*)::int as n from incidents where organization_id = $1 and status <> 'closed' and severity = 'critical' and (site_id is null or site_id = any($2::uuid[]))`, [orgId, siteIds])).rows[0].n;
    const openInc = (await tx.query(`select count(*)::int as n from incidents where organization_id = $1 and status <> 'closed' and (site_id is null or site_id = any($2::uuid[]))`, [orgId, siteIds])).rows[0].n;
    add({ key: 'incidents', group: 'Контроль и ХАССП', title: 'Нет открытых критических отклонений', status: crit ? 'fail' : openInc ? 'warn' : 'pass',
      detail: `критических: ${crit}; всего открытых: ${openInc}`, href: `${base}/problems` });
    const capa = (await tx.query(`select count(*)::int as n from capas where organization_id = $1 and status in ('open', 'in_progress') and due_at < current_date`, [orgId])).rows[0].n;
    add({ key: 'capa', group: 'Контроль и ХАССП', title: 'Нет просроченных CAPA', status: capa ? 'warn' : 'pass', detail: `просрочено: ${capa}`, href: `${base}/capa` });
    const signed = (await tx.query(`select count(*)::int as n from journal_signoffs where organization_id = $1 and signed_at > now() - interval '7 days'`, [orgId])).rows[0].n;
    add({ key: 'journals', group: 'Контроль и ХАССП', title: 'Журналы подписываются ответственным', status: signed ? 'pass' : 'warn',
      detail: signed ? `подписей за 7 дней: ${signed}` : 'За 7 дней нет подписанных журналов.', href: `${base}/journals` });

    // Меню и продажи
    const dishes = (await tx.query(`select count(*) filter (where not exists (select 1 from ttk_versions v where v.dish_id = d.id and v.status = 'approved'))::int as no_ttk, count(*)::int as total
      from dishes d where d.organization_id = $1 and d.status = 'active' and d.kind = 'dish' and d.sale_price > 0`, [orgId])).rows[0];
    const queue = (await tx.query(`select count(*)::int as n from sales where organization_id = $1 and fulfil_status in ('failed', 'no_ttk', 'unmatched')`, [orgId])).rows[0].n;
    if (dishes.total || queue) {
      add({ key: 'ttk', group: 'Меню и продажи', title: 'У блюд в продаже есть утверждённые ТТК; очередь списания пуста', status: dishes.no_ttk || queue ? 'warn' : 'pass',
        detail: `блюд в продаже: ${dishes.total}, без утверждённой ТТК: ${dishes.no_ttk}; продаж не списано: ${queue}`, href: `${base}/sales` });
    }

    // Надёжность и безопасность
    const backupAge = backup?.verified_at ? Date.now() - new Date(backup.verified_at).getTime() : null;
    add({ key: 'backup', group: 'Надёжность и безопасность', title: 'Резервная копия с проверенным восстановлением (не старше 7 дней)',
      status: backup?.verify_ok && backupAge !== null && backupAge < 7 * DAY ? 'pass' : 'fail',
      detail: !backup ? 'Копий нет: выполните npm run backup и npm run backup:verify.' : !backup.verified_at ? 'Последняя копия не проверена восстановлением.'
        : !backup.verify_ok ? 'Последняя проверка восстановления не прошла.' : `проверено ${new Date(backup.verified_at).toLocaleString('ru-RU')}` });
    add({ key: 'mail', group: 'Надёжность и безопасность', title: 'Письма доходят: подтверждение почты, приглашения, восстановление пароля',
      status: mail.stuck || mail.dead ? 'fail' : process.env.SMTP_URL ? 'pass' : 'warn',
      detail: mail.stuck || mail.dead ? `не отправлено дольше 30 минут: ${mail.stuck}; с исчерпанными попытками: ${mail.dead} — проверьте SMTP и npm run mail:watch`
        : process.env.SMTP_URL ? `отправлено за 7 дней: ${mail.sent_week}` : 'SMTP_URL не задан — письма копятся в очереди; для пилота подключите почтовый сервер и npm run mail:watch' });
    for (const c of security.checks) {
      add({ key: `security_${c.key}`, group: 'Надёжность и безопасность', title: c.title, status: c.ok ? 'pass' : c.severity === 'critical' ? 'fail' : 'warn', detail: c.detail || 'в порядке' });
    }
    const chain = await audit.verifyChain(tx, orgId);
    add({ key: 'audit_chain', group: 'Надёжность и безопасность', title: 'Журнал аудита организации не нарушен', status: chain.ok ? 'pass' : 'fail',
      detail: chain.ok ? `записей: ${chain.checked}` : `цепочка нарушена на записи ${chain.brokenAt}` });

    // Ручные подтверждения
    const conf = (await tx.query(`select distinct on (c.key) c.key, c.confirmed, c.evidence, c.created_at, u.full_name from pilot_confirmations c join users u on u.id = c.user_id
      where c.organization_id = $1 order by c.key, c.created_at desc`, [orgId])).rows;
    const hasPos = (await tx.query(`select 1 from pos_shifts where organization_id = $1 limit 1`, [orgId])).rowCount;
    for (const k of CONFIRMATIONS) {
      const c = conf.find((x) => x.key === k.key && x.confirmed);
      const required = k.required || (k.key === 'kkt' && !!hasPos);
      add({ key: `confirm_${k.key}`, group: 'Подтверждения ответственных', title: k.title, manual: true, status: c ? 'pass' : required ? 'fail' : 'warn',
        detail: c ? c.evidence : required ? `Не подтверждено. ${k.hint}` : `Не подтверждено (необязательно для запуска). ${k.hint}`,
        confirmation: c ? { by: c.full_name, at: c.created_at, evidence: c.evidence } : null });
    }

    const decisions = (await tx.query(`select d.id, d.decision, d.note, d.created_at, u.full_name, d.site_id,
        (select count(*) from jsonb_array_elements(d.checks) x where x->>'status' = 'fail')::int as fails
      from pilot_decisions d join users u on u.id = d.user_id where d.organization_id = $1 order by d.created_at desc limit 20`, [orgId])).rows;
    const counts = { pass: checks.filter((c) => c.status === 'pass').length, warn: checks.filter((c) => c.status === 'warn').length, fail: checks.filter((c) => c.status === 'fail').length };
    return { checks, counts, can_go: counts.fail === 0, decisions, site: siteId ? sites[0] : null };
  }, siteId);
}

export async function confirm(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ key: z.enum(CONFIRMATIONS.map((c) => c.key) as [string, ...string[]]), confirmed: z.boolean().default(true),
    evidence: z.string().trim().min(10, 'Укажите, кем и каким документом подтверждено.').max(1000) }), input);
  return inOrg(userId, orgId, 'pilot.confirm', async (tx) => {
    const r = (await tx.query(`insert into pilot_confirmations (organization_id, key, confirmed, evidence, user_id) values ($1, $2, $3, $4, $5) returning id`, [orgId, d.key, d.confirmed, d.evidence, userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: d.confirmed ? 'pilot.confirm' : 'pilot.revoke', entityType: 'pilot_confirmation', entityId: r.id, after: d });
    return { ok: true };
  });
}

/** Решение: «запускаем» — только без проверок «не готово»; «не запускаем» — всегда, с причиной. Снимок проверок сохраняется. */
export async function decideGo(userId: string, orgId: string, input: unknown) {
  const d = parse(z.object({ decision: z.enum(['go', 'no_go']), note: z.string().trim().min(10, 'Опишите решение и условия.').max(2000), siteId: z.uuid().nullable().optional() }), input);
  const r = await getReadiness(userId, orgId, d.siteId || undefined);
  return inOrg(userId, orgId, 'pilot.decide', async (tx) => {
    if (d.decision === 'go' && !r.can_go) {
      throw Errors.conflict(`Запуск невозможен: не готово — ${r.checks.filter((c) => c.status === 'fail').map((c) => c.title).join('; ')}.`);
    }
    const row = (await tx.query(`insert into pilot_decisions (organization_id, site_id, decision, note, checks, user_id) values ($1, $2, $3, $4, $5, $6) returning id, created_at`,
      [orgId, d.siteId || null, d.decision, d.note, JSON.stringify(r.checks.map(({ key, title, status, detail }) => ({ key, title, status, detail }))), userId])).rows[0];
    await audit.record(tx, { organizationId: orgId, siteId: d.siteId, actorUserId: userId, action: `pilot.${d.decision}`, entityType: 'pilot_decision', entityId: row.id, after: { counts: r.counts }, reason: d.note });
    return { id: row.id, decision: d.decision, counts: r.counts };
  });
}
