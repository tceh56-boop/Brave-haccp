import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { z } from 'zod';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse, getSite } from './common';
import { listForms, getJournal, toCsv, toHtml } from './journals';
import { approvedPlan } from './haccp';
import { CAPA_STATUS } from './capa';
import { STATUS_LABEL as INC_STATUS, SEVERITY_LABEL } from './incidents';
import { ENTITY_LABEL } from './evidence';
import { validateEnterpriseReadiness, isBad, type RStatus } from '../readiness/engine';

export const R_STATUS: Record<RStatus, string> = { ok: 'выполнено', not_checked: 'не проверено', not_applicable: 'не применимо', missing: 'отсутствует', overdue: 'просрочено',
  expired: 'истёк срок', warning: 'предупреждение', incomplete: 'неполно', blocked: 'заблокировано' };

/**
 * Пакет для проверки (этап 5 ТЗ v2): один ZIP за период по площадке — сводка, журналы (CSV и печатный вид)
 * с отметкой о подписи, утверждённый план ХАССП, отклонения и CAPA, применимые требования, доказательства с
 * SHA-256 и файл контрольных сумм. Формулировка о соответствии — только допустимая по ТЗ v2 §16.
 */

const MAX_EVIDENCE_BYTES = 100 * 1024 * 1024;

