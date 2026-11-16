import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { withSystem, type Tx } from '../db/pool';
import { audit } from '../audit/audit';
import { Errors } from '../http/errors';
import { inOrg, parse } from './common';

/**
 * Интеграции (ТЗ доработки, P3). Принцип — как во всей системе: не имитировать обмен, которого нет.
 * У каждой системы честный статус:
 *  - ready — работает без внешних доступов (формат публичный и проверен: QR чека, CSV-импорт, выгрузки отчётов);
 *  - needs_access — реализация переносится из рабочей версии, нужны учётные данные и тестовый контур;
 *  - needs_spec — нет подтверждённой спецификации формата/API: без официального документа обмен не включается.
 * Секреты (пароли, ключи) хранятся только шифротекстом AES-256-GCM; ключ — переменная окружения CEH_SECRET_KEY
 * (32 байта, base64) вне базы. Без ключа секреты не сохраняются (fail-closed). В ответы и журнал секреты не попадают.
 */

type State = 'ready' | 'needs_access' | 'needs_spec';
interface SystemDef { title: string; state: State; what: string; needs: string[]; settings: string[]; secrets: string[] }

export const SYSTEMS: Record<string, SystemDef> = {
  kkt_qr: { title: 'QR кассового чека (ККТ)', state: 'ready', what: 'Сверка чека поставщика при приёмке: дата, сумма, ФН/ФД/ФП; повторный чек блокирует проводку.',
    needs: [], settings: [], secrets: [] },
  sales_csv: { title: 'Продажи внешней кассы — файл (iiko, r_keeper, другая)', state: 'ready', what: 'Импорт продаж файлом CSV «ID;дата;наименование;количество;цена»; повтор строки не дублирует продажу.',
    needs: [], settings: [], secrets: [] },
  reports_bi: { title: 'Выгрузки для BI и бухгалтерии', state: 'ready', what: 'Управленческие отчёты в XLSX и CSV, журналы — CSV, пакет для проверки — ZIP с контрольными суммами.',
    needs: [], settings: [], secrets: [] },
  mercury: { title: 'ФГИС «Меркурий» (ВетИС.API 2.x)', state: 'needs_access',
    what: 'Входящие ВСД площадки, сверка с приёмкой, гашение; партия ветконтрольного товара ждёт гашения ВСД. Логика переносится из рабочей версии (MonChef → ЦЕХ, Stage 113).',
    needs: ['логин и пароль API, APIKey, issuerId (GUID хозяйствующего субъекта) — выдаёт Россельхознадзор', 'GUID площадок в «Меркурии»', 'доступ к тестовому контуру api2.vetrf.ru для проверки до включения'],
    settings: ['environment', 'issuer_id', 'initiator', 'enterprise_guids'], secrets: ['login', 'password', 'api_key'] },
  iiko_api: { title: 'iiko — обмен по API', state: 'needs_spec',
    what: 'Автоматическая загрузка продаж и меню. В прежней версии реализация не была проверена на реальном аккаунте — как рабочая не переносится.',
    needs: ['официальная документация iikoCloud API (доступна партнёрам iiko)', 'тестовый apiLogin и организация в iiko'], settings: ['organization_id'], secrets: ['api_login'] },
  rkeeper_api: { title: 'r_keeper — обмен по API', state: 'needs_spec', what: 'Автоматическая загрузка продаж.',
    needs: ['документация API r_keeper для вашей версии (XML-интерфейс / облачный API)', 'тестовый стенд или доступ к серверу r_keeper'], settings: ['server_url'], secrets: ['login', 'password'] },
  edo_upd: { title: 'ЭДО: УПД от поставщиков', state: 'needs_spec', what: 'Приёмка по электронному УПД: строки, количество, цены, номер документа — без ручного ввода.',
    needs: ['XSD-схема формата УПД, утверждённая ФНС (действующая редакция)', 'оператор ЭДО и его API (Диадок, СБИС, Контур и др.) с тестовым ящиком'], settings: ['operator', 'box_id'], secrets: ['api_key'] },
  bank: { title: 'Банк: выписка и оплаты', state: 'needs_spec', what: 'Движение денег (ДДС), оплаты поставщикам, кредиторская задолженность.',
    needs: ['формат выписки банка (описание файла обмена или API банка)', 'образец выписки за период'], settings: ['bank'], secrets: ['api_token'] },
  accounting: { title: 'Бухгалтерская система (1С и др.)', state: 'needs_spec', what: 'Передача приёмок, списаний и продаж в бухгалтерию.',
    needs: ['конфигурация и версия 1С, формат обмена (EnterpriseData или согласованный)', 'тестовая база'], settings: [], secrets: [] },
  signature: { title: 'Электронная подпись (УКЭП)', state: 'needs_spec', what: 'Подписание деклараций, документов ХАССП и журналов квалифицированной подписью.',
    needs: ['средство криптозащиты (КриптоПро CSP / облачная подпись) и способ его вызова', 'тестовый сертификат'], settings: [], secrets: [] },
};

