import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createControlObject, createRule, approveRule } from '../src/server/ops/control';
import { securityChecks } from '../src/server/ops/security';
import { backup, verifyRestore } from '../src/server/ops/backup';
import { getReadiness, confirm, decideGo, CONFIRMATIONS } from '../src/server/ops/readiness';
import { myData } from '../src/server/identity/mydata';
import { sendPending, mailHealth, MAX_ATTEMPTS, type MailTransport } from '../src/server/mail/sender';
import { makeUser, lastLinkToken } from './helpers';

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, haccp: U, director: U, cook: U, stranger: U;
let orgId: string, siteId: string;
const dir = mkdtempSync(path.join(tmpdir(), 'ceh-backup-'));

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

beforeAll(async () => {
  owner = await makeUser({ name: 'Ольга Владелец' });
  const r = await createOrganization(owner, { name: 'Кафе «Пилот»' });
  orgId = r.organization.id; siteId = r.site.id;
  cook = await invite('line_staff');
  stranger = await makeUser();
  await createOrganization(stranger, { name: 'Чужое кафе' });
});

describe('Проверка безопасности базы ловит регрессии (AT-10, AT-11)', () => {
  it('сейчас всё критичное в порядке', async () => {
    const s = await securityChecks();
    expect(s.ok).toBe(true);
    expect(s.checks.filter((c) => c.severity === 'critical').every((c) => c.ok)).toBe(true);
  });

  it('снятая RLS и право на изменение неизменяемого журнала — провал', async () => {
    await withSystem((tx) => tx.query(`alter table capas disable row level security; grant update on audit_events to ceh_app`));
    try {
      const s = await securityChecks();
      expect(s.ok).toBe(false);
      expect(s.checks.find((c) => c.key === 'rls')).toMatchObject({ ok: false, detail: expect.stringContaining('capas') });
      expect(s.checks.find((c) => c.key === 'immutable_grants')).toMatchObject({ ok: false, detail: 'audit_events' });
    } finally {
      await withSystem((tx) => tx.query(`alter table capas enable row level security; revoke update on audit_events from ceh_app`));
    }
    expect((await securityChecks()).ok).toBe(true);
  });
});

describe('Резервная копия и проверенное восстановление (AT-16)', () => {
  it('копия в одном снимке + восстановление во временную базу со сверкой всего', async () => {
    const b = await backup(dir);
    expect(b.manifest.migrations.map((m) => m.name)).toContain('010_pilot_readiness.sql');
    expect(b.manifest.rows.organizations).toBeGreaterThanOrEqual(2);
    const v = await verifyRestore(b.id);
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.checks.map((c) => c.name)).toEqual(expect.arrayContaining(['Контрольная сумма файла', 'Восстановление без ошибок', 'Миграции и контрольные суммы', 'Таблицы с RLS']));
    expect(v.checks.find((c) => c.name.startsWith('Цепочки аудита'))!.ok).toBe(true);
    const temp = (await withSystem((tx) => tx.query(`select count(*)::int as n from pg_database where datname like 'ceh_restore_%'`))).rows[0].n;
    expect(temp).toBe(0);                                        // временная база удалена
  });

  it('повреждённый файл копии — проверка не проходит', async () => {
    const b = await backup(dir);
    const buf = readFileSync(b.file);
    buf[buf.length - 100] ^= 0xff;
    writeFileSync(b.file, buf);
    const v = await verifyRestore(b.id);
    expect(v.ok).toBe(false);
    expect(v.checks[0]).toMatchObject({ name: 'Контрольная сумма файла', ok: false });
    // последняя проверенная копия — та, что прошла; для готовности снимаем новую
    expect((await verifyRestore((await backup(dir)).id)).ok).toBe(true);
  });
});

