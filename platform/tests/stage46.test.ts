import { afterAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { register, verifyEmail, verifyInfo, login, getSession } from '../src/server/identity/auth';
import { uniq, PASSWORD } from './helpers';

/** Этап 0 промта доработки: захват учётной записи до регистрации (identity/auth.ts). */

afterAll(() => closePool());
const ATTACKER = 'Пароль-злоумышленника-2026', OWNER = PASSWORD;
const tokens = async (email: string) => (await withSystem((tx) => tx.query(`select body from outbox_emails where to_email = $1 and template = 'verify_email' order by created_at`, [email]))).rows
  .map((r) => /token=([A-Za-z0-9_-]+)/.exec(r.body)![1]);

describe('Захват учётной записи до регистрации', () => {
  it('первый «регистратор» теряет сессию и пароль после подтверждения владельцем; пароль владельца работает', async () => {
    const email = uniq('victim');
    await register({ email, password: ATTACKER, fullName: 'Чужой' });
    const attacker = await login({ email, password: ATTACKER }, { ip: '10.9.0.1' });          // неподтверждённый вход разрешён
    await register({ email, password: OWNER, fullName: 'Владелец' });
    const [first, mine] = await tokens(email);
    expect(await verifyInfo(mine)).toEqual({ need_password: true });                          // адрес оспорен — нужен пароль этой регистрации
    await expect(verifyEmail(mine)).rejects.toThrow(/пароль, указанный при регистрации/);
    await expect(verifyEmail(mine, ATTACKER)).rejects.toThrow(/не совпадает/);                // чужой пароль к этой ссылке не подходит
    await verifyEmail(mine, OWNER);
    expect(await getSession(attacker.token)).toBeNull();                                     // сессия злоумышленника отозвана
    await expect(login({ email, password: ATTACKER }, { ip: '10.9.0.2' })).rejects.toThrow(/Неверный email или пароль/);
    expect((await login({ email, password: OWNER }, { ip: '10.9.0.3' })).session.user.email_verified).toBe(true);
    await expect(verifyEmail(first, ATTACKER)).rejects.toThrow(/недействительна/);            // ссылки других регистраций погашены
  });

  it('злоумышленник регистрируется повторно после владельца — ссылка владельца остаётся рабочей со своим паролем', async () => {
    const email = uniq('victim2');
    await register({ email, password: OWNER, fullName: 'Владелец' });
    await register({ email, password: ATTACKER, fullName: 'Чужой' });
    const [mine, theirs] = await tokens(email);
    await expect(verifyEmail(theirs, OWNER)).rejects.toThrow(/не совпадает/);                // владелец не может случайно принять чужой пароль
    await verifyEmail(mine, OWNER);
    await expect(login({ email, password: ATTACKER }, { ip: '10.9.0.4' })).rejects.toThrow(/Неверный email или пароль/);
  });

  it('обычная регистрация — подтверждение в один клик; сессии до подтверждения отзываются', async () => {
    const email = uniq('plain');
    await register({ email, password: OWNER, fullName: 'Анна' });
    const before = await login({ email, password: OWNER }, { ip: '10.9.0.5' });
    const [t] = await tokens(email);
    expect(await verifyInfo(t)).toEqual({ need_password: false });
    await verifyEmail(t);
    expect(await getSession(before.token)).toBeNull();
    expect((await login({ email, password: OWNER }, { ip: '10.9.0.6' })).session.user.email_verified).toBe(true);
  });
});
