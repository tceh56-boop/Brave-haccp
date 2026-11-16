import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/server/db/pool';
import { createOrganization, inviteMember, acceptInvitation } from '../src/server/org/organizations';
import { createProduct, createSupplier } from '../src/server/ops/catalog';
import { createReceipt } from '../src/server/ops/receipts';
import { setMedical, recordHealthCheck, setStaffSettings, listStaff } from '../src/server/ops/staff';
import { makeUser, lastLinkToken, orgDate } from './helpers';

/** Допуск к работе с продукцией — решения владельца (вопрос 2 промта доработки): «блокировать» по умолчанию, без осмотра — нельзя, кладовщик проверяется. */

afterAll(() => closePool());
type U = Awaited<ReturnType<typeof makeUser>>;
let owner: U, chef: U, haccp: U, cook: U, store: U, orgId: string, siteId: string, supplierId: string;
const medOk = { medBookNo: 'ЛМК 77-555', examOn: orgDate(-30), examDue: orgDate(335), hygieneOn: orgDate(-30), hygieneDue: orgDate(700) };
const was = process.env.ADMISSION_DEFAULT;

async function invite(role: string) {
  const u = await makeUser();
  await inviteMember(owner.id, orgId, { email: u.email, role });
  await acceptInvitation(u, await lastLinkToken(u.email, 'invitation'));
  return u;
}
const receipt = (u: U) => createReceipt(u.id, orgId, { siteId, supplierId });

beforeAll(async () => {
  owner = await makeUser();
  const r = await createOrganization(owner, { name: 'Кухня допуска' });
  orgId = r.organization.id; siteId = r.site.id;
  chef = await invite('chef'); haccp = await invite('haccp_lead'); cook = await invite('line_staff'); store = await invite('storekeeper');
  await createProduct(chef.id, orgId, { name: 'Мука', unit: 'кг' });
  supplierId = (await createSupplier(chef.id, orgId, { name: 'ООО «Мука»' })).id;
});
afterAll(() => { if (was === undefined) delete process.env.ADMISSION_DEFAULT; else process.env.ADMISSION_DEFAULT = was; });

describe('Допуск к работе с продукцией', () => {
  it('по умолчанию — «блокировать»: без медкнижки запись по продукции не принимается', async () => {
    delete process.env.ADMISSION_DEFAULT;
    expect((await listStaff(owner.id, orgId, null)).gate).toBe('block');
    await expect(receipt(cook)).rejects.toThrow(/данные ЛМК не внесены/);
  });

  it('медкнижка в порядке, но сегодня нет осмотра перед сменой — нельзя; после «допущен» — можно', async () => {
    delete process.env.ADMISSION_DEFAULT;
    await setMedical(haccp.id, orgId, cook.id, medOk);
    await expect(receipt(cook)).rejects.toThrow(/Сегодня нет осмотра перед сменой/);
    await recordHealthCheck(chef.id, orgId, cook.id, { siteId, admitted: true });
    expect((await receipt(cook)).id).toEqual(expect.any(String));
  });

  it('кладовщик — пищевая роль: без медкнижки и осмотра приёмка не принимается', async () => {
    delete process.env.ADMISSION_DEFAULT;
    await expect(receipt(store)).rejects.toThrow(/данные ЛМК не внесены/);
    await setMedical(haccp.id, orgId, store.id, medOk);
    await expect(receipt(store)).rejects.toThrow(/Сегодня нет осмотра/);
    await recordHealthCheck(chef.id, orgId, store.id, { siteId, admitted: true });
    expect((await receipt(store)).id).toEqual(expect.any(String));
  });

  it('просроченная медкнижка блокирует даже при сегодняшнем осмотре; явный режим предприятия важнее значения по умолчанию', async () => {
    delete process.env.ADMISSION_DEFAULT;
    await setMedical(haccp.id, orgId, cook.id, { ...medOk, examOn: orgDate(-400), examDue: orgDate(-1) });
    await expect(receipt(cook)).rejects.toThrow(/срок медосмотра или гигиенической аттестации истёк/);
    await setStaffSettings(owner.id, orgId, { medicalGate: 'warn' });
    expect((await receipt(cook)).id).toEqual(expect.any(String));
    process.env.ADMISSION_DEFAULT = 'block';
    expect((await listStaff(owner.id, orgId, null)).gate).toBe('warn');
  });
});