describe('Готовность к пилоту и Go/No-Go', () => {
  it('новая организация не готова: «запускаем» запрещено, «не запускаем» — можно', async () => {
    const r = await getReadiness(owner.id, orgId);
    const fails = r.checks.filter((c) => c.status === 'fail').map((c) => c.key);
    expect(fails).toEqual(expect.arrayContaining(['team', 'objects', 'haccp', 'confirm_norms_verified', 'confirm_pd_officer', 'confirm_training', 'confirm_paper_fallback']));
    expect(r.checks.find((c) => c.key === 'backup')!.status).toBe('pass');
    expect(r.checks.find((c) => c.key === 'security_rls')!.status).toBe('pass');
    expect(r.can_go).toBe(false);
    await expect(decideGo(owner.id, orgId, { decision: 'go', note: 'хотим запуститься в понедельник' })).rejects.toThrow(/Запуск невозможен: не готово — /);
    await decideGo(owner.id, orgId, { decision: 'no_go', note: 'не готовы: нет плана ХАССП и инструктажа' });
    await expect(getReadiness(cook.id, orgId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getReadiness(stranger.id, orgId)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
  });

  it('подтверждения — с основанием и правом; доводим до готовности; «запускаем» со снимком проверок', async () => {
    haccp = await invite('haccp_lead'); director = await invite('director');
    await expect(confirm(haccp.id, orgId, { key: 'training', evidence: 'проведён инструктаж 20.10.2026' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(confirm(director.id, orgId, { key: 'training', evidence: 'да' })).rejects.toMatchObject({ code: 'VALIDATION' });
    for (const c of CONFIRMATIONS.filter((x) => x.required)) await confirm(director.id, orgId, { key: c.key, evidence: `Подтверждено документом № ${c.key} от 20.10.2026` });
    const obj = await createControlObject(owner.id, orgId, { siteId, name: 'Камера мяса', kind: 'fridge' });
    const rule = await createRule(haccp.id, orgId, { controlObjectId: obj.id, minValue: 0, maxValue: 4, sourceRef: 'Процедура ПК-03, п. 2', reaction: 'Повторить замер; проверить дверь.' });
    await approveRule(haccp.id, orgId, rule.id);
    await withSystem((tx) => tx.query(`insert into haccp_plans (organization_id, version, status, scope, created_by, approved_by, approved_at) values ($1, 1, 'approved', 'Горячий цех', $2, $2, now())`, [orgId, owner.id]));
    const r = await getReadiness(owner.id, orgId, siteId);
    expect(r.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(r.checks.find((c) => c.key === 'confirm_training')).toMatchObject({ status: 'pass', confirmation: expect.objectContaining({ evidence: expect.stringContaining('training') }) });
    await expect(decideGo(director.id, orgId, { decision: 'go', note: 'запуск пилота на основной площадке с 22.10' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const d = await decideGo(owner.id, orgId, { decision: 'go', note: 'запуск пилота на основной площадке с 22.10', siteId });
    expect(d).toMatchObject({ decision: 'go', counts: { fail: 0 } });
    const after = await getReadiness(owner.id, orgId);
    expect(after.decisions.map((x) => x.decision)).toEqual(['go', 'no_go']);
    await expect(withSystem((tx) => tx.query(`update pilot_decisions set decision = 'go'`))).rejects.toThrow(/не изменяются/);
  });

  it('отзыв подтверждения возвращает «не готово»', async () => {
    await confirm(owner.id, orgId, { key: 'training', confirmed: false, evidence: 'новые сотрудники не прошли инструктаж' });
    expect((await getReadiness(owner.id, orgId)).checks.find((c) => c.key === 'confirm_training')!.status).toBe('fail');
  });
});

describe('Мои данные (152-ФЗ, AT-15)', () => {
  it('профиль, участие, сессии, входы и действия — без хешей паролей и токенов', async () => {
    const d = await myData(cook.id);
    expect(d.user.email).toBe(cook.email);
    expect(d.memberships).toEqual([expect.objectContaining({ organization: 'Кафе «Пилот»', role: 'line_staff' })]);
    expect(d.sessions.length).toBeGreaterThan(0);
    expect(d.logins.some((l) => l.success)).toBe(true);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/password_hash|token_hash/);
    const ev = (await withSystem((tx) => tx.query(`select 1 from audit_events where actor_user_id = $1 and action = 'user.data_export'`, [cook.id]))).rowCount;
    expect(ev).toBe(1);
  });
});

describe('Доставка писем из очереди', () => {
  it('отправляет один раз; сбой — повтор с паузой; после лимита попыток — видно в готовности', async () => {
    const sent: string[] = [];
    const ok: MailTransport = { async send(m) { sent.push(m.to); } };
    const r = await sendPending(ok, 10_000);
    expect(r.sent).toBeGreaterThan(0);
    expect(sent).toContain(cook.email);
    expect((await sendPending(ok)).sent).toBe(0);                      // повторно не отправляется
    await withSystem((tx) => tx.query(`insert into outbox_emails (to_email, template, subject, body) values ('x@example.test', 'invitation', 'тема', 'текст')`));
    const bad: MailTransport = { async send() { throw new Error('SMTP недоступен'); } };
    expect(await sendPending(bad)).toEqual({ sent: 0, failed: 1 });
    const row = (await withSystem((tx) => tx.query(`select attempts, error, next_attempt_at > now() as later from outbox_emails where to_email = 'x@example.test'`))).rows[0];
    expect(row).toMatchObject({ attempts: 1, error: 'SMTP недоступен', later: true });
    expect((await sendPending(bad)).failed).toBe(0);                    // до паузы не повторяет
    await withSystem((tx) => tx.query(`update outbox_emails set attempts = $1, created_at = now() - interval '1 hour' where to_email = 'x@example.test'`, [MAX_ATTEMPTS]));
    expect((await mailHealth()).dead).toBe(1);
    expect((await getReadiness(owner.id, orgId)).checks.find((c) => c.key === 'mail')!.status).toBe('fail');
  });
});