/* ───────────── Секреты ───────────── */

function key(): Buffer | null {
  const k = process.env.CEH_SECRET_KEY;
  if (!k) return null;
  const b = Buffer.from(k, 'base64');
  return b.length === 32 ? b : null;
}
export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw Errors.conflict('На сервере не задан ключ шифрования CEH_SECRET_KEY (32 байта, base64) — учётные данные не сохраняются открытым текстом.');
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((x) => x.toString('base64')).join('.');
}
export function decryptSecret(enc: string): string {
  const k = key();
  if (!k) throw Errors.conflict('На сервере не задан ключ шифрования CEH_SECRET_KEY.');
  const [iv, tag, data] = enc.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

async function logEvent(tx: Tx, orgId: string, system: string, action: string, status: 'ok' | 'error' | 'skipped', detail: string, userId: string | null) {
  await tx.query(`insert into integration_events (organization_id, system, action, status, detail, created_by) values ($1, $2, $3, $4, $5, $6)`, [orgId, system, action, status, detail.slice(0, 1000), userId]);
}

/* ───────────── API ───────────── */

export async function listIntegrations(userId: string, orgId: string) {
  return inOrg(userId, orgId, 'integration.manage', async (tx) => {
    const rows = (await tx.query(`select system, enabled, settings, secret_fields, updated_at from integrations where organization_id = $1`, [orgId])).rows;
    const events = (await tx.query(`select e.system, e.action, e.status, e.detail, e.created_at, u.full_name as who from integration_events e left join users u on u.id = e.created_by
      where e.organization_id = $1 order by e.created_at desc limit 30`, [orgId])).rows;
    return {
      systems: Object.entries(SYSTEMS).map(([code, d]) => {
        const r = rows.find((x) => x.system === code);
        return { code, ...d, enabled: !!r?.enabled, settings_values: r?.settings || {}, secrets_set: r?.secret_fields || [], updated_at: r?.updated_at || null };
      }),
      events, encryption: !!key(),
    };
  });
}

const SaveInput = z.object({ settings: z.record(z.string(), z.string().max(500)).default({}), secrets: z.record(z.string(), z.string().min(1).max(500)).default({}) });

/** Настройки системы. Секреты шифруются; включить можно только систему со статусом «ready» — остальные ждут проверки обмена. */
export async function saveIntegration(userId: string, orgId: string, systemInput: unknown, input: unknown) {
  const system = parse(z.string(), systemInput);
  const def = SYSTEMS[system];
  if (!def) throw Errors.notFound('Такой интеграции нет.');
  const d = parse(SaveInput, input);
  const badS = Object.keys(d.settings).filter((k) => !def.settings.includes(k)), badX = Object.keys(d.secrets).filter((k) => !def.secrets.includes(k));
  if (badS.length || badX.length) throw Errors.validation(`Неизвестные параметры: ${[...badS, ...badX].join(', ')}.`);
  return inOrg(userId, orgId, 'integration.manage', async (tx) => {
    const cur = (await tx.query(`select * from integrations where organization_id = $1 and system = $2 for update`, [orgId, system])).rows[0];
    let secrets: Record<string, string> = cur?.secret ? JSON.parse(decryptSecret(cur.secret)) : {};
    secrets = { ...secrets, ...d.secrets };
    const enc = Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null;
    const settings = { ...(cur?.settings || {}), ...d.settings };
    await tx.query(`insert into integrations (organization_id, system, settings, secret, secret_fields, updated_by) values ($1, $2, $3, $4, $5, $6)
      on conflict (organization_id, system) do update set settings = excluded.settings, secret = excluded.secret, secret_fields = excluded.secret_fields, updated_by = excluded.updated_by, updated_at = now()`,
      [orgId, system, JSON.stringify(settings), enc, Object.keys(secrets), userId]);
    await logEvent(tx, orgId, system, 'settings', 'ok', `параметры: ${Object.keys(d.settings).join(', ') || '—'}; секреты обновлены: ${Object.keys(d.secrets).join(', ') || '—'}`, userId);
    await audit.record(tx, { organizationId: orgId, actorUserId: userId, action: 'integration.settings', entityType: 'integration', after: { system, settings, secrets_set: Object.keys(secrets) } });
    return { ok: true, secrets_set: Object.keys(secrets) };
  });
}

export async function setIntegrationEnabled(userId: string, orgId: string, systemInput: unknown, enabled: boolean) {
  const system = parse(z.string(), systemInput);
  const def = SYSTEMS[system];
  if (!def) throw Errors.notFound('Такой интеграции нет.');
  return inOrg(userId, orgId, 'integration.manage', async (tx) => {
    if (enabled && def.state !== 'ready') {
      // отказ пишется отдельно — иначе откатится вместе с ошибкой
      await withSystem((t) => logEvent(t, orgId, system, 'enable', 'skipped', `не включена: ${def.state === 'needs_access' ? 'нужны доступы и проверка на тестовом контуре' : 'нет подтверждённой спецификации обмена'}`, userId));
      throw Errors.conflict(`«${def.title}» не включается: ${def.state === 'needs_access' ? 'нужны учётные данные и проверка обмена на тестовом контуре' : 'нет подтверждённой спецификации обмена'}. Требуется: ${def.needs.join('; ')}.`);
    }
    await tx.query(`insert into integrations (organization_id, system, enabled, updated_by) values ($1, $2, $3, $4)
      on conflict (organization_id, system) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`, [orgId, system, enabled, userId]);
    await logEvent(tx, orgId, system, enabled ? 'enable' : 'disable', 'ok', enabled ? 'включена' : 'выключена', userId);
    return { ok: true };
  });
}

/* ───────────── QR кассового чека (ФНС): t=ГГГГММДДTччмм&s=сумма&fn=ФН&i=ФД&fp=ФП&n=признак ───────────── */

export const FISCAL_OPERATIONS: Record<string, string> = { '1': 'приход', '2': 'возврат прихода', '3': 'расход', '4': 'возврат расхода' };

export function parseFiscalQr(raw: string) {
  raw = String(raw || '').trim();
  let q = raw; const qm = q.indexOf('?'); if (qm >= 0) q = q.slice(qm + 1);
  const p: Record<string, string> = {};
  for (const pair of q.split('&')) {
    const i = pair.indexOf('='); if (i < 0) continue;
    try { p[decodeURIComponent(pair.slice(0, i)).toLowerCase()] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')); } catch { /* битая пара пропускается */ }
  }
  const total = p.s !== undefined && p.s !== '' && Number.isFinite(Number(p.s.replace(',', '.'))) ? Number(p.s.replace(',', '.')) : null;
  const t = String(p.t || '').replace(/[^0-9]/g, '');
  const datetime = t.length >= 12 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}` : null;
  const fn = p.fn || '', fd = p.i || p.fd || '', fp = p.fp || '', operation = p.n || '';
  const valid = !!(datetime && total !== null && fn && fd && fp);
  return { raw, datetime, date: datetime ? datetime.slice(0, 10) : null, total, fn, fd, fp, operation, valid, key: valid ? [fn, fd, fp].join('|') : null };
}

export function compareFiscalQr(qr: ReturnType<typeof parseFiscalQr>, doc: { total: number | null; date: string | null }) {
  const warnings: string[] = [];
  if (!qr.valid) return { status: 'invalid' as const, warnings: ['QR не похож на кассовый чек: нет даты, суммы, ФН, ФД или ФП.'] };
  let checks = 0, ok = 0;
  if (doc.total !== null) { checks++; if (Math.abs(qr.total! - doc.total) <= 0.01) ok++; else warnings.push(`Сумма по QR ${qr.total} ₽, по строкам приёмки ${doc.total} ₽ — проверьте строки и цены.`); }
  if (doc.date) { checks++; if (qr.date === doc.date) ok++; else warnings.push(`Дата по QR ${qr.date}, дата документа в приёмке ${doc.date}.`); }
  if (qr.operation && qr.operation !== '1') warnings.push(`Признак расчёта по QR — «${FISCAL_OPERATIONS[qr.operation] || qr.operation}»: это не чек покупки.`);
  return { status: !checks ? 'no_comparison' as const : ok === checks ? 'match' as const : ok ? 'partial' as const : 'conflict' as const, warnings };
}

/** QR чека к приёмке: сверка с суммой и датой; тот же чек в другой проведённой приёмке — повтор (проводка блокируется). */
export async function attachFiscalQr(userId: string, orgId: string, receiptId: string, input: unknown) {
  const d = parse(z.object({ qr: z.string().trim().min(5, 'Пустая строка QR.').max(1000) }), input);
  return inOrg(userId, orgId, 'receipt.record', async (tx, m) => {
    const r = (await tx.query(`select id, site_id, status, document_date::text from receipts where id = $1 and organization_id = $2`, [parse(z.uuid(), receiptId), orgId])).rows[0];
    if (!r) throw Errors.notFound('Приёмка не найдена.');
    if (m.site_ids.length && !m.site_ids.includes(r.site_id)) throw Errors.forbidden('Нет доступа к этой площадке.');
    const qr = parseFiscalQr(d.qr);
    const sum = (await tx.query(`select sum(quantity * unit_price) filter (where unit_price is not null)::float as s, count(*) filter (where unit_price is null)::int as unpriced
      from receipt_lines where receipt_id = $1 and decision <> 'rejected'`, [r.id])).rows[0];
    const cmp = compareFiscalQr(qr, { total: sum.unpriced || sum.s === null ? null : Math.round(sum.s * 100) / 100, date: r.document_date });
    if (sum.unpriced) cmp.warnings.push(`У ${sum.unpriced} строк приёмки нет цены — сумма не сверялась.`);
    const dup = qr.key ? (await tx.query(`select f.receipt_id from fiscal_receipts f join receipts x on x.id = f.receipt_id where f.organization_id = $1 and f.fiscal_key = $2 and f.receipt_id <> $3
      and x.status <> 'draft' limit 1`, [orgId, qr.key, r.id])).rows[0] : null;
    if (dup) cmp.warnings.unshift(`Этот чек (ФН ${qr.fn}, ФД ${qr.fd}) уже приложен к проведённой приёмке — повторная приёмка по тому же чеку блокируется.`);
    const status = dup ? 'duplicate' : cmp.status;
    const row = (await tx.query(`insert into fiscal_receipts (organization_id, receipt_id, qr_raw, fiscal_at, total, fn, fd, fp, operation, fiscal_key, match_status, warnings, created_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [orgId, r.id, qr.raw, qr.datetime, qr.total, qr.fn || null, qr.fd || null, qr.fp || null, qr.operation || null, qr.key, status, JSON.stringify(cmp.warnings), userId])).rows[0];
    await logEvent(tx, orgId, 'kkt_qr', 'attach', status === 'match' ? 'ok' : 'error', `приёмка ${r.id.slice(0, 8)}: ${status}`, userId);
    await audit.record(tx, { organizationId: orgId, siteId: r.site_id, actorUserId: userId, action: 'receipt.fiscal_qr', entityType: 'receipt', entityId: r.id, after: { status, key: qr.key, total: qr.total } });
    return { id: row.id, status, warnings: cmp.warnings, qr: { datetime: qr.datetime, total: qr.total, fn: qr.fn, fd: qr.fd, fp: qr.fp, operation: FISCAL_OPERATIONS[qr.operation] || qr.operation || null } };
  });
}