/** Минимальный ZIP (метод «без сжатия», имена в UTF-8) — без внешних зависимостей. */
export function zip(files: { name: string; data: Buffer }[], at = new Date()): Buffer {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1);
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(f.data.length, 18); h.writeUInt32LE(f.data.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, f.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

const e = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const safe = (s: string) => s.replace(/[\\/:*?"<>|\r\n\0]/g, '_').slice(0, 120);

const PackInput = z.object({ siteId: z.uuid(), from: z.iso.date(), to: z.iso.date() }).refine((p) => p.to >= p.from, 'Конец периода раньше начала.')
  .refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / 86400e3 <= 92, 'Период — не больше трёх месяцев.');

export async function buildPack(userId: string, orgId: string, input: unknown) {
  const p = parse(PackInput, input);
  // Права и площадка — до сборки.
  const head = await inOrg(userId, orgId, 'pack.export', async (tx) => {
    const site = await getSite(tx, orgId, p.siteId);
    const org = (await tx.query(`select name, legal_form, inn, timezone from organizations where id = $1`, [orgId])).rows[0];
    const me = (await tx.query(`select full_name from users where id = $1`, [userId])).rows[0];
    return { site, org, me };
  }, p.siteId);
  const tz = head.org.timezone;
  const fmt = (ts: string | Date | null) => (ts ? new Date(ts).toLocaleString('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const files: { name: string; data: Buffer }[] = [];

  // Журналы: все автоматические формы и ручные — если за период есть записи (формы-«виды» общих данных не дублируются).
  const journals: { code: string; name: string; rows: number; sign: string; file: string | null }[] = [];
  for (const f of listForms()) {
    if (f.mode === 'manual' && f.shares_with) continue;
    const j = await getJournal(userId, orgId, f.code, p);
    if (f.mode === 'manual' && !j.rows.length) continue;
    const valid = j.signoffs.find((s) => s.valid);
    const sign = valid ? `подписан: ${valid.signer}, ${fmt(valid.signed_at)}` : j.signoffs.length ? 'изменён после подписи' : j.blockers.length ? `не подписан: открытые отклонения (${j.blockers.length})` : 'не подписан';
    let file: string | null = null;
    if (j.rows.length) {
      file = `journals/${f.code}.html`;
      files.push({ name: file, data: Buffer.from(toHtml(j), 'utf8') }, { name: `journals/${f.code}.csv`, data: Buffer.from(toCsv(j), 'utf8') });
    }
    journals.push({ code: f.code, name: f.name, rows: j.rows.length, sign, file });
  }

  const data = await inOrg(userId, orgId, 'pack.export', async (tx) => {
    const per = `between (($2::date)::timestamp at time zone $4) and ((($3::date) + 1)::timestamp at time zone $4)`;
    const plan = await approvedPlan(tx, orgId);
    const incidents = (await tx.query(`select i.*, k.id as capa_id, k.status as capa_status from incidents i left join capas k on k.incident_id = i.id
      where i.organization_id = $1 and (i.site_id = $5 or i.site_id is null) and (i.created_at ${per} or (i.status <> 'closed' and i.created_at < (($3::date) + 1)::timestamp at time zone $4))
      order by i.created_at`, [orgId, p.from, p.to, tz, p.siteId])).rows;
    const capas = (await tx.query(`select c.*, u.full_name as responsible, v.full_name as verifier from capas c left join users u on u.id = c.responsible_user_id left join users v on v.id = c.verified_by
      where c.organization_id = $1 and (c.site_id = $5 or c.site_id is null) and (c.created_at ${per} or c.verified_at ${per} or c.status <> 'closed') order by c.created_at`, [orgId, p.from, p.to, tz, p.siteId])).rows;
    const reqs = (await tx.query(`select s.code, r.clause, r.text, v.edition, v.workflow_status, v.effective_from, v.next_check_at, a.rationale
      from reg_applicability a join reg_requirements r on r.id = a.requirement_id join reg_source_versions v on v.id = r.version_id join reg_sources s on s.id = v.source_id
      where a.organization_id = $1 and a.applicable = true order by s.code, r.clause`, [orgId])).rows;
    const evidence = (await tx.query(`select f.id, f.entity_type, f.entity_id, f.filename, f.mime, f.size_bytes, f.sha256, f.uploaded_at, f.note, u.full_name as uploaded_by
      from evidence_files f join users u on u.id = f.uploaded_by where f.organization_id = $1 and (f.site_id = $5 or f.site_id is null) and f.uploaded_at ${per} order by f.uploaded_at`,
      [orgId, p.from, p.to, tz, p.siteId])).rows;
    const total = evidence.reduce((a, f) => a + Number(f.size_bytes), 0);
    if (total > MAX_EVIDENCE_BYTES) throw Errors.validation('Доказательств за период больше 100 МБ — выберите период короче.');
    const contents = new Map<string, Buffer>();
    for (const f of evidence) contents.set(f.id, (await tx.query(`select content from evidence_files where id = $1`, [f.id])).rows[0].content);
    // Готовность предприятия на конец периода — тем же движком, что ППК и главный экран (ТЗ доработки, P0).
    const ready = await validateEnterpriseReadiness(tx, orgId, p.to, { siteIds: [p.siteId] });
    return { plan, incidents, capas, reqs, evidence, contents, ready };
  }, p.siteId);

  for (const f of data.evidence) files.push({ name: `evidence/${f.entity_type}/${f.id.slice(0, 8)}_${safe(f.filename)}`, data: data.contents.get(f.id)! });

  const period = `${p.from.split('-').reverse().join('.')} — ${p.to.split('-').reverse().join('.')}`;
  const plan = data.plan;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Пакет для проверки — ${e(head.org.name)}</title>
<style>body{font:10.5pt/1.4 Arial,sans-serif;color:#111;max-width:1100px;margin:0 auto;padding:16px}h1{font-size:16pt;margin:0 0 4px}h2{font-size:12.5pt;margin:22px 0 6px;border-bottom:1px solid #999}
table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border:1px solid #888;padding:3px 5px;font-size:9pt;vertical-align:top;text-align:left}th{background:#eee}.muted{color:#555}.note{background:#fff6dc;padding:8px;border-radius:4px;font-size:9.5pt}code{font-size:8pt;word-break:break-all}</style></head><body>
<h1>Пакет документов для проверки</h1>
<div>${e(head.org.legal_form || '')} «${e(head.org.name)}»${head.org.inn ? `, ИНН ${e(head.org.inn)}` : ''} · площадка: ${e(head.site.name)} · период: ${e(period)}</div>
<div class="muted">Сформировано: ${e(fmt(new Date()))}, ${e(head.me.full_name)}. Часовой пояс: ${e(tz)}.</div>
<p class="note">Система поддерживает утверждённые процедуры и хранение доказательств; применимость требований и фактическое соблюдение подтверждаются ответственными специалистами предприятия. Пакет не является заключением о соответствии законодательству.</p>

<h2>1. План ХАССП</h2>
${plan ? `<p>Версия ${plan.plan.version}, утверждён ${e(fmt(plan.plan.approved_at))}${plan.plan.approved_by_name ? `, ${e(plan.plan.approved_by_name)}` : ''}. Область применения: ${e(plan.plan.scope)}.
Этапов: ${plan.steps.length}; опасностей: ${plan.hazards.length}; ККТ: ${plan.hazards.filter((h) => h.class === 'ccp').length}; ОПРП: ${plan.hazards.filter((h) => h.class === 'oprp').length}.
Реестры — в журналах J30, J31, J32.</p>` : '<p><b>Утверждённого плана ХАССП нет.</b></p>'}

<h2>2. Журналы за период</h2>
<table><tr><th>Форма</th><th>Название</th><th>Записей</th><th>Подпись</th><th>Файл</th></tr>
${journals.map((j) => `<tr><td>${j.code}</td><td>${e(j.name)}</td><td>${j.rows}</td><td>${e(j.sign)}</td><td>${j.file ? `<a href="${j.file}">печатный вид</a> · <a href="${j.file.replace('.html', '.csv')}">CSV</a>` : '—'}</td></tr>`).join('\n')}
</table>

<h2>3. Отклонения</h2>
${data.incidents.length ? `<table><tr><th>Создано</th><th>Отклонение</th><th>Риск</th><th>Статус</th><th>Действие</th><th>Закрыто</th><th>CAPA</th></tr>
${data.incidents.map((i) => `<tr><td>${e(fmt(i.created_at))}</td><td>${e(i.title)}<div class="muted">${e(i.what)}</div></td><td>${e(SEVERITY_LABEL[i.severity])}</td><td>${e(INC_STATUS[i.status])}</td>
<td>${e(i.action_note || '')}</td><td>${e(i.closed_at ? fmt(i.closed_at) : '—')}</td><td>${i.capa_id ? e(CAPA_STATUS[i.capa_status]) : '—'}</td></tr>`).join('\n')}</table>` : '<p>Отклонений за период нет.</p>'}

<h2>4. CAPA</h2>
${data.capas.length ? `<table><tr><th>CAPA</th><th>Причина</th><th>Корректирующее / предупреждающее</th><th>Критерий эффективности</th><th>Ответственный, срок</th><th>Статус, проверка</th></tr>
${data.capas.map((c) => `<tr><td>${e(c.title)}</td><td>${e(c.root_cause || 'не установлена')}</td><td>${e(c.corrective_action || '—')}${c.preventive_action ? `<div>${e(c.preventive_action)}</div>` : ''}</td>
<td>${e(c.effectiveness_criterion || '—')}</td><td>${e(c.responsible || '—')}${c.due_at ? `, до ${e(String(c.due_at).slice(0, 10))}` : ''}</td>
<td>${e(CAPA_STATUS[c.status])}${c.verified_at ? `<div>проверил: ${e(c.verifier)}, ${e(fmt(c.verified_at))} — ${e(c.verification_note)}</div>` : ''}</td></tr>`).join('\n')}</table>` : '<p>CAPA нет.</p>'}

<h2>5. Применимые требования (нормативный профиль)</h2>
${data.reqs.length ? `<table><tr><th>Источник, пункт</th><th>Требование</th><th>Редакция</th><th>Обоснование применимости</th></tr>
${data.reqs.map((r) => `<tr><td>${e(r.code)}, ${e(r.clause)}</td><td>${e(r.text)}</td><td>${e(r.edition)}${r.workflow_status !== 'approved' ? ' (не утверждена)' : ''}</td><td>${e(r.rationale || '')}</td></tr>`).join('\n')}</table>` : '<p>Применимость требований не определена.</p>'}

<h2>6. Готовность предприятия на ${e(data.ready.as_of.split('-').reverse().join('.'))}</h2>
<p class="muted">Проверки единого движка готовности; каждая — с пунктами нормативной базы. Не выполнено: ${data.ready.items.filter((i) => isBad(i.status)).length} из ${data.ready.items.length}.</p>
<table><tr><th>Группа</th><th>Проверка</th><th>Статус</th><th>Подробно</th><th>Основание</th></tr>
${data.ready.items.map((i) => `<tr><td>${e(i.group)}</td><td>${e(i.title)}</td><td>${isBad(i.status) ? '<b>' : ''}${e(R_STATUS[i.status])}${isBad(i.status) ? '</b>' : ''}</td><td>${e(i.detail)}${i.items?.length ? `<div class="muted">${i.items.map(e).join('; ')}</div>` : ''}</td><td>${e(i.basis.join(', ') || '—')}</td></tr>`).join('\n')}
</table>

<h2>7. Доказательства за период</h2>
${data.evidence.length ? `<table><tr><th>Файл</th><th>К записи</th><th>Загружено</th><th>SHA-256</th></tr>
${data.evidence.map((f) => `<tr><td><a href="evidence/${e(f.entity_type)}/${f.id.slice(0, 8)}_${e(safe(f.filename))}">${e(f.filename)}</a>${f.note ? `<div class="muted">${e(f.note)}</div>` : ''}</td>
<td>${e(ENTITY_LABEL[f.entity_type] || f.entity_type)} ${e(f.entity_id.slice(0, 8))}</td><td>${e(fmt(f.uploaded_at))}, ${e(f.uploaded_by)}</td><td><code>${f.sha256}</code></td></tr>`).join('\n')}</table>` : '<p>Доказательств за период нет.</p>'}

<p class="muted">Контрольные суммы всех файлов пакета — в checksums.sha256.</p></body></html>`;
  files.unshift({ name: 'index.html', data: Buffer.from(html, 'utf8') });
  const sums = files.map((f) => `${createHash('sha256').update(f.data).digest('hex')}  ${f.name}`).join('\n') + '\n';
  files.push({ name: 'checksums.sha256', data: Buffer.from(sums, 'utf8') });
  const archive = zip(files);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  await inOrg(userId, orgId, 'pack.export', async (tx) => audit.record(tx, { organizationId: orgId, siteId: p.siteId, actorUserId: userId, action: 'pack.export', entityType: 'site', entityId: p.siteId,
    after: { from: p.from, to: p.to, files: files.length, journals: journals.length, evidence: data.evidence.length, size: archive.length, sha256 } }), p.siteId);
  return { filename: `pack_${safe(head.site.name)}_${p.from}_${p.to}.zip`, archive, sha256, files: files.map((f) => f.name) };
}
