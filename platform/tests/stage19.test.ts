import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, withSystem } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { addExpense, voidExpense, listExpenses, pnl, abcXyz } from '../src/server/ops/finance';
import { makeUser, lastLinkToken } from './helpers';

/** Управленческая экономика: расходы, P&L, Prime Cost, ABC/XYZ (данные продаж условные). */

afterAll(() => closePool());

type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, acc: U, chef: U, orgId: string, siteId: string;
const P = { from: '2026-03-02', to: '2026-03-29' };   // ровно 4 недели

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
async function sale(name: string, day: string, qty: number, price: number, cost: number | null) {
  await withSystem((tx) => tx.query(`insert into sales (organization_id, site_id, source, external_id, name, qty, price, amount, sold_at, fulfil_status, cost)
    values ($1, $2, 'import', $3, $4, $5, $6, $7, $8, $9, $10)`, [orgId, siteId, `${name}-${day}-${Math.random()}`, name, qty, price, qty * price, `${day}T12:00:00+03:00`, cost === null ? 'pending' : 'done', cost]));
}

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кафе «Экономика»' });
  orgId = r.organization.id; siteId = r.site.id;
  acc = await invite('accountant'); chef = await invite('chef');
  // 4 недели: «Борщ» — стабильно 10 в неделю, «Стейк» — 2/10/2/10, «Морс» — 1 раз
  for (const [i, d] of ['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24'].entries()) {
    await sale('Борщ', d, 10, 300, 10 * 90);
    await sale('Стейк', d, i % 2 ? 10 : 2, 1000, (i % 2 ? 10 : 2) * 450);
  }
  await sale('Морс', '2026-03-05', 5, 100, null);   // без себестоимости
  await withSystem((tx) => tx.query(`update organizations set timezone = 'Europe/Moscow' where id = $1`, [orgId]));
});

describe('Расходы: разовые и ежемесячные, аннулирование вместо правки', () => {
  it('ежемесячный — по дням периода; разовый — по дате; права', async () => {
    await expect(addExpense(chef.id, orgId, { category: 'rent', kind: 'monthly', date: '2026-03-15', amount: 31000, title: 'Аренда' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await addExpense(acc.id, orgId, { category: 'rent', kind: 'monthly', date: '2026-03-15', amount: 31000, title: 'Аренда', basis: 'Тест: договор № 1' });
    await addExpense(acc.id, orgId, { category: 'payroll', kind: 'monthly', date: '2026-03-01', amount: 62000, title: 'ФОТ' });
    const wrong = await addExpense(acc.id, orgId, { category: 'marketing', kind: 'once', date: '2026-03-10', amount: 9999, title: 'Ошибка' });
    await addExpense(acc.id, orgId, { category: 'marketing', kind: 'once', date: '2026-03-10', amount: 5000, title: 'Листовки' });
    await addExpense(acc.id, orgId, { category: 'other', kind: 'once', date: '2026-04-02', amount: 777, title: 'Вне периода' });
    await expect(voidExpense(acc.id, orgId, wrong.id, { reason: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await voidExpense(acc.id, orgId, wrong.id, { reason: 'Тест: ошиблись суммой' });
    await expect(withSystem((tx) => tx.query(`update expenses set amount = 1 where id = $1`, [wrong.id]))).rejects.toThrow(/не изменяется/);
    await expect(withSystem((tx) => tx.query(`delete from expenses where id = $1`, [wrong.id]))).rejects.toThrow(/не удаляется/);
    const l = await listExpenses(acc.id, orgId, P);
    const rent = l.rows.find((r: any) => r.title === 'Аренда')!;
    expect(rent).toMatchObject({ on_date: '2026-03-01', share: Math.round(28 / 31 * 10000) / 10000, in_period: 28000 });
    expect(l.rows.find((r: any) => r.title === 'Ошибка')).toMatchObject({ voided: true, in_period: 0 });
    expect(l.rows.some((r: any) => r.title === 'Вне периода')).toBe(false);
  });
});

describe('P&L и Prime Cost', () => {
  it('выручка − себестоимость − потери − расходы; неполные данные перечислены', async () => {
    const x = await pnl(acc.id, orgId, P);
    const revenue = 4 * 3000 + 24 * 1000 + 500;
    expect(x.revenue).toBe(revenue);
    expect(x.cogs).toBe(4 * 900 + 24 * 450);
    expect(x.expenses).toEqual({ rent: 28000, payroll: 56000, marketing: 5000 });
    expect(x.opex).toBe(89000);
    expect(x.profit).toBe(revenue - (4 * 900 + 24 * 450) - 89000);
    expect(x.prime_cost).toBe(4 * 900 + 24 * 450 + 56000);
    expect(x.complete).toBe(false);
    expect(x.incomplete[0]).toMatch(/продаж без себестоимости: 1/);
    await expect(pnl(chef.id, orgId, P)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('ABC / XYZ', () => {
  it('ABC по выручке; по марже — только при полной себестоимости; XYZ по неделям', async () => {
    const x = await abcXyz(acc.id, orgId, P);
    expect(x.weeks).toBe(4);
    const by = Object.fromEntries(x.rows.map((r: any) => [r.name, r]));
    expect(by['Стейк'].abc_revenue).toBe('A');   // 24000 из 36500
    expect(by['Борщ'].abc_revenue).toBe('A');    // накопленная доля до него 65,8 % < 80 %
    expect(by['Морс'].abc_revenue).toBe('C');
    expect(by['Борщ']).toMatchObject({ xyz: 'X', cv: 0 });
    expect(by['Стейк'].xyz).toBe('Z');            // 2/10/2/10 — CV 66,7 %
    expect(x.margin_available).toBe(false);
    expect(x.notes[0]).toMatch(/по марже не рассчитан/);
    const short = await abcXyz(acc.id, orgId, { from: '2026-03-02', to: '2026-03-15' });
    expect(short.xyz_available).toBe(false);
  });
});