/** Перед проводкой: чек этой приёмки не должен быть уже проведён в другой (повтор мог появиться после сверки). */
export async function assertFiscalNotDuplicate(tx: Tx, orgId: string, receiptId: string) {
  const dup = (await tx.query(`select f.fn, f.fd from fiscal_receipts f join fiscal_receipts o on o.fiscal_key = f.fiscal_key and o.receipt_id <> f.receipt_id and o.organization_id = f.organization_id
    join receipts x on x.id = o.receipt_id where f.organization_id = $1 and f.receipt_id = $2 and f.fiscal_key is not null and x.status <> 'draft' limit 1`, [orgId, receiptId])).rows[0];
  if (dup) throw Errors.conflict(`Чек ФН ${dup.fn}, ФД ${dup.fd} уже проведён в другой приёмке — повторная приёмка по тому же чеку заблокирована.`);
}

export async function listFiscalQr(userId: string, orgId: string, receiptId: string) {
  return inOrg(userId, orgId, 'lot.read', async (tx) => (await tx.query(`select f.id, f.fiscal_at, f.total, f.fn, f.fd, f.fp, f.operation, f.match_status, f.warnings, f.created_at, u.full_name as who
    from fiscal_receipts f join users u on u.id = f.created_by where f.organization_id = $1 and f.receipt_id = $2 order by f.created_at`, [orgId, parse(z.uuid(), receiptId)])).rows);
}
