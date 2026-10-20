import { afterAll, describe, expect, it } from 'vitest';
import { closePool, withSystem, withTenant } from '../src/server/db/pool';
import { register, verifyEmail, login, getSession, logout, requestPasswordReset, resetPassword } from '../src/server/identity/auth';
import {
  createOrganization, listMyOrganizations, getOrganization, listSites, createSite, updateSite, inviteMember, acceptInvitation,
  listMembers, changeMember, setMemberBlocked, listAudit, verifyAudit, revokeInvitation,
} from '../src/server/org/organizations';
import { makeUser, uniq, lastLinkToken, PASSWORD } from './helpers';

afterAll(() => closePool());

async function invite(ownerId: string, orgId: string, role: string, opts: { siteIds?: string[] } = {}) {
  const u = await makeUser();
  await inviteMember(ownerId, orgId, { email: u.email, role, siteIds: opts.siteIds || [] });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}

describe('Регистрация и вход (ТЗ v1 AT-01, v2 §9)', () => {
  it('пароль хранится только хешем; вход до и после подтверждения', async () => {
    const email = uniq();
    await register({ email, password: PASSWORD, fullName: 'Анна Смирнова' });
    const row = (await withSystem((tx) => tx.query('select password_hash, email_verified_at from users where email = $1', [email]))).rows[0];
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.email_verified_at).toBeNull();
    const r = await login({ email, password: PASSWORD }, { ip: '1.1.1.1' });
    expect(r.session.user.email_verified).toBe(false);
  });

  it('AT-01: неподтверждённый пользователь не становится владельцем', async () => {
    const u = await makeUser({ verified: false });
    await expect(createOrganization(u, { name: 'Кафе' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await verifyEmail(await lastLinkToken(u.email, 'verify_email'));
    const s = await getSession(u.token);
    const { organization } = await createOrganization(s!.user, { name: 'Кафе «Пробное»' });
    expect(organization.status).toBe('DRAFT');
    expect((await listMyOrganizations(u.id))[0]).toMatchObject({ id: organization.id, role: 'owner' });
  });

  it('ссылка подтверждения одноразовая', async () => {
    const email = uniq();
    await register({ email, password: PASSWORD, fullName: 'Пётр Иванов' });
    const t = await lastLinkToken(email, 'verify_email');
    await verifyEmail(t);
    await expect(verifyEmail(t)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('повторная регистрация не раскрывает существование адреса и не меняет пароль', async () => {
    const u = await makeUser();
    await expect(register({ email: u.email, password: 'ДругойПароль123', fullName: 'Злоумышленник' })).resolves.toEqual({ ok: true });
    await expect(login({ email: u.email, password: PASSWORD }, { ip: '2.2.2.2' })).resolves.toBeTruthy();
  });

  it('слабый пароль отклоняется', async () => {
    await expect(register({ email: uniq(), password: 'короткий', fullName: 'Имя Фамилия' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('5 неверных паролей блокируют вход на 15 минут, даже с верным паролем', async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) await expect(login({ email: u.email, password: 'НеверныйПароль1' }, { ip: '3.3.3.' + i })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(login({ email: u.email, password: PASSWORD }, { ip: '3.3.4.1' })).rejects.toThrow(/временно заблокирован/);
  });

  it('выход закрывает сессию; сброс пароля закрывает все сессии', async () => {
    const u = await makeUser();
    const second = await login({ email: u.email, password: PASSWORD }, { ip: '4.4.4.4' });
    await logout(u.token);
    expect(await getSession(u.token)).toBeNull();
    expect(await getSession(second.token)).not.toBeNull();
    await requestPasswordReset({ email: u.email });
    await resetPassword({ token: await lastLinkToken(u.email, 'reset_password'), password: 'НовыйПароль2026' });
    expect(await getSession(second.token)).toBeNull();
    await expect(login({ email: u.email, password: 'НовыйПароль2026' }, { ip: '4.4.4.5' })).resolves.toBeTruthy();
  });
});

describe('Изоляция организаций (ТЗ v1 AT-02, v2 AT-10)', () => {
  it('пользователь A не читает и не меняет данные организации B — ни через сервис, ни напрямую в базе', async () => {
    const a = await makeUser(); const b = await makeUser();
    const orgA = (await createOrganization(a, { name: 'Ресторан А' })).organization;
    const orgB = (await createOrganization(b, { name: 'Столовая Б' })).organization;

    await expect(getOrganization(a.id, orgB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listSites(a.id, orgB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createSite(a.id, orgB.id, { name: 'Чужая площадка' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listMembers(a.id, orgB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listAudit(a.id, orgB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listMyOrganizations(a.id)).map((o) => o.id)).toEqual([orgA.id]);

    // Второй слой: даже если код подставит чужую организацию в контекст, база строк не отдаст.
    const leaked = await withTenant({ userId: a.id, orgId: orgB.id }, async (tx) => ({
      orgs: (await tx.query('select id from organizations where id = $1', [orgB.id])).rowCount,
      sites: (await tx.query('select id from sites where organization_id = $1', [orgB.id])).rowCount,
      members: (await tx.query('select id from memberships where organization_id = $1', [orgB.id])).rowCount,
      users: (await tx.query('select id from users where id = $1', [b.id])).rowCount,
      audit: (await tx.query('select id from audit_events where organization_id = $1', [orgB.id])).rowCount,
    }));
    expect(leaked).toEqual({ orgs: 0, sites: 0, members: 0, users: 0, audit: 0 });
    await expect(withTenant({ userId: a.id, orgId: orgB.id }, (tx) =>
      tx.query(`insert into sites (organization_id, name) values ($1, 'взлом')`, [orgB.id]))).rejects.toThrow(/row-level security/);
    const updated = await withTenant({ userId: a.id, orgId: orgB.id }, (tx) => tx.query(`update organizations set name = 'взлом' where id = $1`, [orgB.id]));
    expect(updated.rowCount).toBe(0);
  });

  it('служебные таблицы (сессии, ссылки, письма) недоступны приложению под ролью ceh_app', async () => {
    const a = await makeUser();
    for (const t of ['sessions', 'email_tokens', 'outbox_emails', 'login_attempts']) {
      await expect(withTenant({ userId: a.id }, (tx) => tx.query(`select 1 from ${t} limit 1`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('Роли и права на сервере (ТЗ v1 AT-04)', () => {
  it('сотрудник цеха не приглашает и не видит аудит; HR не назначает администратора; отказ пишется в аудит', async () => {
    const owner = await makeUser();
    const { organization: org } = await createOrganization(owner, { name: 'Кейтеринг' });
    const cook = await invite(owner.id, org.id, 'line_staff');
    const hr = await invite(owner.id, org.id, 'hr');

    await expect(inviteMember(cook.id, org.id, { email: uniq(), role: 'line_staff' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listAudit(cook.id, org.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(inviteMember(hr.id, org.id, { email: uniq(), role: 'enterprise_admin' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(inviteMember(hr.id, org.id, { email: uniq(), role: 'chef' })).resolves.toBeTruthy();

    const denied = (await listAudit(owner.id, org.id, { limit: 200 })).filter((e) => e.result === 'denied');
    expect(denied.map((e) => e.action)).toEqual(expect.arrayContaining(['member.invite', 'audit.read']));
  });

  it('доступ ограничен площадкой: сотрудник одной площадки не меняет другую', async () => {
    const owner = await makeUser();
    const { organization: org, site: s1 } = await createOrganization(owner, { name: 'Сеть кафе' });
    const s2 = await createSite(owner.id, org.id, { name: 'Кафе на Ленина' });
    const admin = await invite(owner.id, org.id, 'enterprise_admin', { siteIds: [s1.id] });
    await expect(updateSite(admin.id, org.id, s2.id, { name: 'Переименовано' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(updateSite(admin.id, org.id, s1.id, { address: 'ул. Мира, 1' })).resolves.toMatchObject({ address: 'ул. Мира, 1' });
    expect((await listSites(admin.id, org.id)).map((s) => s.id)).toEqual([s1.id]);
  });

  it('приглашение принимается только тем же подтверждённым email', async () => {
    const owner = await makeUser();
    const { organization: org } = await createOrganization(owner, { name: 'Пекарня' });
    const target = uniq();
    await inviteMember(owner.id, org.id, { email: target, role: 'storekeeper' });
    const token = await lastLinkToken(target, 'invitation');
    const stranger = await makeUser();
    await expect(acceptInvitation(stranger, token)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const inv = await inviteMember(owner.id, org.id, { email: stranger.email, role: 'storekeeper' });
    await revokeInvitation(owner.id, org.id, inv.id);
    await expect(acceptInvitation(stranger, await lastLinkToken(stranger.email, 'invitation'))).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('нельзя снять или заблокировать последнего владельца и самого себя', async () => {
    const owner = await makeUser();
    const { organization: org } = await createOrganization(owner, { name: 'Бар' });
    const admin = await invite(owner.id, org.id, 'enterprise_admin');
    const ownerMember = (await listMembers(owner.id, org.id)).find((m) => m.user_id === owner.id)!;
    await expect(changeMember(admin.id, org.id, ownerMember.id, { role: 'chef' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setMemberBlocked(owner.id, org.id, ownerMember.id, true, 'тест')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('Увольнение: доступ закрыт, история сохранена (ТЗ v1 §4)', () => {
  it('заблокированный сотрудник сразу теряет доступ, запись участия и аудит остаются', async () => {
    const owner = await makeUser();
    const { organization: org } = await createOrganization(owner, { name: 'Столовая завода' });
    const cook = await invite(owner.id, org.id, 'chef');
    await expect(listSites(cook.id, org.id)).resolves.toHaveLength(1);
    const m = (await listMembers(owner.id, org.id)).find((x) => x.user_id === cook.id)!;
    await expect(setMemberBlocked(owner.id, org.id, m.id, true, '')).rejects.toMatchObject({ code: 'VALIDATION' });
    await setMemberBlocked(owner.id, org.id, m.id, true, 'увольнение');
    await expect(listSites(cook.id, org.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await listMyOrganizations(cook.id)).toEqual([]);
    const after = (await listMembers(owner.id, org.id)).find((x) => x.user_id === cook.id)!;
    expect(after).toMatchObject({ status: 'blocked', blocked_reason: 'увольнение' });
    const actions = (await listAudit(owner.id, org.id, { limit: 200 })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['member.add', 'member.block']));
  });
});

describe('Аудит (ТЗ v1 AT-15, v2 AT-11)', () => {
  it('изменения видны с «было/стало», цепочка проверяется, правка и удаление запрещены', async () => {
    const owner = await makeUser();
    const { organization: org, site } = await createOrganization(owner, { name: 'Кафе у моря' });
    await updateSite(owner.id, org.id, site.id, { name: 'Зал у окна' });
    const ev = (await listAudit(owner.id, org.id)).find((e) => e.action === 'site.update')!;
    expect(ev.before.name).toBe('Основная площадка');
    expect(ev.after.name).toBe('Зал у окна');
    expect(await verifyAudit(owner.id, org.id)).toMatchObject({ ok: true });

    await expect(withSystem((tx) => tx.query(`update audit_events set reason = 'подмена' where organization_id = $1`, [org.id]))).rejects.toThrow(/нельзя изменять/);
    await expect(withSystem((tx) => tx.query(`delete from audit_events where organization_id = $1`, [org.id]))).rejects.toThrow(/нельзя изменять/);

    // Подмена в обход триггера (например, прямой правкой файла базы) ломает цепочку.
    await withSystem(async (tx) => {
      await tx.query('alter table audit_events disable trigger audit_events_no_update');
      await tx.query(`update audit_events set reason = 'подмена' where id = (select min(id) from audit_events where organization_id = $1)`, [org.id]);
      await tx.query('alter table audit_events enable trigger audit_events_no_update');
    });
    expect(await verifyAudit(owner.id, org.id)).toMatchObject({ ok: false });
  });

  it('пароли и токены в аудит не попадают', async () => {
    const rows = (await withSystem((tx) => tx.query(`select coalesce(before::text, '') || coalesce(after::text, '') as t from audit_events`))).rows;
    expect(rows.some((r) => r.t.includes(PASSWORD) || r.t.includes('scrypt$'))).toBe(false);
  });
});
